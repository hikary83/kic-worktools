/*
 * KIC Jira Timeline Read-only API
 *
 * 이 프로젝트는 기존 업무용 Apps Script와 분리해서 배포합니다.
 * 브라우저가 전달한 Google ID Token을 검증한 뒤에만 Jira 데이터를 반환합니다.
 */
const JIRA_API_BASE_URL = 'https://kic-itsd.atlassian.net';
const JIRA_API_PROJECTS = ['C21R', 'CW2R', 'CWIZ', 'ITM', 'WWWMR'];
const JIRA_API_ALLOWED_DOMAIN = 'kic21.co.kr';
const JIRA_API_GOOGLE_CLIENT_ID = '265516909240-60plojmr0didos11qlsfm62gjbjalht8.apps.googleusercontent.com';
const JIRA_API_TOKEN_INFO_URL = 'https://oauth2.googleapis.com/tokeninfo?id_token=';
const JIRA_API_CACHE_KEY = 'JIRA_TIMELINE_ISSUES_V1';
const JIRA_API_CACHE_SECONDS = 180;
const JIRA_API_PAGE_SIZE = 100;
const JIRA_API_MAX_PAGES = 20;

const JIRA_API_PROPERTIES = {
  baseUrl: 'JIRA_BASE_URL',
  email: 'JIRA_ACCOUNT_EMAIL',
  apiToken: 'JIRA_API_TOKEN',
  startDateFieldId: 'JIRA_START_DATE_FIELD_ID',
  webEnabled: 'JIRA_TIMELINE_WEB_ENABLED'
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
    if (payload.action !== 'getJiraTimelineIssues') {
      throw new Error('허용되지 않은 요청입니다.');
    }
    const data = payload.data || {};
    const identity = verifyGoogleIdToken_(data.googleIdToken);
    const result = getJiraIssues_();
    result.meta = result.meta || {};
    result.meta.authenticatedEmail = identity.email;
    return jsonOutput_({ success: true, data: result });
  } catch (error) {
    return jsonOutput_({ success: false, error: cleanError_(error) });
  }
}

function getPublicConfig_() {
  const missing = requiredProperties_();
  return {
    enabled: readBooleanProperty_(JIRA_API_PROPERTIES.webEnabled),
    configured: missing.length === 0,
    googleClientId: JIRA_API_GOOGLE_CLIENT_ID,
    allowedDomain: JIRA_API_ALLOWED_DOMAIN,
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

function verifyGoogleIdToken_(idToken) {
  const token = (idToken || '').toString().trim();
  if (!token) throw new Error('회사 Google 계정 로그인이 필요합니다. 다시 로그인해 주세요.');

  const props = PropertiesService.getScriptProperties();
  if (!readBooleanProperty_(JIRA_API_PROPERTIES.webEnabled)) {
    throw new Error('Jira 통합 일정 웹 조회가 아직 활성화되지 않았습니다.');
  }
  const response = UrlFetchApp.fetch(JIRA_API_TOKEN_INFO_URL + encodeURIComponent(token), {
    method: 'get',
    muteHttpExceptions: true
  });
  let claims = {};
  try {
    claims = JSON.parse(response.getContentText('UTF-8') || '{}');
  } catch (error) {
    claims = {};
  }

  const email = (claims.email || '').toString().trim().toLowerCase();
  const issuerValid = claims.iss === 'accounts.google.com' || claims.iss === 'https://accounts.google.com';
  const audienceValid = claims.aud === JIRA_API_GOOGLE_CLIENT_ID;
  const expiryValid = Number(claims.exp || 0) > Math.floor(Date.now() / 1000);
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  const domainValid = (claims.hd || '').toLowerCase() === JIRA_API_ALLOWED_DOMAIN &&
    email.endsWith('@' + JIRA_API_ALLOWED_DOMAIN);

  if (response.getResponseCode() !== 200 || !issuerValid || !audienceValid ||
      !expiryValid || !emailVerified || !domainValid) {
    throw new Error('회사 Google 계정 인증을 확인하지 못했습니다. @' + JIRA_API_ALLOWED_DOMAIN + ' 계정으로 다시 로그인해 주세요.');
  }
  return { email: email, subject: claims.sub || '' };
}

function getJiraIssues_() {
  const missing = requiredProperties_();
  if (missing.length) throw new Error('필수 Script Properties가 없습니다: ' + missing.join(', '));

  const cache = CacheService.getScriptCache();
  const cached = cache.get(JIRA_API_CACHE_KEY);
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
    'priority', 'reporter', 'updated', 'parent'];
  if (startDateFieldId) fields.push(startDateFieldId);

  const jql = 'project in (' + JIRA_API_PROJECTS.join(', ') + ') ' +
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
      projectKeys: JIRA_API_PROJECTS.slice(),
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
      cache.put(JIRA_API_CACHE_KEY, serialized, JIRA_API_CACHE_SECONDS);
    }
  } catch (error) {
    // 캐시 실패는 실제 응답에 영향을 주지 않습니다.
  }
  return result;
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
