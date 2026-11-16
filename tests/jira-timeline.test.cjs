// 통합 일정(로그인 2단계, v3.2.0) 서버 검증: 옛 일정 서버에서 옮긴 조회·프로젝트 목록·설정 저장이 업무 서버의
// 로그인·도구 키 확인을 거치는지 봅니다. 가짜 Jira·속성·시트로만 돌리며 운영 서버·Jira 는 부르지 않습니다.
// 실행: node tests/jira-timeline.test.cjs
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = ['Code.js', 'Auth.js', 'JiraTimeline.js'].map(f => fs.readFileSync(path.resolve(__dirname, '../backend/' + f), 'utf8')).join('\n');
let passed = 0;
function test(name, run) { run(); console.log('PASS ' + name); passed++; }
const KEY = 'k'.repeat(64), sha = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const issue = (key, project) => ({ id: key, key, fields: { summary: key + ' 요약', project: { key: project, name: project },
  status: { name: '진행 중', statusCategory: { name: 'In Progress', key: 'indeterminate' } }, assignee: { displayName: '담당' },
  duedate: '2026-11-30', customfield_10015: '2026-11-17', issuetype: { name: '작업' }, labels: [] } });

function setup({ account = true, locked = true } = {}) {
  const props = new Map([['AUTH_TOOL_KEYS', JSON.stringify({ 개발팀: sha(KEY) })]]);
  if (locked) props.set('AUTH_REQUIRED', 'Y');
  if (account) { props.set('JIRA_ACCOUNT_EMAIL', 'dev@example.invalid'); props.set('JIRA_API_TOKEN', 'secret-token'); }
  const cache = new Map(), calls = [], log = [];
  const toBytes = value => Array.isArray(value) ? Buffer.from(value.map(b => b & 255)) : Buffer.from(String(value), 'utf8');
  const jira = path => {
    if (path === '/rest/api/3/field') return [{ id: 'customfield_10015', name: 'Start date', schema: { type: 'date' } }];
    if (path === '/rest/api/3/search/jql') return calls.filter(c => c.path === path).length === 1
      ? { issues: [issue('C21R-1', 'C21R')], nextPageToken: 'p2' } : { issues: [issue('ITM-2', 'ITM')], isLast: true };
    if (path.indexOf('/rest/api/3/project/search') === 0) return { values: ['C21R', 'CW2R', 'CWIZ', 'ITM', 'WWWMR'].map(key => ({ key, name: key })), isLast: true };
    throw new Error('예상 밖 Jira 호출 ' + path);
  };
  const context = vm.createContext({
    console: { log() {} }, Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.has(k) ? props.get(k) : null, setProperty: (k, v) => props.set(k, String(v)),
      deleteProperty: k => props.delete(k), getProperties: () => Object.fromEntries(props) }) },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) || null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, value) => [...crypto.createHash('sha256').update(toBytes(value)).digest()].map(b => b > 127 ? b - 256 : b),
      base64Encode: text => Buffer.from(text, 'utf8').toString('base64'), base64EncodeWebSafe: bytes => toBytes(bytes).toString('base64url'),
      newBlob: text => ({ getBytes: () => [...Buffer.from(text, 'utf8')] }), formatDate: () => '2026-11-16T12:00:00+09:00',
      getUuid: () => crypto.randomUUID()
    },
    UrlFetchApp: { fetch: (url, request) => {
      const p = url.replace('https://kic-itsd.atlassian.net', '');
      calls.push({ path: p.split('?')[0], url, request });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(jira(p)) };
    } },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => ({ appendRow: row => log.push([...row]) }) }) },
    ContentService: { MimeType: { TEXT: 'text/plain' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
  });
  vm.runInContext(source, context);
  const req = (action, data = {}, token) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ action, data, requestId: 'kic-test-timeline-1', token }) } }).text);
  return { props, calls, log, req };
}

test('잠금 상태에서 키 없는 일정 요청은 거절하고 Jira 를 부르지 않는다', () => {
  const f = setup();
  for (const action of ['getJiraTimelineConfig', 'getJiraTimelineIssues', 'getJiraTimelineProjects', 'saveJiraTimelineProjects']) {
    assert.equal(f.req(action).code, 'AUTH_REQUIRED', action);
  }
  assert.equal(f.calls.length, 0);
});

