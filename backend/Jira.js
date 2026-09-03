/* ==========================================
   🗓️ IT전략실 Jira 통합 일정 (조회 전용)
   ========================================== */
const JIRA_TIMELINE_BASE_URL = 'https://kic-itsd.atlassian.net';
const JIRA_TIMELINE_PROJECTS = ['C21R', 'CW2R', 'CWIZ', 'ITM', 'WWWMR'];
const JIRA_TIMELINE_CACHE_KEY = 'JIRA_TIMELINE_ISSUES_V1';
const JIRA_TIMELINE_CACHE_SECONDS = 180;
const JIRA_TIMELINE_MAX_PAGES = 20;
const JIRA_TIMELINE_PAGE_SIZE = 100;
const JIRA_TIMELINE_ALLOWED_USER_KEYS_PROPERTY = 'JIRA_TIMELINE_ALLOWED_USER_KEYS';
const JIRA_TIMELINE_MAX_ALLOWED_USER_KEYS = 20;

const JIRA_TIMELINE_PROPERTIES = {
  baseUrl: 'JIRA_BASE_URL',
  email: 'JIRA_ACCOUNT_EMAIL',
  apiToken: 'JIRA_API_TOKEN',
  startDateFieldId: 'JIRA_START_DATE_FIELD_ID',
  webEnabled: 'JIRA_TIMELINE_WEB_ENABLED'
};

function getJiraTimelineIssuesForWeb() {
  assertJiraTimelineWebUser_();
  const status = getJiraTimelineConfigStatus_();
  if (!status.webEnabled) {
    return {
      enabled: false,
      configured: status.configured,
      missingProperties: status.missingProperties,
      issues: [],
      meta: {
        projectKeys: JIRA_TIMELINE_PROJECTS.slice(),
        message: 'Jira 통합 일정 웹 조회가 아직 활성화되지 않았습니다.'
      }
    };
  }

  return getJiraTimelineIssues_({ forceRefresh: false });
}

function getJiraTimelineHostPage_() {
  return HtmlService.createHtmlOutputFromFile('JiraTimelineHost')
    .setTitle('KIC 업무 도구 · IT전략실 통합 일정');
}

function assertJiraTimelineWebUser_() {
  const currentKey = Session.getTemporaryActiveUserKey();
  const allowedKeys = getJiraTimelineAllowedUserKeys_();
  if (!currentKey || allowedKeys.indexOf(currentKey) === -1) {
    throw new Error('현재 Google 계정은 아직 Jira 일정 조회 승인이 되지 않았습니다. 스프레드시트의 Jira 통합 일정 설정을 열어 저장을 한 번 더 눌러 주세요.');
  }
}

