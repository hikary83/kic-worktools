// 헬프데스크 싱크용 조회. 완료 티켓을 포함하며 Jira 데이터는 변경하지 않습니다.
function getHelpdeskJiraSyncIssues_(data) {
  if (requiredProperties_().length) throw new Error('Jira 조회 계정 설정을 확인해 주세요.');
  const config = getJiraConfig_();
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
  const projectKeys = getProjectSettings_().filter(function(project) { return project.enabled; }).map(function(project) { return project.key; });

  // 등록된 링크는 프로젝트 설정·완료 상태에 관계없이 키로 직접 확인합니다.
  for (let offset = 0; offset < keys.length; offset += 20) {
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

  // 링크가 없는 건은 Jira에 명시된 이슈번호만 정확히 연결합니다.
  for (let offset = 0; projectKeys.length && offset < numbers.length; offset += 30) {
    const batch = numbers.slice(offset, offset + 30);
    const conditions = batch.map(function(number) {
      return 'text ~ ' + JSON.stringify('"' + number + '"') + ' OR labels = ' + JSON.stringify(number);
    });
    const jql = 'project in (' + projectKeys.join(',') + ') AND (' + conditions.join(' OR ') + ') ORDER BY updated DESC';
    let nextPageToken = '';
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const payload = { jql: jql, fields: fields, maxResults: 100 };
      if (nextPageToken) payload.nextPageToken = nextPageToken;
      const page = jiraRequest_(config, '/rest/api/3/search/jql', { method: 'post', payload: payload });
      (page.issues || []).forEach(function(issue) {
        issues[issue.key] = normalizeHelpdeskSyncIssue_(issue, config.baseUrl);
      });
      nextPageToken = page.nextPageToken || '';
      if (page.isLast === true || !nextPageToken) break;
      if (pageCount === 9) warnings.push('연결 후보 조회가 일부 생략됐습니다. Jira 번호로 직접 확인해 주세요.');
    }
  }
  return { issues: Object.keys(issues).map(function(key) { return issues[key]; }), warnings: warnings };
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
