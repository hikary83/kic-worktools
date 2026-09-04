/**
 * IT전략실 Jira 통합 일정
 * - Jira는 조회만 하며 수정은 원본 Issue 화면에서 수행합니다.
 * - 로컬 UI 확인은 jira-timeline.html?demo=1 로 실행할 수 있습니다.
 */
(function initJiraTimelinePage() {
  'use strict';

  const DEFAULT_PROJECTS = [
    { key: 'C21R', name: 'CMS', enabled: true },
    { key: 'CW2R', name: 'CWIZ 2.0', enabled: true },
    { key: 'CWIZ', name: 'CWIZ 1.0', enabled: true },
    { key: 'ITM', name: 'IT 업무', enabled: true },
    { key: 'WWWMR', name: '홈페이지', enabled: true }
  ];
  const PROJECT_COLORS = ['#10a37f', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#f97316', '#84cc16'];
  const EXCLUDED_LABEL = '일정제외';

  const state = {
    issues: [],
    projects: cloneProjects(DEFAULT_PROJECTS),
    projectSettingsDraft: [],
    availableProjects: [],
    projectCatalogLoaded: false,
    timeline: null,
    anchorDate: new Date(),
    zoom: 'month',
    demoMode: new URLSearchParams(window.location.search).get('demo') === '1',
    publicConfig: null,
    unscheduledSort: { key: '', direction: 'asc' },
    unscheduledFilters: { projectKey: '', status: '', assignee: '', scheduleType: 'unscheduled' }
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
    elements.projectScopeSummary = document.getElementById('projectScopeSummary');
    elements.projectLegend = document.getElementById('projectLegend');
    elements.usageGuideButton = document.getElementById('usageGuideButton');
    elements.projectSettingsButton = document.getElementById('projectSettingsButton');
    elements.usageGuideModal = document.getElementById('usageGuideModal');
    elements.projectSettingsModal = document.getElementById('projectSettingsModal');
    elements.projectSettingsList = document.getElementById('projectSettingsList');
    elements.addProjectButton = document.getElementById('addProjectButton');
    elements.saveProjectSettingsButton = document.getElementById('saveProjectSettingsButton');
    elements.timelineContainer = document.getElementById('jiraTimeline');
    elements.timelineEmpty = document.getElementById('timelineEmpty');
    elements.timelineCount = document.getElementById('timelineCount');
    elements.totalCount = document.getElementById('totalCount');
    elements.scheduledCount = document.getElementById('scheduledCount');
    elements.unscheduledCount = document.getElementById('unscheduledCount');
    elements.overdueCount = document.getElementById('overdueCount');
    elements.unscheduledPanel = document.getElementById('unscheduledPanel');
    elements.unscheduledTableCount = document.getElementById('unscheduledTableCount');
    elements.excludedCountBadge = document.getElementById('excludedCountBadge');
    elements.unscheduledTableBody = document.getElementById('unscheduledTableBody');
    elements.unscheduledSortButtons = Array.from(document.querySelectorAll('[data-unscheduled-sort]'));
    elements.unscheduledProjectFilter = document.getElementById('unscheduledProjectFilter');
    elements.unscheduledStatusFilter = document.getElementById('unscheduledStatusFilter');
    elements.unscheduledAssigneeFilter = document.getElementById('unscheduledAssigneeFilter');
    elements.unscheduledScheduleFilter = document.getElementById('unscheduledScheduleFilter');
    elements.unscheduledColumnFilters = [
      elements.unscheduledProjectFilter,
      elements.unscheduledStatusFilter,
      elements.unscheduledAssigneeFilter,
      elements.unscheduledScheduleFilter
    ];
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
    elements.unscheduledColumnFilters.forEach(function(select) {
      select.addEventListener('change', function() {
        syncUnscheduledFilterState();
        renderFilteredData();
        select.blur();
      });
    });
    elements.usageGuideButton.addEventListener('click', function() { openModal(elements.usageGuideModal); });
    elements.projectSettingsButton.addEventListener('click', openProjectSettings);
    document.querySelectorAll('[data-close-jira-modal]').forEach(function(button) {
      button.addEventListener('click', function() { closeModal(button.closest('.kic-modal-backdrop')); });
    });
    elements.addProjectButton.addEventListener('click', addProjectSettingRow);
    elements.saveProjectSettingsButton.addEventListener('click', saveProjectSettings);
    elements.projectSettingsList.addEventListener('input', updateProjectSettingsDraft);
    elements.projectSettingsList.addEventListener('change', updateProjectSettingsDraft);
    elements.projectSettingsList.addEventListener('click', handleProjectSettingsAction);
    elements.unscheduledSortButtons.forEach(function(button) {
      button.addEventListener('click', function() {
        setUnscheduledSort(button.dataset.unscheduledSort);
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
        populateUnscheduledFilters();
        renderFilteredData();
        showSetupGuide(payload || {});
        setStatus('warning', (payload && payload.meta && payload.meta.message) || 'Jira 연동 설정이 필요합니다.');
        elements.lastUpdated.innerHTML = '<i class="fa-regular fa-clock"></i> 연동 대기';
        return;
      }

      applyProjectConfig((payload.meta && payload.meta.projects) || payload.projects || state.projects);
      state.issues = Array.isArray(payload.issues) ? payload.issues : [];
      populateFilters();
      populateUnscheduledFilters();
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
        setStatus('success', getActiveProjects().length + '개 프로젝트의 진행 중 Jira Issue ' + state.issues.length + '건을 불러왔습니다.');
      }
    } catch (error) {
      console.error('Jira timeline load error:', error);
      state.issues = [];
      populateFilters();
      populateUnscheduledFilters();
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
      applyProjectConfig(state.publicConfig && state.publicConfig.projects);
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
      getActiveProjects().map(function(project) {
        return '<option value="' + escapeAttribute(project.key) + '">' + escapeHtml(project.key + ' · ' + project.name) + '</option>';
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

  function populateUnscheduledFilters() {
    const candidates = state.issues.filter(function(issue) {
      return !hasAnySchedule(issue) || isTimelineExcluded(issue);
    });
    setSelectOptions(
      elements.unscheduledProjectFilter,
      [{ value: '', label: '전체 프로젝트' }].concat(getActiveProjects().map(function(project) {
        return { value: project.key, label: project.name };
      })),
      state.unscheduledFilters.projectKey
    );
    setSelectOptions(
      elements.unscheduledStatusFilter,
      [{ value: '', label: '전체 상태' }].concat(uniqueSorted(candidates.map(function(issue) { return issue.status; })).map(function(status) {
        return { value: status, label: status };
      })),
      state.unscheduledFilters.status
    );
    setSelectOptions(
      elements.unscheduledAssigneeFilter,
      [{ value: '', label: '전체 담당자' }].concat(uniqueSorted(candidates.map(function(issue) { return issue.assignee || '미지정'; })).map(function(assignee) {
        return { value: assignee, label: assignee };
      })),
      state.unscheduledFilters.assignee
    );
    syncUnscheduledFilterState();
  }

  function setSelectOptions(select, options, selectedValue) {
    select.innerHTML = options.map(function(option) {
      return '<option value="' + escapeAttribute(option.value) + '">' + escapeHtml(option.label) + '</option>';
    }).join('');
    if (Array.from(select.options).some(function(option) { return option.value === selectedValue; })) {
      select.value = selectedValue;
    }
  }

  function syncUnscheduledFilterState() {
    state.unscheduledFilters.projectKey = elements.unscheduledProjectFilter.value;
    state.unscheduledFilters.status = elements.unscheduledStatusFilter.value;
    state.unscheduledFilters.assignee = elements.unscheduledAssigneeFilter.value;
    state.unscheduledFilters.scheduleType = elements.unscheduledScheduleFilter.value || 'unscheduled';
  }

  function filterUnscheduledIssues(issues) {
    const filters = state.unscheduledFilters;
    return issues.filter(function(issue) {
      const excluded = isTimelineExcluded(issue);
      if (filters.projectKey && issue.projectKey !== filters.projectKey) return false;
      if (filters.status && issue.status !== filters.status) return false;
      if (filters.assignee && (issue.assignee || '미지정') !== filters.assignee) return false;
      if (filters.scheduleType === 'unscheduled' && excluded) return false;
      if (filters.scheduleType === 'excluded' && !excluded) return false;
      return true;
    });
  }

  function updateColumnFilterStyles() {
    elements.unscheduledColumnFilters.forEach(function(select) {
      const isScheduleFilter = select === elements.unscheduledScheduleFilter;
      const isActive = isScheduleFilter ? select.value !== 'all' : Boolean(select.value);
      const wrapper = select.closest('.jira-column-filter');
      if (wrapper) wrapper.classList.toggle('is-active', isActive);
    });
  }

  function renderFilteredData() {
    const issues = getFilteredIssues();
    const excluded = issues.filter(isTimelineExcluded);
    const activeIssues = issues.filter(function(issue) { return !isTimelineExcluded(issue); });
    const scheduled = activeIssues.filter(hasAnySchedule);
    const unscheduled = activeIssues.filter(function(issue) { return !hasAnySchedule(issue); });
    const overdue = activeIssues.filter(isOverdue);
    const displayedUnscheduled = filterUnscheduledIssues(unscheduled.concat(excluded));

    elements.totalCount.textContent = activeIssues.length.toLocaleString('ko-KR');
    elements.scheduledCount.textContent = scheduled.length.toLocaleString('ko-KR');
    elements.unscheduledCount.textContent = unscheduled.length.toLocaleString('ko-KR');
    elements.overdueCount.textContent = overdue.length.toLocaleString('ko-KR');
    elements.timelineCount.textContent = scheduled.length.toLocaleString('ko-KR') + '건';
    elements.unscheduledTableCount.textContent = displayedUnscheduled.length.toLocaleString('ko-KR') + '건';
    elements.excludedCountBadge.textContent = '일정 제외 ' + excluded.length.toLocaleString('ko-KR') + '건';

    renderTimeline(scheduled);
    renderUnscheduledTable(displayedUnscheduled);
    updateColumnFilterStyles();
  }

  function getFilteredIssues() {
    const keyword = elements.searchInput.value.trim().toLowerCase();
    const project = elements.projectFilter.value;
    const assignee = elements.assigneeFilter.value;
    const status = elements.statusFilter.value;

    return state.issues.filter(function(issue) {
      const configuredProject = getProjectDefinition(issue.projectKey);
      if (!configuredProject || !configuredProject.enabled) return false;
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
        return projectOrder(a) - projectOrder(b);
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
    const project = getProjectDefinition(projectKey) || { key: projectKey, name: projectKey, enabled: true };
    const color = projectColor(projectKey);
    const label = document.createElement('div');
    label.className = 'jira-group-label';
    label.style.setProperty('--project-color', color);

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
      order: projectOrder(projectKey),
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
      style: '--project-color:' + projectColor(issue.projectKey),
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

    elements.unscheduledTableBody.innerHTML = renderIssueRows(sortIssueRows(issues, state.unscheduledSort));
  }

  function renderIssueRows(issues) {
    return issues.map(function(issue) {
      const projectKey = issue.projectKey || '-';
      const project = getProjectDefinition(projectKey);
      const projectName = project ? project.name : projectKey;
      const issueUrl = escapeAttribute(issue.url || '#');
      const excluded = isTimelineExcluded(issue);
      return '<tr>' +
        '<td><a class="jira-issue-link" href="' + issueUrl + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(issue.key) + '</a></td>' +
        '<td><span class="jira-pill jira-project-pill ' + projectClass(projectKey) + '" style="--project-color:' + escapeAttribute(projectColor(projectKey)) + '" title="' + escapeAttribute(projectKey) + '">' + escapeHtml(projectName) + '</span></td>' +
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

  function openModal(modal) {
    if (!modal) return;
    modal.classList.remove('hidden');
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
  }

  async function openProjectSettings() {
    state.projectSettingsDraft = cloneProjects(state.projects);
    openModal(elements.projectSettingsModal);
    elements.addProjectButton.disabled = true;
    elements.projectSettingsList.innerHTML = '<div class="jira-project-catalog-status"><i class="fa-solid fa-circle-notch fa-spin"></i><span>Jira 프로젝트를 불러오는 중입니다.</span></div>';
    try {
      await loadAvailableProjects();
      renderProjectSettingsRows();
      elements.addProjectButton.disabled = false;
    } catch (error) {
      elements.projectSettingsList.innerHTML = '<div class="jira-project-catalog-status error"><i class="fa-solid fa-triangle-exclamation"></i><span>' + escapeHtml(normalizeErrorMessage(error)) + '</span></div>';
      notify(normalizeErrorMessage(error), 'error', 4200);
    }
  }

  function renderProjectSettingsRows() {
    elements.projectSettingsList.innerHTML = state.projectSettingsDraft.map(function(project, index) {
      const projectOptions = buildAvailableProjectOptions(project.key);
      return '<div class="jira-project-settings-row" data-project-index="' + index + '">' +
        '<label class="jira-project-enabled" title="조회 사용 여부"><input type="checkbox" data-project-field="enabled" ' + (project.enabled ? 'checked' : '') + ' aria-label="' + escapeAttribute((project.name || project.key || '새 프로젝트') + ' 사용 여부') + '"></label>' +
        '<select data-project-field="key" aria-label="Jira 프로젝트 선택">' + projectOptions + '</select>' +
        '<input type="text" data-project-field="name" value="' + escapeAttribute(project.name) + '" maxlength="40" placeholder="화면 표시명" aria-label="화면 표시명">' +
        '<div class="jira-project-order-actions">' +
          '<button class="jira-button" type="button" data-project-action="up" title="위로" aria-label="위로 이동" ' + (index === 0 ? 'disabled' : '') + '><i class="fa-solid fa-arrow-up"></i></button>' +
          '<button class="jira-button" type="button" data-project-action="down" title="아래로" aria-label="아래로 이동" ' + (index === state.projectSettingsDraft.length - 1 ? 'disabled' : '') + '><i class="fa-solid fa-arrow-down"></i></button>' +
          '<button class="jira-button remove" type="button" data-project-action="remove" title="목록에서 삭제" aria-label="프로젝트 삭제"><i class="fa-solid fa-trash"></i></button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function updateProjectSettingsDraft(event) {
    const row = event.target.closest('[data-project-index]');
    const field = event.target.dataset.projectField;
    if (!row || !field) return;
    const index = Number(row.dataset.projectIndex);
    const project = state.projectSettingsDraft[index];
    if (!project) return;
    project[field] = field === 'enabled' ? event.target.checked : event.target.value;
    if (field === 'key') {
      const selectedProject = getAvailableProjectDefinition(project.key);
      if (selectedProject) {
        project.name = selectedProject.name;
        const nameInput = row.querySelector('[data-project-field="name"]');
        if (nameInput) nameInput.value = selectedProject.name;
      }
    }
  }

  function handleProjectSettingsAction(event) {
    const button = event.target.closest('[data-project-action]');
    if (!button) return;
    const row = button.closest('[data-project-index]');
    const index = Number(row && row.dataset.projectIndex);
    const action = button.dataset.projectAction;
    if (!Number.isInteger(index)) return;
    if (action === 'up' && index > 0) {
      const previous = state.projectSettingsDraft[index - 1];
      state.projectSettingsDraft[index - 1] = state.projectSettingsDraft[index];
      state.projectSettingsDraft[index] = previous;
    } else if (action === 'down' && index < state.projectSettingsDraft.length - 1) {
      const next = state.projectSettingsDraft[index + 1];
      state.projectSettingsDraft[index + 1] = state.projectSettingsDraft[index];
      state.projectSettingsDraft[index] = next;
    } else if (action === 'remove') {
      state.projectSettingsDraft.splice(index, 1);
    }
    renderProjectSettingsRows();
  }

  function addProjectSettingRow() {
    const usedKeys = state.projectSettingsDraft.map(function(project) { return project.key; });
    const nextProject = state.availableProjects.find(function(project) {
      return usedKeys.indexOf(project.key) === -1;
    });
    if (!nextProject) {
      notify('추가할 수 있는 Jira 프로젝트가 없습니다.', 'info');
      return;
    }
    state.projectSettingsDraft.push({ key: nextProject.key, name: nextProject.name, enabled: true });
    renderProjectSettingsRows();
    const rows = elements.projectSettingsList.querySelectorAll('[data-project-index]');
    const lastRow = rows[rows.length - 1];
    if (lastRow) lastRow.querySelector('[data-project-field="name"]').focus();
  }

  async function loadAvailableProjects() {
    if (state.projectCatalogLoaded && state.availableProjects.length) return;
    let projects;
    if (state.demoMode) {
      projects = cloneProjects(DEFAULT_PROJECTS).concat([
        { key: 'KICOPS', name: 'KIC 운영 업무' },
        { key: 'SEC', name: '정보보안 업무' }
      ]);
    } else {
      const result = await callJiraTimelineApi('getJiraTimelineProjects', {}, 'POST');
      projects = result && result.projects;
    }
    state.availableProjects = mergeAvailableProjects(projects);
    if (!state.availableProjects.length) throw new Error('Jira에서 선택 가능한 프로젝트를 찾지 못했습니다.');
    state.projectCatalogLoaded = true;
  }

  function mergeAvailableProjects(projects) {
    const merged = [];
    const seen = {};
    (Array.isArray(projects) ? projects : []).concat(state.projects).forEach(function(project) {
      const key = String(project && project.key || '').trim().toUpperCase();
      const name = String(project && (project.name || project.key) || '').trim();
      if (!key || !name || seen[key]) return;
      seen[key] = true;
      merged.push({ key: key, name: name });
    });
    return merged.sort(function(left, right) {
      return left.name.localeCompare(right.name, 'ko') || left.key.localeCompare(right.key);
    });
  }

  function buildAvailableProjectOptions(selectedKey) {
    const options = state.availableProjects.slice();
    if (selectedKey && !options.some(function(project) { return project.key === selectedKey; })) {
      options.unshift({ key: selectedKey, name: selectedKey });
    }
    return '<option value="">Jira 프로젝트 선택</option>' + options.map(function(project) {
      return '<option value="' + escapeAttribute(project.key) + '" ' + (project.key === selectedKey ? 'selected' : '') + '>' +
        escapeHtml(project.key + ' · ' + project.name) + '</option>';
    }).join('');
  }

  function getAvailableProjectDefinition(projectKey) {
    return state.availableProjects.find(function(project) { return project.key === projectKey; }) || null;
  }

  async function saveProjectSettings() {
    let projects;
    try {
      projects = validateProjectSettings(state.projectSettingsDraft);
    } catch (error) {
      notify(error.message, 'error');
      return;
    }

    const button = elements.saveProjectSettingsButton;
    const originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 저장 중';
    try {
      if (state.demoMode) {
        applyProjectConfig(projects);
      } else {
        const result = await callJiraTimelineApi('saveJiraTimelineProjects', { projects: projects }, 'POST');
        applyProjectConfig(result && result.projects);
      }
      closeModal(elements.projectSettingsModal);
      populateFilters();
      populateUnscheduledFilters();
      renderFilteredData();
      notify('프로젝트 설정을 저장했습니다.', 'success');
      if (!state.demoMode) await loadIssues();
    } catch (error) {
      notify(normalizeErrorMessage(error), 'error', 4200);
    } finally {
      button.disabled = false;
      button.innerHTML = originalHtml;
    }
  }

  function validateProjectSettings(projects) {
    if (!Array.isArray(projects) || !projects.length) throw new Error('프로젝트를 한 개 이상 등록해 주세요.');
    if (projects.length > 20) throw new Error('프로젝트는 최대 20개까지 등록할 수 있습니다.');
    const seen = {};
    const normalized = projects.map(function(project) {
      const key = String(project.key || '').trim().toUpperCase();
      const name = String(project.name || '').trim();
      if (!/^[A-Z][A-Z0-9]{1,19}$/.test(key)) throw new Error('프로젝트 코드를 확인해 주세요: ' + (key || '(빈 값)'));
      if (!name) throw new Error(key + ' 프로젝트의 화면 표시명을 입력해 주세요.');
      if (seen[key]) throw new Error('중복된 프로젝트 코드가 있습니다: ' + key);
      seen[key] = true;
      return { key: key, name: name.slice(0, 40), enabled: project.enabled !== false };
    });
    if (!normalized.some(function(project) { return project.enabled; })) throw new Error('사용할 프로젝트를 한 개 이상 선택해 주세요.');
    return normalized;
  }

  function notify(message, type, duration) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type || 'info', duration || 2500);
      return;
    }
    setStatus(type === 'error' ? 'error' : 'success', message);
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
    if (key === 'projectKey') {
      const project = getProjectDefinition(issue.projectKey);
      return project ? project.name : String(issue.projectKey || '').trim();
    }
    return String(issue[key] || '').trim();
  }

  function updateSortHeaders(buttons, sortState) {
    buttons.forEach(function(button) {
      const sortKey = button.dataset.unscheduledSort;
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

  function applyProjectConfig(projects) {
    const source = Array.isArray(projects) && projects.length ? projects : DEFAULT_PROJECTS;
    state.projects = source.map(function(project) {
      return {
        key: String(project.key || '').trim().toUpperCase(),
        name: String(project.name || project.key || '').trim(),
        enabled: project.enabled !== false
      };
    }).filter(function(project) { return project.key && project.name; });
    if (!state.projects.length) state.projects = cloneProjects(DEFAULT_PROJECTS);
    renderProjectScope();
  }

  function renderProjectScope() {
    const projects = getActiveProjects();
    elements.projectScopeSummary.textContent = projects.length + '개 Jira 프로젝트의 진행 업무를 일정 중심으로 한눈에 확인합니다.';
    elements.projectLegend.innerHTML = projects.map(function(project) {
      return '<span><i style="background:' + escapeAttribute(projectColor(project.key)) + '"></i>' + escapeHtml(project.name) + '</span>';
    }).join('');
  }

  function getActiveProjects() {
    return state.projects.filter(function(project) { return project.enabled; });
  }

  function getProjectDefinition(projectKey) {
    return state.projects.find(function(project) { return project.key === projectKey; }) || null;
  }

  function projectOrder(projectKey) {
    const index = state.projects.findIndex(function(project) { return project.key === projectKey; });
    return index === -1 ? 999 : index + 1;
  }

  function projectColor(projectKey) {
    const knownColors = {
      C21R: '#10a37f',
      CW2R: '#3b82f6',
      CWIZ: '#8b5cf6',
      ITM: '#f59e0b',
      WWWMR: '#ec4899'
    };
    if (knownColors[projectKey]) return knownColors[projectKey];
    const index = Math.max(0, projectOrder(projectKey) - 1);
    return PROJECT_COLORS[index % PROJECT_COLORS.length];
  }

  function cloneProjects(projects) {
    return projects.map(function(project) {
      return { key: project.key, name: project.name, enabled: project.enabled !== false };
    });
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
      ['C21R-205', '배포 일정 협의 대기', 'C21R', '검토 중', '박진희', '', '', []],
      ['WWWMR-84', '홈페이지 자료실 개선', 'WWWMR', '개발 중', '권순길', date(15), date(29)],
      ['WWWMR-89', '메인 배너 교체', 'WWWMR', '검토 중', '최늬혜', date(21), ''],
      ['WWWMR-95', '상시 콘텐츠 점검', 'WWWMR', '진행 중', '권순길', '', '', [EXCLUDED_LABEL]]
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
          projectName: (getProjectDefinition(item[2]) || { name: item[2] }).name,
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
        projectKeys: getActiveProjects().map(function(project) { return project.key; }),
        projects: cloneProjects(state.projects),
        total: raw.length,
        demo: true
      }
    };
  }
})();
