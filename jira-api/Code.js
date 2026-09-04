/*
 * KIC Jira Timeline API
 *
 * 이 프로젝트는 기존 업무용 Apps Script와 분리해서 배포합니다.
 * 기능 검증 기간에는 로그인 없는 공개 테스트 모드로 Jira 데이터를 반환합니다.
 * Jira Issue는 조회만 하며, 프로젝트 조회 범위 설정만 별도로 저장합니다.
 */
const JIRA_API_BASE_URL = 'https://kic-itsd.atlassian.net';
const JIRA_API_DEFAULT_PROJECTS = [
  { key: 'C21R', name: 'CMS', enabled: true },
  { key: 'CW2R', name: 'CWIZ 2.0', enabled: true },
  { key: 'CWIZ', name: 'CWIZ 1.0', enabled: true },
  { key: 'ITM', name: 'IT 업무', enabled: true },
  { key: 'WWWMR', name: '홈페이지', enabled: true }
];
const JIRA_API_CACHE_KEY = 'JIRA_TIMELINE_ISSUES_V3';
const JIRA_API_CACHE_SECONDS = 180;
const JIRA_API_PAGE_SIZE = 100;
const JIRA_API_MAX_PAGES = 20;

const JIRA_API_PROPERTIES = {
  baseUrl: 'JIRA_BASE_URL',
  email: 'JIRA_ACCOUNT_EMAIL',
  apiToken: 'JIRA_API_TOKEN',
  startDateFieldId: 'JIRA_START_DATE_FIELD_ID',
  webEnabled: 'JIRA_TIMELINE_WEB_ENABLED',
  projects: 'JIRA_TIMELINE_PROJECTS'
};

function doGet(e) {
  try {
    const action = e && e.parameter ? e.parameter.action : '';
    if (action !== 'getJiraTimelinePublicConfig') {
      throw new Error('허용되지 않은 요청입니다.');
    }
    return jsonOutput_({ success: true, data: getPublicConfig_() });
  } catch (error) {
    return jsonOutput_({ success: false, error: cleanError_(error) });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : '{}');
    if (!readBooleanProperty_(JIRA_API_PROPERTIES.webEnabled)) {
      throw new Error('Jira 통합 일정 웹 조회가 아직 활성화되지 않았습니다.');
    }
    if (payload.action === 'getJiraTimelineIssues') {
      const result = getJiraIssues_();
      result.meta = result.meta || {};
      result.meta.publicTestMode = true;
      return jsonOutput_({ success: true, data: result });
    }
    if (payload.action === 'getJiraTimelineProjects') {
      return jsonOutput_({ success: true, data: getAvailableProjects_() });
    }
    if (payload.action === 'saveJiraTimelineProjects') {
      return jsonOutput_({ success: true, data: saveProjectSettings_(payload.data || {}) });
    }
    throw new Error('허용되지 않은 요청입니다.');
  } catch (error) {
    return jsonOutput_({ success: false, error: cleanError_(error) });
  }
}

function getPublicConfig_() {
  const missing = requiredProperties_();
  return {
    enabled: readBooleanProperty_(JIRA_API_PROPERTIES.webEnabled),
    configured: missing.length === 0,
    publicTestMode: true,
    projects: getProjectSettings_(),
    missingProperties: missing
  };
}

function requiredProperties_() {
  const props = PropertiesService.getScriptProperties();
  return [
    JIRA_API_PROPERTIES.email,
    JIRA_API_PROPERTIES.apiToken
  ].filter(function(name) {
    return !(props.getProperty(name) || '').trim();
  });
}