function getJiraTimelineAllowedUserKeys_() {
  const raw = PropertiesService.getScriptProperties().getProperty(JIRA_TIMELINE_ALLOWED_USER_KEYS_PROPERTY);
  if (!raw) return [];
  try {
    const keys = JSON.parse(raw);
    return Array.isArray(keys) ? keys.filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}

function registerJiraTimelineCurrentUser_() {
  const currentKey = Session.getTemporaryActiveUserKey();
  if (!currentKey) throw new Error('현재 Google 계정의 사용자 식별키를 확인하지 못했습니다. 스프레드시트를 새로고침한 뒤 다시 저장해 주세요.');

  const props = PropertiesService.getScriptProperties();
  const keys = getJiraTimelineAllowedUserKeys_().filter(function(key) {
    return key !== currentKey;
  });
  keys.push(currentKey);
  props.setProperty(
    JIRA_TIMELINE_ALLOWED_USER_KEYS_PROPERTY,
    JSON.stringify(keys.slice(-JIRA_TIMELINE_MAX_ALLOWED_USER_KEYS))
  );
  return currentKey;
}

function getJiraTimelineIssues_(options) {
  options = options || {};
  const config = getJiraTimelineConfig_();
  const cache = CacheService.getScriptCache();

  if (!options.forceRefresh) {
    const cached = cache.get(JIRA_TIMELINE_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        parsed.meta = parsed.meta || {};
        parsed.meta.cached = true;
        return parsed;
      } catch (e) {
        // 손상된 캐시는 무시하고 Jira에서 다시 조회합니다.
      }
    }
  }

  const startDateFieldId = resolveJiraStartDateFieldId_(config);
  const fields = [
    'summary',
    'project',
    'status',
    'assignee',
    'duedate',
    'issuetype',
    'priority',
    'reporter',
    'updated',
    'parent'
  ];
  if (startDateFieldId) fields.push(startDateFieldId);

  const jql = 'project in (' + JIRA_TIMELINE_PROJECTS.join(', ') + ') ' +
    'AND statusCategory != Done ORDER BY due ASC, updated DESC';

  let nextPageToken = '';
  let isLast = false;
  let pageCount = 0;
  let rawIssues = [];

  while (!isLast && pageCount < JIRA_TIMELINE_MAX_PAGES) {
    const requestBody = {
      jql: jql,
      fields: fields,
      maxResults: JIRA_TIMELINE_PAGE_SIZE
    };
    if (nextPageToken) requestBody.nextPageToken = nextPageToken;

    const response = jiraTimelineRequest_(config, '/rest/api/3/search/jql', {
      method: 'post',
      payload: requestBody
    });

    const pageIssues = Array.isArray(response.issues) ? response.issues : [];
    rawIssues = rawIssues.concat(pageIssues);
    pageCount += 1;
    isLast = response.isLast === true || !response.nextPageToken;
    nextPageToken = response.nextPageToken || '';
  }

  const result = {
    enabled: true,
    configured: true,
    issues: rawIssues.map(function(issue) {
      return normalizeJiraTimelineIssue_(issue, config.baseUrl, startDateFieldId);
    }),
    meta: {
      cached: false,
      fetchedAt: Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      projectKeys: JIRA_TIMELINE_PROJECTS.slice(),
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
      cache.put(JIRA_TIMELINE_CACHE_KEY, serialized, JIRA_TIMELINE_CACHE_SECONDS);
    }
  } catch (e) {
    // 캐시 한도나 일시 오류가 발생해도 실제 조회 결과는 정상 반환합니다.
  }
  return result;
}