test('설정 확인: 웹 조회 스위치 없이 바로 쓸 수 있고, 프로젝트는 기본 5개', () => {
  const f = setup(), config = f.req('getJiraTimelineConfig', {}, KEY);
  assert.equal(config.success, true);
  assert.equal(config.data.enabled, true); assert.equal(config.data.configured, true); assert.deepEqual(config.data.missingProperties, []);
  assert.deepEqual(config.data.projects.map(p => p.key), ['C21R', 'CW2R', 'CWIZ', 'ITM', 'WWWMR']);
  assert.equal(f.props.has('JIRA_TIMELINE_WEB_ENABLED'), false);
});

test('일정 조회: 업무 서버의 Jira 계정으로 두 쪽을 이어 받고, 시작일 칸 번호는 스스로 찾아 저장한다', () => {
  const f = setup(), result = f.req('getJiraTimelineIssues', {}, KEY);
  assert.equal(result.success, true);
  assert.deepEqual(result.data.issues.map(i => i.key), ['C21R-1', 'ITM-2']);
  assert.equal(result.data.issues[0].startDate, '2026-11-17'); assert.equal(result.data.issues[0].url, 'https://kic-itsd.atlassian.net/browse/C21R-1');
  assert.equal(result.data.meta.total, 2); assert.equal(result.data.meta.startDateFieldFound, true);
  assert.equal(f.props.get('JIRA_START_DATE_FIELD_ID'), 'customfield_10015', '복사 없이 자동 저장');
  const search = f.calls.find(c => c.path === '/rest/api/3/search/jql');
  assert.match(JSON.parse(search.request.payload).jql, /^project in \(C21R, CW2R, CWIZ, ITM, WWWMR\) AND statusCategory != Done/);
  assert.equal(search.request.headers.Authorization, 'Basic ' + Buffer.from('dev@example.invalid:secret-token').toString('base64'));
  const before = f.calls.length;
  assert.equal(f.req('getJiraTimelineIssues', {}, KEY).data.meta.cached, true, '3분 캐시');
  assert.equal(f.calls.length, before);
});

test('Jira 계정이 없으면 설정 확인이 빠진 속성을 알려 주고, 조회는 실패 이유를 돌려준다', () => {
  const f = setup({ account: false });
  const config = f.req('getJiraTimelineConfig', {}, KEY).data;
  assert.equal(config.configured, false); assert.deepEqual(config.missingProperties, ['JIRA_ACCOUNT_EMAIL', 'JIRA_API_TOKEN']);
  assert.match(f.req('getJiraTimelineIssues', {}, KEY).error, /필수 Script Properties가 없습니다: JIRA_ACCOUNT_EMAIL, JIRA_API_TOKEN/);
});

test('프로젝트 설정 저장: Jira 에서 못 보는 프로젝트는 거절하고, 저장은 작업 기록에 남는다', () => {
  const f = setup();
  const bad = f.req('saveJiraTimelineProjects', { projects: [{ key: 'XYZ', name: '없는 프로젝트', enabled: true }] }, KEY);
  assert.match(bad.error, /접근할 수 없는 프로젝트가 있습니다: XYZ/);
  const projects = [{ key: 'C21R', name: 'CMS', enabled: true }, { key: 'ITM', name: 'IT 업무', enabled: true }, { key: 'WWWMR', name: '홈페이지', enabled: false }];
  assert.equal(f.req('saveJiraTimelineProjects', { projects }, KEY).success, true);
  assert.deepEqual(JSON.parse(f.props.get('JIRA_TIMELINE_PROJECTS')).map(p => p.key + ':' + p.enabled), ['C21R:true', 'ITM:true', 'WWWMR:false']);
  assert.deepEqual(f.log.at(-1).slice(1), ['개발팀(도구)', '일정 프로젝트 설정', '', 'C21R·ITM']);
  assert.deepEqual(f.req('getJiraTimelineConfig', {}, KEY).data.projects.map(p => p.key), ['C21R', 'ITM', 'WWWMR']);
});

console.log(`\n${passed} timeline tests passed. No live server, Jira or sheets were touched.`);