function getJiraIssues_() {
  const missing = requiredProperties_();
  if (missing.length) throw new Error('필수 Script Properties가 없습니다: ' + missing.join(', '));

  const projects = getProjectSettings_();
  const activeProjects = projects.filter(function(project) { return project.enabled; });
  if (!activeProjects.length) throw new Error('사용 중인 Jira 프로젝트가 없습니다.');
  const projectKeys = activeProjects.map(function(project) { return project.key; });
  const cacheKey = projectCacheKey_(projects);
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      parsed.meta.cached = true;
      return parsed;
    } catch (error) {
      // 손상된 캐시는 무시합니다.
    }
  }

  const config = getJiraConfig_();
  const startDateFieldId = resolveStartDateFieldId_(config);
  const fields = ['summary', 'project', 'status', 'assignee', 'duedate', 'issuetype',
    'priority', 'reporter', 'updated', 'parent', 'labels'];
  if (startDateFieldId) fields.push(startDateFieldId);

  const jql = 'project in (' + projectKeys.join(', ') + ') ' +
    'AND statusCategory != Done ORDER BY due ASC, updated DESC';
  let nextPageToken = '';
  let isLast = false;
  let pageCount = 0;
  let rawIssues = [];

  while (!isLast && pageCount < JIRA_API_MAX_PAGES) {
    const body = { jql: jql, fields: fields, maxResults: JIRA_API_PAGE_SIZE };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const page = jiraRequest_(config, '/rest/api/3/search/jql', { method: 'post', payload: body });
    rawIssues = rawIssues.concat(Array.isArray(page.issues) ? page.issues : []);
    pageCount += 1;
    isLast = page.isLast === true || !page.nextPageToken;
    nextPageToken = page.nextPageToken || '';
  }

  const result = {
    enabled: true,
    configured: true,
    issues: rawIssues.map(function(issue) {
      return normalizeIssue_(issue, config.baseUrl, startDateFieldId);
    }),
    meta: {
      cached: false,
      fetchedAt: Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX"),
      projectKeys: projectKeys,
      projects: projects,
      startDateFieldId: startDateFieldId || '',
      startDateFieldFound: Boolean(startDateFieldId),
      pageCount: pageCount,
      total: rawIssues.length,
      truncated: !isLast
    }
  };

  const serialized = JSON.stringify(result);
  try {
    if (Utilities.newBlob(serialized).getBytes().length < 95000) {
      cache.put(cacheKey, serialized, JIRA_API_CACHE_SECONDS);
    }
  } catch (error) {
    // 캐시 실패는 실제 응답에 영향을 주지 않습니다.
  }
  return result;
}

function getProjectSettings_() {
  const stored = (PropertiesService.getScriptProperties().getProperty(JIRA_API_PROPERTIES.projects) || '').trim();
  if (!stored) return cloneDefaultProjects_();
  try {
    return normalizeProjectSettings_(JSON.parse(stored));
  } catch (error) {
    return cloneDefaultProjects_();
  }
}

function getAvailableProjects_() {
  const missing = requiredProperties_();
  if (missing.length) throw new Error('필수 Script Properties가 없습니다: ' + missing.join(', '));

  const config = getJiraConfig_();
  let startAt = 0;
  let pageCount = 0;
  let projects = [];

  while (pageCount < JIRA_API_MAX_PAGES) {
    const page = jiraRequest_(
      config,
      '/rest/api/3/project/search?status=live&orderBy=name&startAt=' + startAt + '&maxResults=' + JIRA_API_PAGE_SIZE,
      { method: 'get' }
    );
    const values = Array.isArray(page.values) ? page.values : [];
    projects = projects.concat(values.map(function(project) {
      return {
        key: String(project.key || '').trim().toUpperCase(),
        name: String(project.name || project.key || '').trim()
      };
    }).filter(function(project) {
      return project.key && project.name;
    }));

    pageCount += 1;
    const pageStart = Number(page.startAt);
    const total = Number(page.total);
    startAt = (Number.isFinite(pageStart) ? pageStart : startAt) + values.length;
    if (!values.length || page.isLast === true || (Number.isFinite(total) && startAt >= total)) break;
  }

  const seen = {};
  projects = projects.filter(function(project) {
    if (seen[project.key]) return false;
    seen[project.key] = true;
    return true;
  }).sort(function(left, right) {
    return left.name.localeCompare(right.name, 'ko') || left.key.localeCompare(right.key);
  });

  return {
    projects: projects,
    fetchedAt: Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    total: projects.length,
    truncated: pageCount >= JIRA_API_MAX_PAGES
  };
}

function saveProjectSettings_(data) {
  const projects = normalizeProjectSettings_(data.projects);
  const activeProjects = projects.filter(function(project) { return project.enabled; });
  if (!activeProjects.length) throw new Error('사용할 프로젝트를 한 개 이상 선택해 주세요.');

  const config = getJiraConfig_();
  activeProjects.forEach(function(project) {
    jiraRequest_(config, '/rest/api/3/project/' + encodeURIComponent(project.key), { method: 'get' });
  });

  const props = PropertiesService.getScriptProperties();
  const previousProjects = getProjectSettings_();
  props.setProperty(JIRA_API_PROPERTIES.projects, JSON.stringify(projects));
  const cache = CacheService.getScriptCache();
  cache.remove(projectCacheKey_(previousProjects));
  cache.remove(projectCacheKey_(projects));

  return {
    projects: projects,
    updatedAt: Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX")
  };
}

function normalizeProjectSettings_(projects) {
  if (!Array.isArray(projects) || !projects.length) {
    throw new Error('프로젝트 설정이 비어 있습니다.');
  }
  if (projects.length > 20) throw new Error('프로젝트는 최대 20개까지 등록할 수 있습니다.');

  const seen = {};
  return projects.map(function(project) {
    const key = String(project && project.key || '').trim().toUpperCase();
    const name = String(project && project.name || '').trim();
    if (!/^[A-Z][A-Z0-9]{1,19}$/.test(key)) {
      throw new Error('프로젝트 코드를 확인해 주세요: ' + (key || '(빈 값)'));
    }
    if (!name || name.length > 40) {
      throw new Error(key + ' 프로젝트 표시명은 1~40자로 입력해 주세요.');
    }
    if (seen[key]) throw new Error('중복된 프로젝트 코드가 있습니다: ' + key);
    seen[key] = true;
    return { key: key, name: name, enabled: project.enabled !== false };
  });
}