function getJiraTimelineConfig_() {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = (props.getProperty(JIRA_TIMELINE_PROPERTIES.baseUrl) || JIRA_TIMELINE_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
  const email = (props.getProperty(JIRA_TIMELINE_PROPERTIES.email) || '').trim();
  const apiToken = (props.getProperty(JIRA_TIMELINE_PROPERTIES.apiToken) || '').trim();

  if (!/^https:\/\/[a-z0-9.-]+\.atlassian\.net$/i.test(baseUrl)) {
    throw new Error('JIRA_BASE_URL은 https://*.atlassian.net 형식이어야 합니다.');
  }
  if (!email || !apiToken) {
    throw new Error('Apps Script의 Script Properties에 JIRA_ACCOUNT_EMAIL과 JIRA_API_TOKEN을 설정해 주세요.');
  }

  return {
    baseUrl: baseUrl,
    email: email,
    apiToken: apiToken,
    startDateFieldId: (props.getProperty(JIRA_TIMELINE_PROPERTIES.startDateFieldId) || '').trim()
  };
}

function getJiraTimelineConfigStatus_() {
  const props = PropertiesService.getScriptProperties();
  const missingProperties = [];
  if (!(props.getProperty(JIRA_TIMELINE_PROPERTIES.email) || '').trim()) {
    missingProperties.push(JIRA_TIMELINE_PROPERTIES.email);
  }
  if (!(props.getProperty(JIRA_TIMELINE_PROPERTIES.apiToken) || '').trim()) {
    missingProperties.push(JIRA_TIMELINE_PROPERTIES.apiToken);
  }

  return {
    configured: missingProperties.length === 0,
    webEnabled: (props.getProperty(JIRA_TIMELINE_PROPERTIES.webEnabled) || '').trim().toLowerCase() === 'true',
    missingProperties: missingProperties
  };
}

function showJiraTimelineSetup() {
  const html = HtmlService.createHtmlOutputFromFile('JiraSetup')
    .setWidth(520)
    .setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Jira 통합 일정 설정');
}

function getJiraTimelineSetupState() {
  const props = PropertiesService.getScriptProperties();
  const email = (props.getProperty(JIRA_TIMELINE_PROPERTIES.email) || '').trim();
  const status = getJiraTimelineConfigStatus_();
  return {
    configured: status.configured,
    webEnabled: status.webEnabled,
    email: email,
    hasApiToken: Boolean((props.getProperty(JIRA_TIMELINE_PROPERTIES.apiToken) || '').trim()),
    currentUserRegistered: getJiraTimelineAllowedUserKeys_().indexOf(Session.getTemporaryActiveUserKey()) !== -1,
    baseUrl: (props.getProperty(JIRA_TIMELINE_PROPERTIES.baseUrl) || JIRA_TIMELINE_BASE_URL).trim(),
    startDateFieldId: (props.getProperty(JIRA_TIMELINE_PROPERTIES.startDateFieldId) || '').trim()
  };
}

function saveJiraTimelineSettings(data) {
  data = data || {};
  const props = PropertiesService.getScriptProperties();
  const email = (data.email || '').toString().trim();
  const apiToken = (data.apiToken || '').toString().trim();
  const existingToken = (props.getProperty(JIRA_TIMELINE_PROPERTIES.apiToken) || '').trim();
  const baseUrl = (data.baseUrl || JIRA_TIMELINE_BASE_URL).toString().trim().replace(/\/+$/, '');
  const webEnabled = data.webEnabled === true;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Jira 로그인 이메일을 정확히 입력해 주세요.');
  }
  if (!apiToken && !existingToken) {
    throw new Error('Jira API Token을 입력해 주세요.');
  }
  if (!/^https:\/\/[a-z0-9.-]+\.atlassian\.net$/i.test(baseUrl)) {
    throw new Error('Jira 주소는 https://*.atlassian.net 형식이어야 합니다.');
  }

  props.setProperty(JIRA_TIMELINE_PROPERTIES.email, email);
  props.setProperty(JIRA_TIMELINE_PROPERTIES.baseUrl, baseUrl);
  props.setProperty(JIRA_TIMELINE_PROPERTIES.webEnabled, webEnabled ? 'true' : 'false');
  if (apiToken) props.setProperty(JIRA_TIMELINE_PROPERTIES.apiToken, apiToken);
  registerJiraTimelineCurrentUser_();
  CacheService.getScriptCache().remove(JIRA_TIMELINE_CACHE_KEY);

  return getJiraTimelineSetupState();
}

function testJiraTimelineConnectionForDialog() {
  const result = getJiraTimelineIssues_({ forceRefresh: true });
  const issues = result.issues || [];
  const scheduledCount = issues.filter(function(issue) {
    return Boolean(issue.startDate || issue.dueDate);
  }).length;
  return {
    total: issues.length,
    scheduled: scheduledCount,
    unscheduled: issues.length - scheduledCount,
    startDateFieldId: result.meta.startDateFieldId || '',
    truncated: result.meta.truncated === true
  };
}

