// 헬프데스크 싱크용 Jira 직접 조회. 완료 티켓을 포함하며 Jira 데이터는 변경하지 않습니다.
// 다른 Apps Script를 거치면 요청 본문이 간헐적으로 유실되어 업무 API가 Jira를 직접 호출합니다.
function helpdeskJiraConfig_() {
  const props = PropertiesService.getScriptProperties();
  const email = (props.getProperty('JIRA_ACCOUNT_EMAIL') || '').trim();
  const apiToken = (props.getProperty('JIRA_API_TOKEN') || '').trim();
  if (!email || !apiToken) throw new Error('Jira 조회 계정 설정을 확인해 주세요. (스크립트 속성 JIRA_ACCOUNT_EMAIL·JIRA_API_TOKEN)');
  // 링크 검증과 같은 테넌트만 조회합니다.
  return { baseUrl: HELPDESK_JIRA_SYNC_ORIGIN, email: email, apiToken: apiToken };
}

function helpdeskJiraRequest_(config, path, payload) {
  const response = UrlFetchApp.fetch(config.baseUrl + path, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(payload),
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(config.email + ':' + config.apiToken), Accept: 'application/json' }
  });
  let data = {};
  try { data = JSON.parse(response.getContentText('UTF-8') || '{}'); } catch (error) { data = {}; }
  const code = response.getResponseCode();
  if (code === 401 || code === 403) throw new Error('Jira 조회 계정 인증에 실패했습니다. API 토큰을 확인해 주세요. (' + code + ')');
  if (code < 200 || code >= 300) {
    const detail = Array.isArray(data.errorMessages) ? data.errorMessages.join(' ') : '';
    throw new Error('Jira API 호출 실패 (' + code + ')' + (detail ? ': ' + detail : ''));
  }
  return data;
}

function getHelpdeskJiraSyncIssues_(data) {
  const config = helpdeskJiraConfig_();
  const numbers = Array.from(new Set((Array.isArray(data.issueNumbers) ? data.issueNumbers : []).map(String).filter(function(value) {
    return /^IT-\d{6}-\d{3,}$/.test(value);
  })));
  const keys = Array.from(new Set((Array.isArray(data.issueKeys) ? data.issueKeys : []).map(function(value) {
    return String(value).trim().toUpperCase();
  }).filter(function(value) { return /^[A-Z][A-Z0-9_]*-\d+$/.test(value); })));
  if (numbers.length > 2000 || keys.length > 500) throw new Error('조회 대상이 너무 많습니다. 조회 범위를 나눠 주세요.');
  const fields = ['summary', 'description', 'labels', 'status', 'resolutiondate', 'updated'];
  const issues = {};
  const warnings = [];

  // 등록된 링크는 프로젝트 설정·완료 상태에 관계없이 키로 직접 확인합니다.
  // 100건씩 한 번에 조회합니다. 응답에 없는 키(삭제·권한 없음)는 조회 실패로 남깁니다.
  let pendingKeys = keys;
  let keyLookup = keys.length ? 'bulk' : '';
  try {
    for (let offset = 0; offset < keys.length; offset += 100) {
      const batch = keys.slice(offset, offset + 100);
      const page = helpdeskJiraRequest_(config, '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: batch, fields: fields });
      const found = {};
      (page.issues || []).forEach(function(issue) {
        const normalized = normalizeHelpdeskSyncIssue_(issue, config.baseUrl);
        issues[normalized.key] = normalized;
        found[normalized.key] = true;
      });
      batch.forEach(function(key) { if (!found[key]) warnings.push(key + ': 조회 실패 (404)'); });
    }
    pendingKeys = [];
  } catch (error) {
    // 인증 오류는 건별 조회로도 해결되지 않으므로 그대로 알립니다.
    if (/인증에 실패/.test(error.message)) throw error;
    // 일괄 조회를 쓸 수 없으면 기존 건별 조회로 다시 확인합니다. 전환 여부와 이유는 응답에 남깁니다.
    keyLookup = 'single: ' + error.message;
    keys.forEach(function(key) { delete issues[key]; });
    warnings.length = 0;
  }
  for (let offset = 0; offset < pendingKeys.length; offset += 20) {
    const batch = keys.slice(offset, offset + 20);
    const responses = UrlFetchApp.fetchAll(batch.map(function(key) {
      return {
        url: config.baseUrl + '/rest/api/3/issue/' + encodeURIComponent(key) + '?fields=' + fields.join(','),
        headers: { Authorization: 'Basic ' + Utilities.base64Encode(config.email + ':' + config.apiToken), Accept: 'application/json' },
        muteHttpExceptions: true
      };
    }));
    responses.forEach(function(response, index) {
      if (response.getResponseCode() === 200) {
        const issue = JSON.parse(response.getContentText());
        issues[issue.key] = normalizeHelpdeskSyncIssue_(issue, config.baseUrl);
      } else {
        warnings.push(batch[index] + ': 조회 실패 (' + response.getResponseCode() + ')');
      }
    });
  }

  // 링크가 없는 건은 Jira에 명시된 이슈번호만 정확히 연결합니다. 조회 계정이 볼 수 있는 전체 프로젝트가 대상입니다.
  for (let offset = 0; offset < numbers.length; offset += 30) {
    const batch = numbers.slice(offset, offset + 30);
    const conditions = batch.map(function(number) {
      return 'text ~ ' + JSON.stringify('"' + number + '"') + ' OR labels = ' + JSON.stringify(number);
    });
    const jql = '(' + conditions.join(' OR ') + ') ORDER BY updated DESC';
    let nextPageToken = '';
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const payload = { jql: jql, fields: fields, maxResults: 100 };
      if (nextPageToken) payload.nextPageToken = nextPageToken;
      const page = helpdeskJiraRequest_(config, '/rest/api/3/search/jql', payload);
      (page.issues || []).forEach(function(issue) {
        issues[issue.key] = normalizeHelpdeskSyncIssue_(issue, config.baseUrl);
      });
      nextPageToken = page.nextPageToken || '';
      if (page.isLast === true || !nextPageToken) break;
      if (pageCount === 9) warnings.push('연결 후보 조회가 일부 생략됐습니다. Jira 번호로 직접 확인해 주세요.');
    }
  }
  return { issues: Object.keys(issues).map(function(key) { return issues[key]; }), warnings: warnings, keyLookup: keyLookup };
}

function normalizeHelpdeskSyncIssue_(issue, baseUrl) {
  const fields = issue.fields || {};
  const status = fields.status || {};
  const texts = [fields.summary || ''].concat(fields.labels || []);
  function collectText(node) {
    if (!node) return;
    if (typeof node === 'string') { texts.push(node); return; }
    if (node.text) texts.push(node.text);
    if (Array.isArray(node.content)) node.content.forEach(collectText);
  }
  collectText(fields.description);
  const references = texts.join(' ').match(/\bIT-\d{6}-\d{3,}\b/g) || [];
  return {
    key: issue.key,
    url: baseUrl + '/browse/' + issue.key,
    title: fields.summary || '',
    status: status.name || '',
    category: status.statusCategory && status.statusCategory.key || '',
    resolvedAt: fields.resolutiondate || '',
    updatedAt: fields.updated || '',
    issueNumbers: Array.from(new Set(references))
  };
}