function cloneDefaultProjects_() {
  return JIRA_API_DEFAULT_PROJECTS.map(function(project) {
    return { key: project.key, name: project.name, enabled: project.enabled };
  });
}

function projectCacheKey_(projects) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(projects),
    Utilities.Charset.UTF_8
  );
  return JIRA_API_CACHE_KEY + '_' + Utilities.base64EncodeWebSafe(bytes).slice(0, 24);
}

function getJiraConfig_() {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = (props.getProperty(JIRA_API_PROPERTIES.baseUrl) || JIRA_API_BASE_URL)
    .trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+\.atlassian\.net$/i.test(baseUrl)) {
    throw new Error('JIRA_BASE_URL은 https://*.atlassian.net 형식이어야 합니다.');
  }
  return {
    baseUrl: baseUrl,
    email: (props.getProperty(JIRA_API_PROPERTIES.email) || '').trim(),
    apiToken: (props.getProperty(JIRA_API_PROPERTIES.apiToken) || '').trim(),
    startDateFieldId: (props.getProperty(JIRA_API_PROPERTIES.startDateFieldId) || '').trim()
  };
}

function resolveStartDateFieldId_(config) {
  if (config.startDateFieldId) return config.startDateFieldId;
  const fields = jiraRequest_(config, '/rest/api/3/field', { method: 'get' });
  const names = ['start date', 'startdate', '시작일', '시작 날짜'];
  const match = (Array.isArray(fields) ? fields : []).find(function(field) {
    const name = (field.name || '').toString().trim().toLowerCase();
    const type = field.schema && field.schema.type;
    return (type === 'date' || type === 'datetime') && names.indexOf(name) !== -1;
  });
  if (!match || !match.id) return '';
  PropertiesService.getScriptProperties().setProperty(JIRA_API_PROPERTIES.startDateFieldId, match.id);
  return match.id;
}

function jiraRequest_(config, path, options) {
  const request = {
    method: (options.method || 'get').toLowerCase(),
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(config.email + ':' + config.apiToken),
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  };
  if (options.payload !== undefined) {
    request.contentType = 'application/json';
    request.payload = JSON.stringify(options.payload);
  }
  const response = UrlFetchApp.fetch(config.baseUrl + path, request);
  let data = {};
  try {
    data = JSON.parse(response.getContentText('UTF-8') || '{}');
  } catch (error) {
    data = {};
  }
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    const detail = Array.isArray(data.errorMessages) ? data.errorMessages.join(' ') : '';
    throw new Error('Jira API 호출 실패 (' + response.getResponseCode() + ')' + (detail ? ': ' + detail : ''));
  }
  return data;
}

function normalizeIssue_(issue, baseUrl, startDateFieldId) {
  const fields = issue.fields || {};
  const project = fields.project || {};
  const status = fields.status || {};
  const category = status.statusCategory || {};
  const assignee = fields.assignee || {};
  const reporter = fields.reporter || {};
  const issueType = fields.issuetype || {};
  const priority = fields.priority || {};
  const parent = fields.parent || {};
  return {
    id: issue.id || '',
    key: issue.key || '',
    summary: fields.summary || '(제목 없음)',
    projectKey: project.key || '',
    projectName: project.name || project.key || '',
    status: status.name || '',
    statusCategory: category.name || '',
    statusCategoryKey: category.key || '',
    assignee: assignee.displayName || '미지정',
    assigneeAccountId: assignee.accountId || '',
    startDate: startDateFieldId ? normalizeDate_(fields[startDateFieldId]) : '',
    dueDate: normalizeDate_(fields.duedate),
    issueType: issueType.name || '',
    priority: priority.name || '',
    reporter: reporter.displayName || '',
    labels: Array.isArray(fields.labels) ? fields.labels.slice() : [],
    updated: fields.updated || '',
    parentKey: parent.key || '',
    parentSummary: parent.fields && parent.fields.summary ? parent.fields.summary : '',
    url: baseUrl + '/browse/' + encodeURIComponent(issue.key || '')
  };
}

function normalizeDate_(value) {
  if (!value) return '';
  const match = value.toString().trim().match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function readBooleanProperty_(name) {
  return (PropertiesService.getScriptProperties().getProperty(name) || '')
    .trim().toLowerCase() === 'true';
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.TEXT);
}

function cleanError_(error) {
  return (error && error.message ? error.message : String(error || '알 수 없는 오류'))
    .replace(/^Error:\s*/, '');
}
