/**
 * IT전략실 Jira 통합 일정
 * - Jira는 조회만 하며 수정은 원본 Issue 화면에서 수행합니다.
 * - 로컬 UI 확인은 jira-timeline.html?demo=1 로 실행할 수 있습니다.
 */
(function initJiraTimelinePage() {
  'use strict';

  const PROJECTS = {
    C21R: { name: 'CMS', description: '[CMS] 2026 Update release', order: 1 },
    CW2R: { name: 'CWIZ 2.0', description: '[CWIZ 2.0] Update release', order: 2 },
    CWIZ: { name: 'CWIZ 1.0', description: '[CWIZ 1.0] Maintenance', order: 3 },
    ITM: { name: 'IT 업무', description: 'IT Task Management', order: 4 },
    WWWMR: { name: '홈페이지', description: '[HomePage] Maintenance', order: 5 }
  };
  const EXCLUDED_LABEL = '일정제외';
  const EXCLUDED_VISIBILITY_KEY = 'kic-jira-timeline-show-excluded';

  const state = {
    issues: [],
    timeline: null,
    anchorDate: new Date(),
    zoom: 'month',
    demoMode: new URLSearchParams(window.location.search).get('demo') === '1',
    publicConfig: null,
    unscheduledSort: { key: '', direction: 'asc' },
    excludedSort: { key: '', direction: 'asc' },
    showExcluded: readExcludedVisibility()
  };

  const elements = {};

  document.addEventListener('DOMContentLoaded', async function() {
    collectElements();
    bindEvents();
    updateRangeLabel();
    if (state.demoMode) {
      loadIssues();
      return;
    }
    await initializeJiraTimeline();
  });

  function collectElements() {
    elements.status = document.getElementById('jiraStatus');
    elements.setupGuide = document.getElementById('setupGuide');
    elements.missingProperties = document.getElementById('missingProperties');
    elements.lastUpdated = document.getElementById('lastUpdated');
    elements.refreshButton = document.getElementById('refreshButton');
    elements.searchInput = document.getElementById('searchInput');
    elements.projectFilter = document.getElementById('projectFilter');
    elements.assigneeFilter = document.getElementById('assigneeFilter');
    elements.statusFilter = document.getElementById('statusFilter');
    elements.resetFiltersButton = document.getElementById('resetFiltersButton');
    elements.toggleExcludedButton = document.getElementById('toggleExcludedButton');
    elements.excludedToggleLabel = document.getElementById('excludedToggleLabel');
    elements.timelineContainer = document.getElementById('jiraTimeline');
    elements.timelineEmpty = document.getElementById('timelineEmpty');
    elements.timelineCount = document.getElementById('timelineCount');
    elements.totalCount = document.getElementById('totalCount');
    elements.scheduledCount = document.getElementById('scheduledCount');
    elements.unscheduledCount = document.getElementById('unscheduledCount');
    elements.overdueCount = document.getElementById('overdueCount');
    elements.unscheduledPanel = document.getElementById('unscheduledPanel');
    elements.unscheduledTableCount = document.getElementById('unscheduledTableCount');
    elements.unscheduledTableBody = document.getElementById('unscheduledTableBody');
    elements.unscheduledSortButtons = Array.from(document.querySelectorAll('[data-unscheduled-sort]'));
    elements.excludedPanel = document.getElementById('excludedPanel');
    elements.excludedTableCount = document.getElementById('excludedTableCount');
    elements.excludedTableBody = document.getElementById('excludedTableBody');
    elements.excludedSortButtons = Array.from(document.querySelectorAll('[data-excluded-sort]'));
    elements.previousRangeButton = document.getElementById('previousRangeButton');
    elements.nextRangeButton = document.getElementById('nextRangeButton');
    elements.todayButton = document.getElementById('todayButton');
    elements.rangeLabel = document.getElementById('rangeLabel');
    elements.zoomButtons = Array.from(document.querySelectorAll('[data-zoom]'));
  }

  function bindEvents() {
    elements.refreshButton.addEventListener('click', loadIssues);
    elements.searchInput.addEventListener('input', renderFilteredData);
    elements.projectFilter.addEventListener('change', renderFilteredData);
    elements.assigneeFilter.addEventListener('change', renderFilteredData);
    elements.statusFilter.addEventListener('change', renderFilteredData);
    elements.resetFiltersButton.addEventListener('click', resetFilters);
    elements.toggleExcludedButton.addEventListener('click', toggleExcludedVisibility);
    elements.unscheduledSortButtons.forEach(function(button) {
      button.addEventListener('click', function() {
        setUnscheduledSort(button.dataset.unscheduledSort);
      });
    });
    elements.excludedSortButtons.forEach(function(button) {
      button.addEventListener('click', function() {
        setExcludedSort(button.dataset.excludedSort);
      });
    });
    elements.previousRangeButton.addEventListener('click', function() { moveRange(-1); });
    elements.nextRangeButton.addEventListener('click', function() { moveRange(1); });
    elements.todayButton.addEventListener('click', function() {
      state.anchorDate = new Date();
      applyTimelineWindow(true, true);
    });
    elements.zoomButtons.forEach(function(button) {
      button.addEventListener('click', function() {
        state.zoom = button.dataset.zoom;
        elements.zoomButtons.forEach(function(item) {
          const isActive = item === button;
          item.classList.toggle('is-active', isActive);
          item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
        applyTimelineWindow(true, isTodayAnchor());
      });
    });
  }

  async function loadIssues() {
    setLoading(true);
    hideSetupGuide();
    setStatus('loading', 'Jira 통합 일정을 불러오는 중입니다.', true);

    try {
      const payload = state.demoMode
        ? buildDemoPayload()
        : await callJiraTimelineApi('getJiraTimelineIssues', {}, 'POST');

      if (!payload || payload.enabled === false) {
        state.issues = [];
        populateFilters();
        renderFilteredData();
        showSetupGuide(payload || {});
        setStatus('warning', (payload && payload.meta && payload.meta.message) || 'Jira 연동 설정이 필요합니다.');
        elements.lastUpdated.innerHTML = '<i class="fa-regular fa-clock"></i> 연동 대기';
        return;
      }

      state.issues = Array.isArray(payload.issues) ? payload.issues : [];
      populateFilters();
      renderFilteredData();

      const meta = payload.meta || {};
      const fetchedAt = meta.fetchedAt ? formatDateTime(meta.fetchedAt) : formatDateTime(new Date());
      elements.lastUpdated.innerHTML = '<i class="fa-regular fa-clock"></i> ' + escapeHtml(fetchedAt) +
        (meta.cached ? ' · 캐시' : '');

      if (state.demoMode) {
        setStatus('success', '샘플 데이터로 화면을 확인하고 있습니다. 실제 Jira 데이터는 포함되지 않습니다.');
      } else if (meta.truncated) {
        setStatus('warning', '조회 한도까지 불러왔습니다. 일부 Jira Issue가 표시되지 않았을 수 있습니다.');
      } else if (!meta.startDateFieldFound) {
        setStatus('warning', 'Jira Issue ' + state.issues.length + '건을 조회했습니다. Start date 필드는 찾지 못해 기한 중심으로 표시합니다.');
      } else {
        setStatus('success', '5개 프로젝트의 진행 중 Jira Issue ' + state.issues.length + '건을 불러왔습니다.');
      }
    } catch (error) {
      console.error('Jira timeline load error:', error);
      state.issues = [];
      populateFilters();
      renderFilteredData();
      const errorMessage = normalizeErrorMessage(error);
      setStatus('error', errorMessage);
      showSetupGuide({ missingProperties: ['JIRA_TIMELINE_API_URL'] });
      elements.lastUpdated.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 조회 실패';
    } finally {
      setLoading(false);
    }
  }

  async function initializeJiraTimeline() {
    setLoading(true);
    setStatus('loading', 'Jira 조회 설정을 확인하고 있습니다.', true);
    try {
      state.publicConfig = await callJiraTimelineApi('getJiraTimelinePublicConfig', {}, 'GET');
      if (!state.publicConfig || state.publicConfig.enabled === false || state.publicConfig.configured === false) {
        showSetupGuide(state.publicConfig || {});
        setStatus('warning', 'Jira 조회 전용 연동 설정이 아직 완료되지 않았습니다.');
        return;
      }

      await loadIssues();
    } catch (error) {
      const message = normalizeErrorMessage(error);
      setStatus('error', message);
      showSetupGuide({ missingProperties: ['JIRA_TIMELINE_API_URL'] });
    } finally {
      setLoading(false);
    }
  }

  async function callJiraTimelineApi(action, data, method) {
    const apiUrl = CONFIG.JIRA_TIMELINE_API_URL;
    if (!apiUrl) {
      throw new Error('Jira 조회 전용 API 주소가 아직 설정되지 않았습니다.');
    }

    const requestMethod = method || 'POST';
    const url = requestMethod === 'GET'
      ? apiUrl + '?action=' + encodeURIComponent(action)
      : apiUrl;
    const options = requestMethod === 'GET'
      ? { method: 'GET', mode: 'cors' }
      : {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: action, data: data || {} })
        };
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('Jira 조회 서버 응답 오류 (' + response.status + ')');
    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (error) {
      throw new Error('Jira 조회 전용 API 배포 설정을 확인해 주세요.');
    }
    if (!result.success) throw new Error(result.error || 'Jira 일정 조회에 실패했습니다.');
    return result.data;
  }

  function populateFilters() {
    const selectedProject = elements.projectFilter.value;
    const selectedAssignee = elements.assigneeFilter.value;
    const selectedStatus = elements.statusFilter.value;

    elements.projectFilter.innerHTML = '<option value="">전체 프로젝트</option>' +
      Object.keys(PROJECTS).map(function(key) {
        return '<option value="' + key + '">' + key + ' · ' + escapeHtml(PROJECTS[key].name) + '</option>';
      }).join('');

    const assignees = uniqueSorted(state.issues.map(function(issue) { return issue.assignee || '미지정'; }));
    elements.assigneeFilter.innerHTML = '<option value="">전체 담당자</option>' +
      assignees.map(function(name) {
        return '<option value="' + escapeAttribute(name) + '">' + escapeHtml(name) + '</option>';
      }).join('');

    const statuses = uniqueSorted(state.issues.map(function(issue) { return issue.status; }).filter(Boolean));
    elements.statusFilter.innerHTML = '<option value="">전체 상태</option>' +
      statuses.map(function(status) {
        return '<option value="' + escapeAttribute(status) + '">' + escapeHtml(status) + '</option>';
      }).join('');

    if (Array.from(elements.projectFilter.options).some(function(option) { return option.value === selectedProject; })) {
      elements.projectFilter.value = selectedProject;
    }
    if (Array.from(elements.assigneeFilter.options).some(function(option) { return option.value === selectedAssignee; })) {
      elements.assigneeFilter.value = selectedAssignee;
    }
    if (Array.from(elements.statusFilter.options).some(function(option) { return option.value === selectedStatus; })) {
      elements.statusFilter.value = selectedStatus;
    }
  }

  function renderFilteredData() {
    const issues = getFilteredIssues();
    const excluded = issues.filter(isTimelineExcluded);
    const activeIssues = issues.filter(function(issue) { return !isTimelineExcluded(issue); });
    const scheduled = activeIssues.filter(hasAnySchedule);
    const unscheduled = activeIssues.filter(function(issue) { return !hasAnySchedule(issue); });
    const overdue = activeIssues.filter(isOverdue);

    elements.totalCount.textContent = activeIssues.length.toLocaleString('ko-KR');
    elements.scheduledCount.textContent = scheduled.length.toLocaleString('ko-KR');
    elements.unscheduledCount.textContent = unscheduled.length.toLocaleString('ko-KR');
    elements.overdueCount.textContent = overdue.length.toLocaleString('ko-KR');
    elements.timelineCount.textContent = scheduled.length.toLocaleString('ko-KR') + '건';
    elements.unscheduledTableCount.textContent = unscheduled.length.toLocaleString('ko-KR') + '건';
    elements.excludedTableCount.textContent = excluded.length.toLocaleString('ko-KR') + '건';

    renderTimeline(scheduled);
    renderUnscheduledTable(unscheduled);
    renderExcludedTable(excluded);
    renderExcludedVisibility(excluded.length);
  }

  function getFilteredIssues() {
    const keyword = elements.searchInput.value.trim().toLowerCase();
    const project = elements.projectFilter.value;
    const assignee = elements.assigneeFilter.value;
    const status = elements.statusFilter.value;

    return state.issues.filter(function(issue) {
      if (project && issue.projectKey !== project) return false;
      if (assignee && (issue.assignee || '미지정') !== assignee) return false;
      if (status && issue.status !== status) return false;
      if (keyword) {
        const haystack = [issue.key, issue.summary, issue.assignee, issue.status, issue.projectName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (haystack.indexOf(keyword) === -1) return false;
      }
      return true;
    });
  }

  function renderTimeline(issues) {
    if (!window.vis || !window.vis.Timeline || !window.vis.DataSet) {
      elements.timelineContainer.style.display = 'none';
      elements.timelineEmpty.classList.add('is-visible');
      elements.timelineEmpty.querySelector('strong').textContent = '타임라인 라이브러리를 불러오지 못했습니다.';
      return;
    }

    const projectKeys = uniqueSorted(issues.map(function(issue) { return issue.projectKey; }))
      .sort(function(a, b) {
        return (PROJECTS[a] ? PROJECTS[a].order : 999) - (PROJECTS[b] ? PROJECTS[b].order : 999);
      });
    const groups = projectKeys.map(createTimelineGroup);
    const items = issues
      .slice()
      .sort(sortIssuesBySchedule)
      .map(createTimelineItem)
      .filter(Boolean);

    elements.timelineContainer.style.display = items.length ? 'block' : 'none';
    elements.timelineEmpty.classList.toggle('is-visible', items.length === 0);

    if (!items.length) {
      if (state.timeline) {
        state.timeline.destroy();
        state.timeline = null;
      }
      return;
    }

    const data = {
      groups: new vis.DataSet(groups),
      items: new vis.DataSet(items)
    };
    const initialRange = getVisibleRange(isTodayAnchor());
    const options = {
      editable: false,
      selectable: true,
      multiselect: false,
      stack: true,
      showCurrentTime: true,
      orientation: { axis: 'top', item: 'top' },
      horizontalScroll: true,
      zoomKey: 'ctrlKey',
      zoomMin: 1000 * 60 * 60 * 24 * 7,
      zoomMax: 1000 * 60 * 60 * 24 * 366 * 2,
      start: initialRange.start,
      end: initialRange.end,
      margin: { item: 8, axis: 12 },
      groupOrder: function(a, b) { return a.order - b.order; }
    };

    if (state.timeline) state.timeline.destroy();
    state.timeline = new vis.Timeline(elements.timelineContainer, data.items, data.groups, options);
    state.timeline.on('select', function(event) {
      if (!event.items || !event.items.length) return;
      const issue = state.issues.find(function(item) { return item.key === event.items[0]; });
      if (issue && issue.url) window.open(issue.url, '_blank', 'noopener,noreferrer');
    });
    state.timeline.on('rangechanged', function(event) {
      if (!event.byUser) return;
      state.anchorDate = new Date((event.start.getTime() + event.end.getTime()) / 2);
      updateRangeLabel();
    });
    updateRangeLabel();
  }

  function createTimelineGroup(projectKey) {
    const project = PROJECTS[projectKey] || { name: projectKey, description: projectKey, order: 999 };
    const label = document.createElement('div');
    label.className = 'jira-group-label';

    const dot = document.createElement('span');
    dot.className = 'jira-group-dot';

    const copy = document.createElement('span');
    copy.className = 'jira-group-copy';

    const name = document.createElement('span');
    name.className = 'jira-group-name';
    name.textContent = project.name;

    const key = document.createElement('span');
    key.className = 'jira-group-key';
    key.textContent = projectKey;

    copy.append(name, key);
    label.append(dot, copy);
    return {
      id: projectKey,
      order: project.order,
      className: projectClass(projectKey),
      content: label
    };
  }

  function createTimelineItem(issue) {
    const startDate = parseDate(issue.startDate);
    const dueDate = parseDate(issue.dueDate);
    const displayDate = startDate || dueDate;
    if (!displayDate) return null;

    const hasRange = Boolean(startDate && dueDate && startDate <= dueDate);
    const dateLabel = hasRange
      ? formatDate(issue.startDate) + ' ~ ' + formatDate(issue.dueDate)
      : startDate
        ? formatDate(issue.startDate) + ' · 종료일 미정'
        : formatDate(issue.dueDate) + ' · 시작일 미정';
    const content = document.createElement('div');
    content.className = 'jira-item-content';

    const key = document.createElement('span');
    key.className = 'jira-item-key';
    key.textContent = issue.key;

    const summary = document.createElement('span');
    summary.className = 'jira-item-summary';
    summary.textContent = issue.summary;

    content.append(key, summary);
    const item = {
      id: issue.key,
      group: issue.projectKey,
      start: displayDate,
      type: hasRange ? 'range' : 'point',
      className: 'jira-timeline-item ' + projectClass(issue.projectKey) + (hasRange ? '' : ' jira-timeline-point'),
      content: content,
      title: '<strong>' + escapeHtml(issue.key + ' · ' + issue.summary) + '</strong><br>' +
        escapeHtml(dateLabel) + '<br>' + escapeHtml((issue.status || '-') + ' · ' + (issue.assignee || '미지정'))
    };
    if (hasRange) item.end = addDays(dueDate, 1);
    return item;
  }

  function renderUnscheduledTable(issues) {
    updateSortHeaders(elements.unscheduledSortButtons, state.unscheduledSort);
    if (!issues.length) {
      elements.unscheduledTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:28px">일정 미지정 업무가 없습니다.</td></tr>';
      return;
    }

    elements.unscheduledTableBody.innerHTML = renderIssueRows(sortIssueRows(issues, state.unscheduledSort), false);
  }

  function renderExcludedTable(issues) {
    updateSortHeaders(elements.excludedSortButtons, state.excludedSort);
    if (!issues.length) {
      elements.excludedTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:28px">일정에서 제외된 업무가 없습니다.</td></tr>';
      return;
    }

    elements.excludedTableBody.innerHTML = renderIssueRows(sortIssueRows(issues, state.excludedSort), true);
  }

  function renderIssueRows(issues, excluded) {
    return issues.map(function(issue) {
      const projectKey = issue.projectKey || '-';
      const issueUrl = escapeAttribute(issue.url || '#');
      return '<tr>' +
        '<td><a class="jira-issue-link" href="' + issueUrl + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(issue.key) + '</a></td>' +
        '<td><span class="jira-pill jira-project-pill ' + projectClass(projectKey) + '">' + escapeHtml(projectKey) + '</span></td>' +
        '<td><a class="jira-title-link" href="' + issueUrl + '" target="_blank" rel="noopener noreferrer" title="Jira에서 새 탭으로 열기">' +
          '<span>' + escapeHtml(issue.summary || '-') + '</span><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a></td>' +
        '<td><span class="jira-pill">' + escapeHtml(issue.status || '-') + '</span></td>' +
        '<td>' + escapeHtml(issue.assignee || '미지정') + '</td>' +
        '<td>' + escapeHtml(formatDateTime(issue.updated)) + '</td>' +
        '<td><span class="jira-pill jira-schedule-pill ' + (excluded ? 'excluded' : 'unscheduled') + '">' +
          (excluded ? '일정 제외' : '미지정') + '</span></td>' +
        '</tr>';
    }).join('');
  }

  function setUnscheduledSort(key) {
    updateSortState(state.unscheduledSort, key);
    renderFilteredData();
  }

  function setExcludedSort(key) {
    updateSortState(state.excludedSort, key);
    renderFilteredData();
  }

  function toggleExcludedVisibility() {
    state.showExcluded = !state.showExcluded;
    try {
      window.localStorage.setItem(EXCLUDED_VISIBILITY_KEY, state.showExcluded ? 'true' : 'false');
    } catch (error) {
      // 저장이 제한된 브라우저에서도 현재 화면의 토글은 그대로 동작합니다.
    }
    renderExcludedVisibility(getFilteredIssues().filter(isTimelineExcluded).length);
  }

  function renderExcludedVisibility(count) {
    const hasExcludedIssues = count > 0;
    const isVisible = hasExcludedIssues && state.showExcluded;
    const icon = elements.toggleExcludedButton.querySelector('i');
    elements.toggleExcludedButton.disabled = !hasExcludedIssues;
    elements.toggleExcludedButton.classList.toggle('is-active', isVisible);
    elements.toggleExcludedButton.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
    elements.toggleExcludedButton.setAttribute('aria-label', isVisible
      ? '일정 제외 업무 목록 숨기기'
      : '일정 제외 업무 ' + count.toLocaleString('ko-KR') + '건 보기');
    elements.excludedToggleLabel.textContent = isVisible
      ? '일정 제외 숨기기'
      : '일정 제외 ' + count.toLocaleString('ko-KR') + '건 보기';
    elements.excludedPanel.hidden = !isVisible;
    if (icon) icon.className = isVisible ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
  }

  function updateSortState(sortState, key) {
    if (sortState.key === key) {
      sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
      sortState.key = key;
      sortState.direction = key === 'updated' ? 'desc' : 'asc';
    }
  }

  function sortIssueRows(issues, sortState) {
    const key = sortState.key;
    if (!key) return issues.slice();
    const direction = sortState.direction === 'desc' ? -1 : 1;
    return issues.slice().sort(function(left, right) {
      if (key === 'updated') {
        const leftTime = Date.parse(left.updated || '') || 0;
        const rightTime = Date.parse(right.updated || '') || 0;
        return (leftTime - rightTime) * direction;
      }
      const leftValue = getIssueSortValue(left, key);
      const rightValue = getIssueSortValue(right, key);
      return leftValue.localeCompare(rightValue, 'ko', {
        numeric: true,
        sensitivity: 'base'
      }) * direction;
    });
  }

  function getIssueSortValue(issue, key) {
    if (key === 'scheduleType') return isTimelineExcluded(issue) ? '일정 제외' : '미지정';
    return String(issue[key] || '').trim();
  }

  function updateSortHeaders(buttons, sortState) {
    buttons.forEach(function(button) {
      const sortKey = button.dataset.unscheduledSort || button.dataset.excludedSort;
      const isActive = sortKey === sortState.key;
      const header = button.closest('th');
      const icon = button.querySelector('i');
      button.classList.toggle('is-active', isActive);
      if (header) {
        header.setAttribute('aria-sort', isActive
          ? (sortState.direction === 'asc' ? 'ascending' : 'descending')
          : 'none');
      }
      if (icon) {
        icon.className = 'fa-solid ' + (isActive
          ? (sortState.direction === 'asc' ? 'fa-sort-up' : 'fa-sort-down')
          : 'fa-sort');
      }
    });
  }

  function resetFilters() {
    elements.searchInput.value = '';
    elements.projectFilter.value = '';
    elements.assigneeFilter.value = '';
    elements.statusFilter.value = '';
    renderFilteredData();
  }

  function moveRange(direction) {
    const next = new Date(state.anchorDate);
    next.setDate(1);
    next.setMonth(next.getMonth() + direction * (state.zoom === 'quarter' ? 3 : 1));
    state.anchorDate = next;
    applyTimelineWindow(true);
  }

  function applyTimelineWindow(animate, alignTodayToLeft) {
    const range = getVisibleRange(Boolean(alignTodayToLeft));
    updateRangeLabel();
    if (state.timeline) {
      state.timeline.setWindow(range.start, range.end, { animation: animate ? { duration: 260 } : false });
    }
  }

  function getVisibleRange(alignTodayToLeft) {
    const year = state.anchorDate.getFullYear();
    const month = state.anchorDate.getMonth();
    if (alignTodayToLeft) {
      const start = new Date(state.anchorDate);
      start.setHours(0, 0, 0, 0);
      const leadingDays = state.zoom === 'quarter' ? 10 : 3;
      const visibleDays = state.zoom === 'quarter' ? 92 : 31;
      start.setDate(start.getDate() - leadingDays);
      return {
        start: start,
        end: addDays(start, visibleDays)
      };
    }
    if (state.zoom === 'quarter') {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      return {
        start: new Date(year, quarterStartMonth, 1),
        end: new Date(year, quarterStartMonth + 3, 1)
      };
    }
    return {
      start: new Date(year, month, 1),
      end: new Date(year, month + 1, 1)
    };
  }

  function isTodayAnchor() {
    const today = new Date();
    return state.anchorDate.getFullYear() === today.getFullYear() &&
      state.anchorDate.getMonth() === today.getMonth() &&
      state.anchorDate.getDate() === today.getDate();
  }

  function updateRangeLabel() {
    const year = state.anchorDate.getFullYear();
    const month = state.anchorDate.getMonth();
    elements.rangeLabel.textContent = state.zoom === 'quarter'
      ? year + '년 ' + (Math.floor(month / 3) + 1) + '분기'
      : year + '년 ' + (month + 1) + '월';
  }

  function showSetupGuide(payload) {
    const missing = Array.isArray(payload.missingProperties) ? payload.missingProperties.slice() : [];
    if (missing.indexOf('JIRA_TIMELINE_WEB_ENABLED=true') === -1) {
      missing.push('JIRA_TIMELINE_WEB_ENABLED=true');
    }
    elements.missingProperties.innerHTML = missing.map(function(name) {
      return '<code>' + escapeHtml(name) + '</code>';
    }).join('');
    elements.setupGuide.classList.add('is-visible');
  }

  function hideSetupGuide() {
    elements.setupGuide.classList.remove('is-visible');
  }

  function setStatus(type, message, spinner) {
    const icon = spinner
      ? 'fa-solid fa-circle-notch fa-spin'
      : type === 'success'
        ? 'fa-regular fa-circle-check'
        : type === 'warning'
          ? 'fa-solid fa-triangle-exclamation'
          : type === 'error'
            ? 'fa-regular fa-circle-xmark'
            : 'fa-solid fa-circle-info';
    elements.status.dataset.state = type;
    elements.status.innerHTML = '<i class="' + icon + '" aria-hidden="true"></i><span>' + escapeHtml(message) + '</span>';
  }

  function setLoading(isLoading) {
    elements.refreshButton.disabled = isLoading;
    const icon = elements.refreshButton.querySelector('i');
    if (icon) icon.classList.toggle('fa-spin', isLoading);
  }

  function hasAnySchedule(issue) {
    return Boolean(parseDate(issue.startDate) || parseDate(issue.dueDate));
  }

  function isTimelineExcluded(issue) {
    return Array.isArray(issue.labels) && issue.labels.some(function(label) {
      return String(label || '').trim() === EXCLUDED_LABEL;
    });
  }

  function readExcludedVisibility() {
    try {
      return window.localStorage.getItem(EXCLUDED_VISIBILITY_KEY) === 'true';
    } catch (error) {
      return false;
    }
  }

  function isOverdue(issue) {
    const dueDate = parseDate(issue.dueDate);
    if (!dueDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueDate < today && (issue.statusCategoryKey || '').toLowerCase() !== 'done';
  }

  function sortIssuesBySchedule(a, b) {
    const aDate = parseDate(a.startDate) || parseDate(a.dueDate) || new Date(8640000000000000);
    const bDate = parseDate(b.startDate) || parseDate(b.dueDate) || new Date(8640000000000000);
    return aDate - bDate || String(a.key).localeCompare(String(b.key));
  }

  function parseDate(value) {
    if (!value) return null;
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  function formatDate(value) {
    const date = parseDate(value);
    if (!date) return '-';
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  function projectClass(projectKey) {
    return 'project-' + String(projectKey || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort(function(a, b) {
      return String(a).localeCompare(String(b), 'ko');
    });
  }

  function normalizeErrorMessage(error) {
    const message = error && error.message ? error.message : String(error || '알 수 없는 오류');
    if (message.indexOf('Invalid post action') !== -1 || message.indexOf('API execution failed') !== -1) {
      return '현재 배포된 Apps Script에 Jira 통합 일정 API가 없습니다. 백엔드 배포 후 다시 조회해 주세요.';
    }
    return message.replace(/^Error:\s*/, '');
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }

  function buildDemoPayload() {
    const base = new Date();
    base.setDate(1);
    base.setHours(0, 0, 0, 0);
    const date = function(offset) {
      const result = addDays(base, offset);
      return result.getFullYear() + '-' + String(result.getMonth() + 1).padStart(2, '0') + '-' + String(result.getDate()).padStart(2, '0');
    };
    const updated = new Date().toISOString();
    const raw = [
      ['C21R-196', 'CMS 정기 업데이트 배포 준비', 'C21R', '진행 중', '안태민', date(1), date(8)],
      ['C21R-197', '성적서 화면 개선 및 검증', 'C21R', '개발 중', '박진희', date(6), date(18)],
      ['CW2R-148', 'CWIZ 2.0 고객사 검색 개선', 'CW2R', '진행 중', '이가은', date(10), date(24)],
      ['CW2R-152', '모바일 CMS 일정 조회 기능', 'CW2R', '접수대기', '안태민', '', date(27)],
      ['CWIZ-391', 'CWIZ 1.0 유지보수 정기 반영', 'CWIZ', '검토 중', '고세종', date(3), date(13)],
      ['ITM-564', 'IT전략실 통합 일정 구축', 'ITM', '진행 중', '안태민', date(2), date(25)],
      ['ITM-570', '운영현황 지표 개선', 'ITM', '진행 중', '이광희', date(-3), date(1)],
      ['ITM-588', '기간을 지정하지 않는 상시 운영 업무', 'ITM', '접수대기', '미지정', '', '', [EXCLUDED_LABEL]],
      ['ITM-590', '신규 장비 도입 검토', 'ITM', '접수대기', '미지정', '', '', []],
      ['WWWMR-84', '홈페이지 자료실 개선', 'WWWMR', '개발 중', '권순길', date(15), date(29)],
      ['WWWMR-89', '메인 배너 교체', 'WWWMR', '검토 중', '최늬혜', date(21), '']
    ];
    return {
      enabled: true,
      configured: false,
      issues: raw.map(function(item, index) {
        return {
          id: String(index + 1),
          key: item[0],
          summary: item[1],
          projectKey: item[2],
          projectName: PROJECTS[item[2]].description,
          status: item[3],
          statusCategory: 'In Progress',
          statusCategoryKey: 'indeterminate',
          assignee: item[4],
          startDate: item[5],
          dueDate: item[6],
          labels: Array.isArray(item[7]) ? item[7] : [],
          issueType: '작업',
          priority: 'Medium',
          reporter: '샘플 사용자',
          updated: updated,
          parentKey: '',
          parentSummary: '',
          url: 'https://kic-itsd.atlassian.net/browse/' + item[0]
        };
      }),
      meta: {
        fetchedAt: updated,
        cached: false,
        startDateFieldFound: true,
        projectKeys: Object.keys(PROJECTS),
        total: raw.length,
        demo: true
      }
    };
  }
})();
