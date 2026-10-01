// Jira는 조회만 합니다. 체크한 변경안만 기존 헬프데스크 시트에 반영합니다.
const HELPDESK_JIRA_SYNC_API_URL = 'https://script.google.com/macros/s/AKfycbxncJs9huZd1ENzETRxRyKO5ikexxscHptSYGE6LIXsWP1DFDEn1Zmodk0H7vE8EuDR/exec';
const HELPDESK_JIRA_SYNC_ORIGIN = 'https://kic-itsd.atlassian.net';
const HELPDESK_JIRA_SYNC_TTL = 600;

function requestHelpdeskJiraSync_(issueKeys, issueNumbers) {
  const response = UrlFetchApp.fetch(HELPDESK_JIRA_SYNC_API_URL, {
    method: 'post', contentType: 'text/plain', muteHttpExceptions: true,
    payload: JSON.stringify({ action: 'getHelpdeskJiraSyncIssues', data: { issueKeys: issueKeys, issueNumbers: issueNumbers } })
  });
  if (response.getResponseCode() !== 200) throw new Error('Jira 연결을 확인해 주세요. (' + response.getResponseCode() + ')');
  let result;
  try { result = JSON.parse(response.getContentText()); }
  catch (error) { throw new Error('Jira 조회 API의 배포 상태를 확인해 주세요.'); }
  if (!result.success || !result.data || !Array.isArray(result.data.issues)) {
    throw new Error(result.error || 'Jira 싱크 조회 API를 먼저 재배포해 주세요.');
  }
  // 링크는 신뢰된 테넌트와 검증한 Jira 키로 서버에서 직접 만듭니다.
  result.data.issues = result.data.issues.filter(function(issue) {
    return /^[A-Z][A-Z0-9_]*-\d+$/.test(issue.key || '');
  }).map(function(issue) {
    return {
      key: issue.key, url: HELPDESK_JIRA_SYNC_ORIGIN + '/browse/' + issue.key,
      title: String(issue.title || '').slice(0, 500), status: String(issue.status || ''),
      category: String(issue.category || ''), resolvedAt: String(issue.resolvedAt || ''),
      issueNumbers: Array.isArray(issue.issueNumbers) ? issue.issueNumbers : []
    };
  });
  return result.data;
}