function resolveJiraStartDateFieldId_(config) {
  if (config.startDateFieldId) return config.startDateFieldId;

  const fields = jiraTimelineRequest_(config, '/rest/api/3/field', { method: 'get' });
  const candidates = ['start date', 'startdate', '시작일', '시작 날짜'];
  const match = (Array.isArray(fields) ? fields : []).find(function(field) {
    const name = (field.name || '').toString().trim().toLowerCase();
    const fieldType = field.schema && field.schema.type;
    const isDateField = fieldType === 'date' || fieldType === 'datetime';
    return isDateField && candidates.indexOf(name) !== -1;
  });

  if (match && match.id) {
    PropertiesService.getScriptProperties().setProperty(
      JIRA_TIMELINE_PROPERTIES.startDateFieldId,
      match.id
    );
    return match.id;
  }
  return '';
}

function jiraTimelineRequest_(config, path, options) {
  options = options || {};
  const method = (options.method || 'get').toLowerCase();
  const requestOptions = {
    method: method,
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(config.email + ':' + config.apiToken),
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  };

  if (options.payload !== undefined) {
    requestOptions.contentType = 'application/json';
    requestOptions.payload = JSON.stringify(options.payload);
  }

  const response = UrlFetchApp.fetch(config.baseUrl + path, requestOptions);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText('UTF-8');
  let responseData = null;

  try {
    responseData = responseText ? JSON.parse(responseText) : {};
  } catch (e) {
    responseData = {};
  }

  if (responseCode < 200 || responseCode >= 300) {
    const messages = [];
    if (Array.isArray(responseData.errorMessages)) {
      messages.push(responseData.errorMessages.join(' '));
    }
    if (responseData.errors && typeof responseData.errors === 'object') {
      messages.push(Object.keys(responseData.errors).map(function(key) {
        return key + ': ' + responseData.errors[key];
      }).join(' '));
    }
    throw new Error(
      'Jira API 호출 실패 (' + responseCode + ')' +
      (messages.filter(Boolean).length ? ': ' + messages.filter(Boolean).join(' ') : '')
    );
  }

  return responseData;
}

function normalizeJiraTimelineIssue_(issue, baseUrl, startDateFieldId) {
  const fields = issue.fields || {};
  const project = fields.project || {};
  const status = fields.status || {};
  const statusCategory = status.statusCategory || {};
  const assignee = fields.assignee || {};
  const reporter = fields.reporter || {};
  const issueType = fields.issuetype || {};
  const priority = fields.priority || {};
  const parent = fields.parent || {};
  const parentFields = parent.fields || {};

  return {
    id: issue.id || '',
    key: issue.key || '',
    summary: fields.summary || '(제목 없음)',
    projectKey: project.key || '',
    projectName: project.name || project.key || '',
    status: status.name || '',
    statusCategory: statusCategory.name || '',
    statusCategoryKey: statusCategory.key || '',
    assignee: assignee.displayName || '미지정',
    assigneeAccountId: assignee.accountId || '',
    startDate: startDateFieldId ? normalizeJiraDateValue_(fields[startDateFieldId]) : '',
    dueDate: normalizeJiraDateValue_(fields.duedate),
    issueType: issueType.name || '',
    priority: priority.name || '',
    reporter: reporter.displayName || '',
    updated: fields.updated || '',
    parentKey: parent.key || '',
    parentSummary: parentFields.summary || '',
    url: baseUrl + '/browse/' + encodeURIComponent(issue.key || '')
  };
}

function normalizeJiraDateValue_(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return Utilities.formatDate(value, TIMEZONE, 'yyyy-MM-dd');
  }
  const text = value.toString().trim();
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function testJiraTimelineConnection() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = getJiraTimelineIssues_({ forceRefresh: true });
    ui.alert(
      'Jira 통합 일정 연결 성공',
      '진행 중 이슈 ' + result.issues.length + '건을 조회했습니다.\n' +
      'Start date 필드: ' + (result.meta.startDateFieldId || '찾지 못함'),
      ui.ButtonSet.OK
    );
    return result.meta;
  } catch (error) {
    ui.alert('Jira 통합 일정 연결 실패', error.message, ui.ButtonSet.OK);
    throw error;
  }
}
