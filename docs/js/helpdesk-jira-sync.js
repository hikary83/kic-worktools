(function () {
  'use strict';
  let modal, state, previousFocus, previousOverflow;
  let generation = 0;
  const labels = { changes: '변경안', unlinked: '연결 필요', review: '확인 필요', matched: '일치', all: '전체' };
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  function initModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'hd-sync';
    modal.hidden = true;
    modal.innerHTML = `<section class="hd-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="hd-sync-heading">
      <header class="hd-sync-header"><div><h2 id="hd-sync-heading"><i class="fas fa-sync-alt" aria-hidden="true"></i>Jira 싱크 확인</h2>
        <p>이슈번호로 연결을 확인하고, 선택한 변경안만 헬프데스크에 반영합니다.</p></div>
        <button class="hd-sync-btn hd-sync-close" data-sync-action="close" aria-label="닫기"><i class="fas fa-times"></i></button></header>
      <div class="hd-sync-toolbar" hidden></div><div class="hd-sync-body" aria-live="polite"></div>
      <footer class="hd-sync-footer"><p id="hd-sync-selection">선택한 변경안이 없습니다.</p><div class="hd-sync-footer-actions">
        <button class="hd-sync-btn" data-sync-action="close">닫기</button>
        <button class="hd-sync-btn hd-sync-primary" data-sync-action="apply" disabled>선택 항목 적용</button></div></footer></section>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', onClick);
    modal.addEventListener('change', onChange);
    document.addEventListener('keydown', event => {
      if (modal.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Enter' && event.target.hasAttribute('data-sync-key') && !busy()) {
        event.preventDefault(); lookup(event.target.dataset.syncKey);
      }
      if (event.key !== 'Tab') return;
      const focusables = [...modal.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary')]
        .filter(element => element.getClientRects().length);
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

  window.openHelpdeskJiraSync = function () {
    initModal();
    if (!modal.hidden) return;
    previousFocus = document.activeElement;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal.hidden = false;
    modal.querySelector('[data-sync-action="close"]').focus();
    refresh();
  };

  function close() {
    if (state && busy()) return;
    generation++;
    modal.hidden = true;
    document.body.style.overflow = previousOverflow;
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
  }

  async function refresh() {
    const request = ++generation;
    state = { rows: [], selected: {}, fields: {}, filter: 'changes', loading: true, applying: false, token: '', warnings: [], result: null, exclusionSupported: false };
    render();
    try {
      const result = await callGASApi('previewJiraSync');
      if (request !== generation) return;
      state.rows = result.rows || [];
      state.token = result.token;
      state.expiresAt = result.expiresAt;
      state.warnings = result.warnings || [];
      state.exclusionSupported = result.exclusionSupported === true;
      state.rows.forEach(row => { if (row.candidates.length === 1) state.selected[row.id] = row.candidates[0].key; });
      if (!state.rows.some(row => !row.excluded && kind(row) === 'changes')) state.filter = 'all';
    } catch (error) { if (request === generation) state.error = error.message; }
    if (request !== generation) return;
    state.loading = false;
    render();
  }

  function candidate(row) { return row.candidates.find(issue => issue.key === state.selected[row.id]); }
  function busy() { return state.applying || !!state.lookupId || !!state.exclusionId; }
  function kind(row) {
    const issue = candidate(row);
    if (!issue) return row.candidates.length || row.jiraLink ? 'review' : 'unlinked';
    if (issue.warning) return 'review';
    return issue.changes.length ? 'changes' : 'matched';
  }
  function visibleRows() { return state.rows.filter(row => state.filter === 'all' || (!row.excluded && kind(row) === state.filter)); }
  function selections() {
    return state.rows.filter(row => !row.excluded).map(row => ({ id: row.id, issueKey: state.selected[row.id], fields: [...(state.fields[row.id] || [])] })).filter(row => row.fields.length);
  }
  function updateFooter() {
    const selected = selections();
    const count = selected.reduce((sum, row) => sum + row.fields.length, 0);
    const text = state.applying ? '선택한 변경안을 저장하고 있습니다…' : state.exclusionId ? '팀 공통 싱크 제외 설정을 저장하고 있습니다…' : selected.length ? `${selected.length}개 이슈 · ${count}개 변경 항목 선택` : '선택한 변경안이 없습니다.';
    modal.querySelector('#hd-sync-selection').textContent = text;
    const button = modal.querySelector('[data-sync-action="apply"]');
    button.disabled = !count || state.loading || busy() || !!state.result;
    button.innerHTML = state.applying ? '<i class="fas fa-spinner fa-spin"></i> 적용 중…' : '선택 항목 적용';
    modal.querySelectorAll('[data-sync-action="close"]').forEach(button => { button.disabled = busy(); });
  }

  function render() {
    const toolbar = modal.querySelector('.hd-sync-toolbar');
    const body = modal.querySelector('.hd-sync-body');
    toolbar.hidden = state.loading || !!state.error || !!state.result;
    body.classList.toggle('hd-sync-body-state', state.loading || !!state.error || !!state.result || !visibleRows().length);
    if (state.loading) {
      body.innerHTML = '<div class="hd-sync-state" role="status"><div class="hd-sync-state-content"><i class="fas fa-spinner fa-spin"></i>Jira 링크와 상태를 확인하고 있습니다…<br>완료된 티켓까지 조회하므로 잠시 걸릴 수 있습니다.</div></div>';
    } else if (state.error) {
      body.innerHTML = `<div class="hd-sync-state"><div class="hd-sync-state-content"><i class="fas fa-exclamation-circle"></i>${escape(state.error)}<br><button class="hd-sync-btn" data-sync-action="refresh">다시 조회</button></div></div>`;
    } else if (state.result) {
      const { applied, skipped } = state.result;
      body.innerHTML = `<div class="hd-sync-state"><div class="hd-sync-state-content"><i class="fas fa-check-circle"></i><strong>${applied.length}개 이슈 반영 · ${skipped.length}개 확인 필요</strong><br>Jira 티켓은 변경하지 않았습니다.<br><button class="hd-sync-btn" data-sync-action="refresh">변경안 다시 조회</button></div></div>
        ${skipped.map(row => `<div class="hd-sync-notice hd-sync-warning"><strong>${escape(row.id)}</strong> · ${escape(row.reason)}</div>`).join('')}`;
    } else {
      toolbar.innerHTML = `<div class="hd-sync-filters">${Object.keys(labels).map(filter => `<button class="hd-sync-filter" data-sync-filter="${filter}" aria-pressed="${state.filter === filter}" ${busy() ? 'disabled' : ''}>${labels[filter]}<span>${filter === 'all' ? state.rows.length : state.rows.filter(row => !row.excluded && kind(row) === filter).length}</span></button>`).join('')}</div>
        <button class="hd-sync-btn" data-sync-action="refresh" ${busy() ? 'disabled' : ''}><i class="fas fa-redo-alt"></i> 다시 조회</button>`;
      const rows = visibleRows();
      const excludedCount = state.rows.filter(row => row.excluded).length;
      const notices = `<div class="hd-sync-notice">조회기간과 관계없이 진행 중 이슈와 Jira 링크가 있는 완료·반려 이슈를 확인합니다. 체크 후 적용해야 저장됩니다.${state.filter === 'all' && excludedCount ? `<br>싱크 제외 ${excludedCount}건 · 제외 해제하면 다시 확인 대상에 포함됩니다.` : ''}</div>
        ${!state.exclusionSupported ? '<div class="hd-sync-notice hd-sync-warning">팀 공통 싱크 제외 기능은 업무 API 재배포 후 사용할 수 있습니다.</div>' : ''}
        ${state.warnings.map(message => `<div class="hd-sync-notice hd-sync-warning">${escape(message)}</div>`).join('')}
        ${state.exclusionError ? `<div class="hd-sync-notice hd-sync-error">${escape(state.exclusionError)}</div>` : ''}
        ${state.applyError ? `<div class="hd-sync-notice hd-sync-error">${escape(state.applyError)}</div>` : ''}`;
      body.innerHTML = notices + (rows.length ? `<table class="hd-sync-table"><thead><tr><th>이슈번호 / 업무</th><th>Jira 연결</th><th><label class="hd-sync-all"><input type="checkbox" data-sync-all ${busy() ? 'disabled' : ''}> 표시된 변경안 전체 선택</label></th></tr></thead>
        <tbody>${rows.map(renderRow).join('')}</tbody></table>` : '<div class="hd-sync-state"><div class="hd-sync-state-content"><i class="fas fa-check-circle"></i>해당하는 이슈가 없습니다.</div></div>');
      updateAllCheckbox();
    }
    updateFooter();
  }

  function renderRow(row) {
    const issue = candidate(row);
    const disabled = busy() || row.excluded;
    let sourceUrl = '';
    try {
      const url = new URL(String(row.sourceLink || '').trim());
      if (url.protocol === 'https:' || url.protocol === 'http:') sourceUrl = url.href;
    } catch (error) { /* 원문 링크가 비어 있거나 잘못된 경우 열기 버튼을 표시하지 않습니다. */ }
    const source = sourceUrl ? `<a class="hd-sync-source" href="${escape(sourceUrl)}" target="_blank" rel="noopener noreferrer" title="원문 보기" aria-label="${escape(row.id)} 원문 보기"><i class="fas fa-external-link-alt" aria-hidden="true"></i></a>` : '';
    const choices = row.candidates.length > 1 ? `<select class="hd-sync-select" data-sync-candidate="${escape(row.id)}" aria-label="${escape(row.id)} Jira 연결 후보" ${disabled ? 'disabled' : ''}>
      <option value="">Jira 티켓 선택</option>${row.candidates.map(option => `<option value="${escape(option.key)}" ${issue && issue.key === option.key ? 'selected' : ''}>${escape(option.key + ' · ' + option.title)}</option>`).join('')}</select>` : '';
    const linked = issue ? `<a href="${escape(issue.url)}" target="_blank" rel="noopener noreferrer">${escape(issue.key)} <i class="fas fa-external-link-alt"></i></a><div class="hd-sync-title">${escape(issue.title)}</div><div class="hd-sync-meta">Jira 상태 · ${escape(issue.status)}</div>` : '<span class="hd-sync-meta">연결할 Jira 티켓을 확인해 주세요.</span>';
    const fields = issue ? issue.changes.map(change => `<label class="hd-sync-field"><input type="checkbox" data-sync-field="${change.field}" data-sync-id="${escape(row.id)}" ${(state.fields[row.id] || new Set()).has(change.field) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span><strong>${escape(change.label)}</strong><p>${escape(change.from)} → <b>${escape(change.to)}</b></p>${change.note ? `<small>${escape(change.note)}</small>` : ''}</span></label>`).join('') : '';
    const status = issue ? (issue.warning || (issue.changes.length ? '' : '연결과 상태가 일치합니다.')) : row.message || (row.candidates.length ? '연결 후보를 선택하면 변경안이 표시됩니다.' : '이슈번호로 연결 후보를 찾지 못했습니다. Jira 번호로 직접 조회해 주세요.');
    const message = row.message && issue ? `<div class="hd-sync-meta">${escape(row.message)}</div>` : '';
    const error = state.lookupError && state.lookupError.id === row.id ? `<div class="hd-sync-meta hd-sync-error">${escape(state.lookupError.message)}</div>` : '';
    const exclusion = `<button class="hd-sync-btn hd-sync-exclude-btn" data-sync-action="${row.excluded ? 'restore' : 'exclude'}" data-sync-id="${escape(row.id)}" aria-label="${escape(row.id)} ${row.excluded ? '싱크 제외 해제' : '싱크 제외'}" ${busy() || !state.exclusionSupported ? 'disabled' : ''}><i class="fas fa-${row.excluded ? 'undo' : 'ban'}" aria-hidden="true"></i>${state.exclusionId === row.id ? '저장 중…' : row.excluded ? '제외 해제' : '싱크 제외'}</button>`;
    return `<tr data-sync-row="${escape(row.id)}" class="${row.excluded ? 'hd-sync-excluded-row' : ''}"><td><div class="hd-sync-issue-heading"><span class="hd-sync-id">${escape(row.id)}</span>${source}${row.excluded ? '<span class="hd-sync-excluded-badge">싱크 제외</span>' : ''}</div><div class="hd-sync-title">${escape(row.title)}</div><div class="hd-sync-meta">현재 상태 · ${escape(row.status)}</div>${exclusion}</td>
      <td>${choices}${linked}${message}${!row.excluded ? `<details class="hd-sync-lookup" ${!issue ? 'open' : ''}><summary>Jira 번호로 직접 조회</summary>
        <div><input class="hd-sync-input" data-sync-key="${escape(row.id)}" placeholder="예: ITM-123" aria-label="${escape(row.id)} Jira 번호" ${disabled ? 'disabled' : ''}>
        <button class="hd-sync-btn" data-sync-action="lookup" data-sync-id="${escape(row.id)}" ${disabled ? 'disabled' : ''}>${state.lookupId === row.id ? '조회 중…' : '조회'}</button></div>${error}</details>` : ''}</td>
      <td>${fields}${row.excluded ? '<div class="hd-sync-meta">싱크 적용 대상에서 제외됐습니다.</div>' : status ? `<div class="hd-sync-meta">${escape(status)}</div>` : ''}</td></tr>`;
  }

  function updateAllCheckbox() {
    const checkbox = modal.querySelector('[data-sync-all]');
    if (!checkbox) return;
    const fields = visibleRows().filter(row => !row.excluded).flatMap(row => (candidate(row)?.changes || []).map(change => ({ id: row.id, field: change.field })));
    const count = fields.filter(item => state.fields[item.id]?.has(item.field)).length;
    checkbox.checked = !!fields.length && count === fields.length;
    checkbox.indeterminate = count > 0 && count < fields.length;
    checkbox.disabled = !fields.length || busy();
  }

  function onChange(event) {
    if (busy()) return;
    const element = event.target;
    if (element.hasAttribute('data-sync-candidate')) {
      const id = element.dataset.syncCandidate;
      if (state.rows.find(row => row.id === id)?.excluded) return;
      state.selected[id] = element.value;
      state.fields[id] = new Set();
      render();
    } else if (element.hasAttribute('data-sync-all')) {
      visibleRows().filter(row => !row.excluded).forEach(row => {
        const issue = candidate(row);
        if (issue) state.fields[row.id] = new Set(element.checked ? issue.changes.map(change => change.field) : []);
      });
      render();
    } else if (element.hasAttribute('data-sync-field')) {
      const id = element.dataset.syncId, field = element.dataset.syncField;
      const row = state.rows.find(row => row.id === id), issue = candidate(row);
      if (!issue || row.excluded) return;
      const fields = state.fields[id] || (state.fields[id] = new Set());
      if (element.checked) fields.add(field); else fields.delete(field);
      // 새 티켓의 상태/연동 표시를 반영하려면 그 티켓의 링크도 필요합니다.
      const currentKey = row.jiraLink.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)(?:[?#/]|$)/i);
      if (issue.changes.some(change => change.field === 'jiraLink') && (!currentKey || currentKey[1].toUpperCase() !== issue.key)) {
        if (element.checked) fields.add('jiraLink');
        else if (field === 'jiraLink') fields.clear();
      }
      modal.querySelectorAll('[data-sync-field]').forEach(input => { if (input.dataset.syncId === id) input.checked = fields.has(input.dataset.syncField); });
      updateAllCheckbox(); updateFooter();
    }
  }

  async function onClick(event) {
    if (event.target === modal) { close(); return; }
    const filter = event.target.closest('[data-sync-filter]');
    if (filter && !busy()) { state.filter = filter.dataset.syncFilter; render(); return; }
    const button = event.target.closest('[data-sync-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.syncAction;
    if (action === 'close') close();
    if (action === 'refresh' && !busy()) refresh();
    if (action === 'exclude' || action === 'restore') await setExcluded(button.dataset.syncId, action === 'exclude');
    if (action === 'lookup') await lookup(button.dataset.syncId);
    if (action === 'apply') await apply();
  }

  async function lookup(id) {
    if (busy() || state.rows.find(row => row.id === id)?.excluded) return;
    const input = [...modal.querySelectorAll('[data-sync-key]')].find(input => input.dataset.syncKey === id);
    const issueKey = input.value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) {
      state.lookupError = { id, message: 'Jira 번호를 입력해 주세요. 예: ITM-123' }; render(); return;
    }
    state.lookupId = id; state.lookupError = null; render();
    try {
      const row = await callGASApi('lookupJiraSync', { token: state.token, id, issueKey });
      state.rows = state.rows.map(item => item.id === id ? row : item);
      state.selected[id] = issueKey;
      state.fields[id] = new Set();
      state.filter = 'all';
    } catch (error) { state.lookupError = { id, message: error.message }; }
    state.lookupId = ''; render();
  }

  async function setExcluded(id, excluded) {
    if (busy() || !state.exclusionSupported || !state.rows.some(row => row.id === id)) return;
    state.exclusionId = id; state.exclusionError = ''; render();
    try {
      const result = await callGASApi('setJiraSyncExcluded', { token: state.token, id, excluded });
      if (result.id !== id || result.excluded !== excluded) throw new Error('싱크 제외 설정을 확인하지 못했습니다.');
      state.rows.find(row => row.id === id).excluded = result.excluded;
      state.fields[id] = new Set(); // 제외·해제 후 이전에 체크한 변경안을 다시 적용하지 않습니다.
    } catch (error) {
      state.fields[id] = new Set();
      state.exclusionError = error.message + ' 제외 설정의 저장 여부는 다시 조회해서 확인해 주세요.';
    }
    state.exclusionId = ''; render();
    const focusTarget = [...modal.querySelectorAll('[data-sync-action="exclude"], [data-sync-action="restore"]')].find(button => button.dataset.syncId === id)
      || modal.querySelector(`[data-sync-filter="${state.filter}"]`);
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  async function apply() {
    const selected = selections();
    if (!selected.length || busy()) return;
    if (Date.now() >= state.expiresAt) { state.applyError = '변경안 유효시간이 지났습니다. 다시 조회해 주세요.'; render(); return; }
    state.applying = true; state.applyError = ''; render();
    try {
      state.result = await callGASApi('applyJiraSync', { token: state.token, selections: selected });
      state.fields = {};
      if (typeof loadData === 'function') loadData(false);
    } catch (error) { state.applyError = error.message + ' 실제 반영 여부는 다시 조회해서 확인해 주세요.'; }
    state.applying = false; render();
  }
})();