function helpdeskJiraKey_(value) {
  const match = String(value || '').trim().match(/^https:\/\/kic-itsd\.atlassian\.net\/browse\/([A-Z][A-Z0-9_]*-\d+)(?:[?#].*)?\/?$/i);
  return match ? match[1].toUpperCase() : '';
}

function helpdeskJiraStatus_(issue) {
  const name = String(issue.status || '').trim();
  if (/반려|취소|거절|cancel|reject|won.?t (?:do|fix)|declined/i.test(name)) return '반려';
  if (['접수대기', '검토중', '예정', '처리중', '완료'].indexOf(name) !== -1) return name;
  if (/검토|review/i.test(name)) return '검토중';
  if (issue.category === 'done') return '완료';
  if (issue.category === 'indeterminate') return '처리중';
  if (issue.category === 'new') return '예정';
  return '';
}

function helpdeskSyncBaseline_(row) {
  return [row[11], row[12], row[16], row[17], row[18]].map(function(value) {
    return value instanceof Date ? value.toISOString() : String(value === undefined || value === null ? '' : value);
  });
}

function helpdeskSyncChanges_(row, issue) {
  const changes = [];
  if (row.jiraLink !== issue.url) changes.push({ field: 'jiraLink', label: 'Jira 링크', from: row.jiraLink || '미등록', to: issue.url });
  if (!row.jiraLinked) changes.push({ field: 'jiraLinked', label: 'Jira 연동', from: '미표시', to: '연동됨' });
  const status = helpdeskJiraStatus_(issue);
  if (status && row.status !== status) {
    let note = '';
    if (status === '완료' || status === '반려') {
      const resolved = new Date(issue.resolvedAt);
      note = !isNaN(resolved.getTime()) ? '처리일시는 Jira 해결일로 반영합니다.' : 'Jira 해결일이 없어 기존 처리일시를 유지합니다.';
    } else if (row.baseline[1]) note = '기존 처리일시는 비워집니다.';
    if (status !== '반려' && isHiddenFlagValue(row.baseline[3])) note += (note ? ' ' : '') + '기존 숨김 표시도 해제됩니다.';
    changes.push({ field: 'status', label: '상태', from: row.status, to: status, note: note });
  }
  return changes;
}

function helpdeskSyncPublicRow_(row) {
  return {
    id: row.id, title: row.title, status: row.status, sourceLink: row.sourceLink || '', jiraLink: row.jiraLink, message: row.message || '',
    candidates: row.candidates.map(function(issue) {
      return { key: issue.key, title: issue.title, url: issue.url, status: issue.status,
        changes: helpdeskSyncChanges_(row, issue),
        warning: helpdeskJiraStatus_(issue) ? '' : '알 수 없는 Jira 상태입니다. 상태는 변경하지 않습니다.' };
    })
  };
}

function helpdeskSyncCacheKey_(token, id) { return 'HD_JIRA_SYNC_' + token + (id ? '_' + id : ''); }

function requireHelpdeskSyncPreview_(token) {
  if (!/^[a-f0-9-]{36}$/i.test(String(token || ''))) throw new Error('싱크 변경안을 다시 조회해 주세요.');
  const cache = CacheService.getScriptCache();
  const raw = cache.get(helpdeskSyncCacheKey_(token));
  if (!raw) throw new Error('변경안 유효시간이 지났습니다. 다시 조회해 주세요.');
  const context = JSON.parse(raw);
  if (Date.now() >= context.expiresAt) throw new Error('변경안 유효시간이 지났습니다. 다시 조회해 주세요.');
  return context;
}

function previewHelpdeskJiraSync() {
  const sheet = getMainSheet();
  const count = Math.max(0, sheet.getLastRow() - START_ROW + 1);
  // 미리보기에서 시트/헤더를 변경하지 않습니다.
  const rows = count ? sheet.getRange(START_ROW, 1, count, Math.min(JIRA_LINKED_COLUMN, sheet.getMaxColumns())).getValues() : [];
  const records = [];
  const ids = {};
  rows.forEach(function(row) {
    const id = String(row[0] || '').trim();
    if (!/^IT-\d{6}-\d{3,}$/.test(id)) return;
    if (ids[id]) throw new Error('중복된 이슈번호가 있습니다: ' + id + '. 시트에서 먼저 확인해 주세요.');
    ids[id] = true;
    const status = normalizeIssueStatus(row[11]);
    const link = String(row[16] || '').trim();
    // 종료된 미연결 건은 제외합니다. 진행 중 건과 연결된 종료 건은 기간에 관계없이 확인합니다.
    if (!link && (status === '완료' || status === '반려')) return;
    records.push({ id: id, title: String(row[8] || '').slice(0, 500), status: status, sourceLink: String(row[15] || '').trim(),
      jiraLink: link, jiraLinked: isJiraLinkedFlagValue(row[18]), baseline: helpdeskSyncBaseline_(row), candidates: [],
      message: link && !helpdeskJiraKey_(link) ? 'Jira 링크 형식을 확인해 주세요. Jira 번호로 직접 조회할 수 있습니다.' : '' });
  });
  const keys = Array.from(new Set(records.map(function(row) { return helpdeskJiraKey_(row.jiraLink); }).filter(Boolean)));
  const numbers = records.filter(function(row) { return !row.jiraLink; }).map(function(row) { return row.id; });
  const result = records.length ? requestHelpdeskJiraSync_(keys, numbers) : { issues: [], warnings: [] };
  const byKey = {}, byNumber = {};
  result.issues.forEach(function(issue) {
    byKey[issue.key] = issue;
    issue.issueNumbers.forEach(function(id) {
      if (!byNumber[id]) byNumber[id] = [];
      if (!byNumber[id].some(function(candidate) { return candidate.key === issue.key; })) byNumber[id].push(issue);
    });
  });
  records.forEach(function(row) {
    const key = helpdeskJiraKey_(row.jiraLink);
    row.candidates = key ? (byKey[key] ? [byKey[key]] : []) : (row.jiraLink ? [] : (byNumber[row.id] || []));
    if (key && !row.candidates.length) row.message = '등록된 Jira 티켓을 조회하지 못했습니다. 삭제·권한·연결을 확인해 주세요.';
    if (row.candidates.length > 1) row.message = '같은 이슈번호가 여러 Jira 티켓에 있습니다. 연결할 티켓을 직접 선택해 주세요.';
  });
  const token = Utilities.getUuid();
  const expiresAt = Date.now() + HELPDESK_JIRA_SYNC_TTL * 1000;
  const cache = CacheService.getScriptCache();
  // 행별로 저장해서 CacheService의 단일 항목 100KB 제한을 피합니다.
  for (let offset = 0; offset < records.length; offset += 100) {
    const entries = {};
    records.slice(offset, offset + 100).forEach(function(row) { entries[helpdeskSyncCacheKey_(token, row.id)] = JSON.stringify(row); });
    cache.putAll(entries, HELPDESK_JIRA_SYNC_TTL);
  }
  cache.put(helpdeskSyncCacheKey_(token), JSON.stringify({ sheetId: sheet.getSheetId(), expiresAt: expiresAt }), HELPDESK_JIRA_SYNC_TTL);
  return { token: token, expiresAt: expiresAt, rows: records.map(helpdeskSyncPublicRow_), warnings: result.warnings || [] };
}

function lookupHelpdeskJiraSync(data) {
  const context = requireHelpdeskSyncPreview_(data.token);
  const id = String(data.id || '');
  if (!/^IT-\d{6}-\d{3,}$/.test(id)) throw new Error('이슈번호를 확인해 주세요.');
  const cache = CacheService.getScriptCache();
  const raw = cache.get(helpdeskSyncCacheKey_(data.token, id));
  if (!raw) throw new Error('변경안을 다시 조회해 주세요.');
  const key = String(data.issueKey || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw new Error('Jira 번호를 입력해 주세요. 예: ITM-123');
  const issue = requestHelpdeskJiraSync_([key], []).issues.filter(function(candidate) { return candidate.key === key; })[0];
  if (!issue) throw new Error('Jira 티켓을 찾지 못했습니다. 번호와 접근 권한을 확인해 주세요.');
  // 조회 결과를 추가할 뿐, 연결이나 상태를 저장하지 않습니다.
  const row = JSON.parse(raw);
  row.candidates = row.candidates.filter(function(candidate) { return candidate.key !== key; }).concat([issue]);
  row.message = '직접 조회한 연결 후보입니다. 제목과 내용을 확인한 뒤 변경안을 선택해 주세요.';
  cache.put(helpdeskSyncCacheKey_(data.token, id), JSON.stringify(row), Math.max(1, Math.ceil((context.expiresAt - Date.now()) / 1000)));
  return helpdeskSyncPublicRow_(row);
}

function applyHelpdeskJiraSync(data) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
  try {
    const context = requireHelpdeskSyncPreview_(data.token);
    const selections = Array.isArray(data.selections) ? data.selections : [];
    if (!selections.length || selections.length > 500) throw new Error('적용할 변경안을 1~500건 선택해 주세요.');
    const cache = CacheService.getScriptCache();
    const sheet = getMainSheet();
    if (sheet.getSheetId() !== context.sheetId) throw new Error('대상 시트가 변경됐습니다. 다시 조회해 주세요.');
    const prepared = [], seen = {};
    // 모든 요청을 검증한 다음에만 쓰기를 시작합니다.
    selections.forEach(function(selection) {
      const id = String(selection.id || '');
      if (!/^IT-\d{6}-\d{3,}$/.test(id) || seen[id]) throw new Error('선택한 이슈번호를 확인해 주세요.');
      seen[id] = true;
      const raw = cache.get(helpdeskSyncCacheKey_(data.token, id));
      if (!raw) throw new Error('일부 변경안의 유효시간이 지났습니다. 다시 조회해 주세요.');
      const row = JSON.parse(raw);
      const candidate = row.candidates.filter(function(issue) { return issue.key === selection.issueKey; })[0];
      if (!candidate || !Array.isArray(selection.fields) || !selection.fields.length) throw new Error('변경안을 다시 선택해 주세요.');
      const changes = helpdeskSyncChanges_(row, candidate);
      const fields = Array.from(new Set(selection.fields));
      if (fields.some(function(field) { return !changes.some(function(change) { return change.field === field; }); })) throw new Error('허용되지 않은 변경 항목입니다.');
      // 아직 연결하지 않은 다른 후보의 상태만 기존 링크에 덮어씌우지 못하게 합니다.
      if (helpdeskJiraKey_(row.jiraLink) !== candidate.key && fields.indexOf('jiraLink') === -1) {
        throw new Error(id + ': 새 연결 후보는 Jira 링크 변경도 함께 선택해 주세요.');
      }
      prepared.push({ row: row, candidate: candidate, fields: fields });
    });
    const applied = [], skipped = [];
    prepared.forEach(function(item) {
      const targetRow = findIssueRowById(sheet, item.row.id);
      if (targetRow < START_ROW) { skipped.push({ id: item.row.id, reason: '이슈를 찾을 수 없습니다.' }); return; }
      const current = sheet.getRange(targetRow, 1, 1, Math.min(JIRA_LINKED_COLUMN, sheet.getMaxColumns())).getValues()[0];
      if (JSON.stringify(helpdeskSyncBaseline_(current)) !== JSON.stringify(item.row.baseline)) {
        skipped.push({ id: item.row.id, reason: '조회 후 내용이 변경됐습니다. 다시 확인해 주세요.' }); return;
      }
      if (sheet.getMaxColumns() < JIRA_LINKED_COLUMN) {
        skipped.push({ id: item.row.id, reason: '시트에 Jira 연동 컬럼이 없습니다.' }); return;
      }
      try {
        if (item.fields.indexOf('jiraLink') !== -1) sheet.getRange(targetRow, JIRA_LINK_COLUMN).setValue(item.candidate.url);
        if (item.fields.indexOf('jiraLinked') !== -1) sheet.getRange(targetRow, JIRA_LINKED_COLUMN).setValue('Y');
        if (item.fields.indexOf('status') !== -1) {
          const status = helpdeskJiraStatus_(item.candidate);
          sheet.getRange(targetRow, 12).setValue(status);
          if (status === '완료' || status === '반려') {
            const resolved = new Date(item.candidate.resolvedAt);
            if (!isNaN(resolved.getTime())) sheet.getRange(targetRow, 13).setValue(resolved).setNumberFormat(NUMBER_FORMAT_DT);
          } else sheet.getRange(targetRow, 13).setValue('');
          if (status !== '반려') sheet.getRange(targetRow, HIDDEN_FLAG_COLUMN).setValue('');
        }
        SpreadsheetApp.flush();
        applied.push({ id: item.row.id, fields: item.fields });
      } catch (error) {
        // 시트는 트랜잭션을 지원하지 않습니다. 부분 저장 가능성을 숨기지 않습니다.
        skipped.push({ id: item.row.id, reason: '저장 오류가 발생했습니다. 일부 반영됐을 수 있어 다시 조회해야 합니다.' });
      }
    });
    cache.remove(helpdeskSyncCacheKey_(data.token)); // 중복 적용 방지. 다음 작업은 새 미리보기에서 합니다.
    return { applied: applied, skipped: skipped };
  } finally { lock.releaseLock(); }
}
