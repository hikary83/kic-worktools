// 로그인·계정·도구 키·작업 기록(v3.1.0) 서버 검증. 가짜 속성·캐시·시트로 돌리며 운영 서버·시트는 건드리지 않습니다.
// 실행: node tests/auth.test.cjs
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = ['Code.js', 'Auth.js'].map(f => fs.readFileSync(path.resolve(__dirname, '../backend/' + f), 'utf8')).join('\n');
let passed = 0;
function test(name, run) { run(); console.log('PASS ' + name); passed++; }
const DAY = 864e5;

function setup() {
  let now = Date.parse('2026-11-13T00:00:00Z');
  const props = new Map(), cache = new Map(), log = [], alerts = [], prompts = [], answers = [];
  const toBytes = value => Array.isArray(value) ? Buffer.from(value.map(b => b & 255)) : Buffer.from(String(value), 'utf8');
  const workSheet = { appendRow: row => log.push([...row]), setFrozenRows() {} };
  let workSheetMade = false;
  const spreadsheet = { getSheetByName: name => name === '작업 기록' && workSheetMade ? workSheet : null,
    insertSheet: () => { workSheetMade = true; return workSheet; } };
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const context = vm.createContext({
    Date: Clock, console: { log() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => props.has(k) ? props.get(k) : null, setProperty: (k, v) => props.set(k, String(v)),
      getProperties: () => Object.fromEntries(props), deleteProperty: k => props.delete(k) }) },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) || null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, value) => [...crypto.createHash('sha256').update(toBytes(value)).digest()].map(b => b > 127 ? b - 256 : b),
      getUuid: () => crypto.randomUUID(),
      // 작업 기록 일시는 고정값, 이슈번호 카운터 날짜(yyMMdd)는 한국시간으로 계산합니다.
      formatDate: (date, tz, format) => format === 'yyMMdd' ? new Date(date.getTime() + 9 * 3600e3).toISOString().slice(2, 10).replace(/-/g, '') : '2026-11-13 09:00:00'
    },
    SpreadsheetApp: { openById: () => spreadsheet, getUi: () => ({
      ButtonSet: { OK_CANCEL: 1, YES_NO: 2 }, Button: { OK: 'ok', YES: 'yes' },
      prompt: () => { const text = prompts.shift(); return { getSelectedButton: () => text === null ? 'cancel' : 'ok', getResponseText: () => text }; },
      alert: (...args) => { alerts.push(args.filter(a => typeof a === 'string').join(' | ')); return answers.shift(); } }) },
    Logger: { log() {} },
    ContentService: { MimeType: { TEXT: 'text/plain' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
  });
  vm.runInContext(source, context);
  const req = (action, data = {}, token) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ action, data, requestId: 'kic-test-request-1', token }) } }).text);
  const users = () => JSON.parse(props.get('AUTH_USERS') || '{}');
  const makeAdmin = (password = 'first-pass-1') => { prompts.push('Admin', '관리자', password); context.createFirstAdmin(); };
  const login = (id, password, keep) => req('login', { id, password, keep });
  // 관리자 로그인 → 첫 비밀번호 변경까지 마친 토큰
  const readyAdmin = () => {
    makeAdmin(); const token = login('admin', 'first-pass-1').data.token;
    assert.equal(req('changePassword', { current: 'first-pass-1', next: 'admin-pass-2' }, token).success, true);
    return token;
  };
  return { context, props, cache, log, alerts, prompts, answers, req, users, makeAdmin, login, readyAdmin, advance: ms => { now += ms; } };
}

test('첫 관리자는 시트 메뉴로 한 번만 만들고, 비밀번호 원문은 남지 않는다', () => {
  const f = setup(); f.makeAdmin('first-pass-1');
  const admin = f.users().admin;
  assert.equal(admin.role, 'admin'); assert.equal(admin.mustChange, true); assert.equal(admin.rounds, 500);
  assert.match(admin.hash, /^[0-9a-f]{64}$/); assert.match(admin.salt, /^[0-9a-f]{32}$/);
  assert.doesNotMatch(JSON.stringify([...f.props]), /first-pass-1/);
  assert.match(f.alerts[0], /관리자 「admin」를 만들었습니다[\s\S]*비밀번호 처리 시간 \d+ms/);
  f.makeAdmin('other-pass-1'); assert.match(f.alerts[1], /이미 계정이 있습니다/); assert.equal(Object.keys(f.users()).length, 1);
});

test('아이디별 5번 실패하면 1시간 막고, 맞는 비밀번호도 받지 않는다', () => {
  const f = setup(); const admin = f.readyAdmin();
  f.req('addUser', { id: 'staff', name: '직원', role: 'user' }, admin);
  for (let i = 1; i <= 4; i++) assert.match(f.login('admin', 'wrong-pass').error, new RegExp('남은 기회 ' + (5 - i) + '번'));
  assert.match(f.login('admin', 'wrong-pass').error, /5번 틀려서 1시간/);
  assert.match(f.login('admin', 'admin-pass-2').error, /1시간 동안 이 아이디의 로그인을 막았습니다/);
  assert.match(f.login('staff', 'wrong-pass').error, /남은 기회 4번/, '다른 아이디는 따로 센다');
  f.cache.clear(); // 캐시 1시간이 지나 풀린 상태
  assert.equal(f.login('admin', 'admin-pass-2').success, true);
  assert.match(f.login('nobody', 'whatever-1').error, /아이디나 비밀번호가 맞지 않습니다/, '없는 아이디도 같은 문구');
});

test('확인 보류 중에는 토큰 없는 요청도 받고 「로그인 전」으로 남긴다. 잠그면 거절한다', () => {
  const f = setup();
  assert.equal(f.req('saveDevelopers', { devList: [{ name: 'A' }] }).success, true);
  assert.deepEqual(f.log.at(-1).slice(1, 3), ['로그인 전', '담당자 설정']);
  assert.equal(f.req('saveDevelopers', {}, 'x'.repeat(64)).code, 'AUTH_REQUIRED', '틀린 토큰은 보류 중에도 거절');
  f.props.set('AUTH_REQUIRED', 'Y');
  const refused = f.req('getDashboardData');
  assert.equal(refused.success, false); assert.equal(refused.code, 'AUTH_REQUIRED'); assert.equal(refused.auth, true);
  const get = JSON.parse(f.context.doGet({ parameter: { action: 'getDevelopers' } }).text);
  assert.equal(get.code, 'AUTH_REQUIRED');
});

test('주소창(GET)으로는 블로그 시트 이전·이미지 생성을 할 수 없다', () => {
  const f = setup();
  ['migrateBlogPostingSheet', 'generateBlogImage'].forEach(action =>
    assert.equal(JSON.parse(f.context.doGet({ parameter: { action } }).text).code, 'API_INFO_RESPONSE'));
});

test('첫 로그인은 비밀번호를 바꾸기 전까지 다른 요청을 막고, 바꾼 뒤 이름으로 기록한다', () => {
  const f = setup(); f.makeAdmin();
  const first = f.login('Admin ', 'first-pass-1');
  assert.equal(first.data.mustChange, true); assert.equal(first.data.name, '관리자');
  const token = first.data.token;
  assert.equal(f.req('saveDevelopers', {}, token).code, 'AUTH_PASSWORD_CHANGE');
  assert.match(f.req('changePassword', { current: 'nope-nope', next: 'admin-pass-2' }, token).error, /지금 비밀번호가 맞지 않습니다/);
  assert.match(f.req('changePassword', { current: 'first-pass-1', next: 'short' }, token).error, /8자 이상/);
  assert.equal(f.req('changePassword', { current: 'first-pass-1', next: 'admin-pass-2' }, token).success, true);
  assert.equal(f.req('saveDevelopers', { devList: [] }, token).success, true);
  assert.deepEqual(f.log.map(r => r[1] + '/' + r[2]), ['작업자/작업', '관리자/비밀번호 변경', '관리자/담당자 설정'], '첫 줄은 시트 머리글');
  assert.doesNotMatch(JSON.stringify(f.log), /pass/);
});

test('관리자만 계정을 다루고, 임시 비밀번호를 새로 받으면 그 사람 로그인이 끝난다', () => {
  const f = setup(); const admin = f.readyAdmin();
  const added = f.req('addUser', { id: 'staff', name: '직원', role: 'user' }, admin).data;
  assert.match(added.tempPassword, /^[0-9a-f]{12}$/);
  const list = f.req('listUsers', {}, admin).data;
  assert.deepEqual(list.users.map(u => u.id + ':' + u.role), ['admin:admin', 'staff:user']);
  assert.doesNotMatch(JSON.stringify(list), /hash|salt/);
  assert.deepEqual(list.tools, [{ name: 'CS팀', issued: false }, { name: '블로그팀', issued: false }, { name: '개발팀', issued: false }]);
  const staff = f.login('staff', added.tempPassword).data.token;
  f.req('changePassword', { current: added.tempPassword, next: 'staff-pass-2' }, staff);
  assert.match(f.req('addUser', { id: 'x1x', name: 'x', role: 'admin' }, staff).error, /관리자만/);
  assert.match(f.req('deleteUser', { id: 'admin' }, admin).error, /지금 로그인한 계정은/);
  const reset = f.req('resetUserPassword', { id: 'staff' }, admin).data;
  assert.equal(f.req('getDevelopers', {}, staff).code, 'AUTH_REQUIRED', '옛 세션은 끝남');
  assert.equal(f.login('staff', reset.tempPassword).data.mustChange, true);
  f.req('deleteUser', { id: 'staff' }, admin);
  assert.equal(f.login('staff', reset.tempPassword).success, false);
  assert.deepEqual(f.log.filter(r => r[3] === 'staff').map(r => r[1] + ':' + r[2]), ['관리자:계정 추가', '관리자:임시 비밀번호 발급', '관리자:계정 삭제']);
  assert.doesNotMatch(JSON.stringify(f.log), new RegExp(added.tempPassword + '|' + reset.tempPassword));
});

test('도구 키는 「CS팀(도구)」로 기록되고, 계정은 못 다루며, 다시 발급하면 옛 키가 막힌다', () => {
  const f = setup(); const admin = f.readyAdmin();
  const key = f.req('issueToolKey', { name: 'CS팀' }, admin).data.key;
  assert.match(key, /^[0-9a-f]{64}$/); assert.doesNotMatch(JSON.stringify([...f.props]), new RegExp(key));
  assert.equal(f.req('saveDevelopers', { devList: [] }, key).success, true);
  assert.deepEqual(f.log.at(-1).slice(1, 3), ['CS팀(도구)', '담당자 설정']);
  assert.match(f.req('listUsers', {}, key).error, /도구 키로는 계정을 다룰 수 없습니다/);
  assert.match(f.req('issueToolKey', { name: '아무팀' }, admin).error, /CS팀·블로그팀·개발팀 중 하나/);
  const next = f.req('issueToolKey', { name: 'CS팀' }, admin).data.key;
  assert.equal(f.req('getDevelopers', {}, key).code, 'AUTH_REQUIRED');
  assert.equal(f.req('getDevelopers', {}, next).success, true);
  const dev = f.req('issueToolKey', { name: '개발팀' }, admin).data.key; // 11-13 추가
  assert.equal(f.req('saveDevelopers', { devList: [] }, dev).success, true);
  assert.deepEqual(f.log.at(-1).slice(1, 3), ['개발팀(도구)', '담당자 설정']);
  assert.equal(f.req('getDevelopers', {}, next).success, true, '다른 팀 키 발급은 CS팀 키에 영향 없음');
});

test('로그인 유지 안 함은 1일, 유지는 마지막 사용부터 90일', () => {
  const f = setup(); f.readyAdmin();
  const short = f.login('admin', 'admin-pass-2', false).data.token, keep = f.login('admin', 'admin-pass-2', true).data.token;
  f.advance(DAY - 1000); assert.equal(f.req('getDevelopers', {}, short).success, true);
  f.advance(2000); assert.equal(f.req('getDevelopers', {}, short).code, 'AUTH_REQUIRED');
  f.advance(88 * DAY); assert.equal(f.req('getDevelopers', {}, keep).success, true, '89일째 사용 → 다시 90일');
  f.advance(89 * DAY); assert.equal(f.req('getDevelopers', {}, keep).success, true);
  f.advance(91 * DAY); assert.equal(f.req('getDevelopers', {}, keep).code, 'AUTH_REQUIRED');
});

test('모든 기기 로그아웃은 내 세션만 끝내고, 계정 요청은 토큰이 있어야 한다', () => {
  const f = setup(); const admin = f.readyAdmin();
  const temp = f.req('addUser', { id: 'staff', name: '직원' }, admin).data.tempPassword;
  const staff = f.login('staff', temp).data.token, second = f.login('admin', 'admin-pass-2').data.token;
  assert.equal(f.req('logout', { all: true }, second).success, true);
  assert.equal(f.req('getDevelopers', {}, admin).code, 'AUTH_REQUIRED');
  assert.equal(f.req('logout', {}, staff).success, true, '첫 비밀번호 변경 전에도 로그아웃은 된다');
  assert.equal(f.req('listUsers').code, 'AUTH_REQUIRED', '보류 중에도 계정 요청은 토큰 필수');
});

test('시트 메뉴로 잠금을 켜고 끈다(속성이 50개를 넘어 편집기에서 못 고칠 때)', () => {
  const f = setup();
  f.answers.push('no'); f.context.lockLogin(); assert.equal(f.props.has('AUTH_REQUIRED'), false, '아니요면 그대로');
  f.answers.push('yes'); f.context.lockLogin(); assert.equal(f.props.get('AUTH_REQUIRED'), 'Y');
  assert.match(f.alerts.at(-1), /잠금을 켰습니다/);
  assert.equal(f.req('getDevelopers').code, 'AUTH_REQUIRED');
  assert.equal(JSON.parse(f.context.doGet({ parameter: { action: 'getDevelopers' } }).text).code, 'AUTH_REQUIRED');
  f.answers.push('yes'); f.context.unlockLogin(); assert.equal(f.props.has('AUTH_REQUIRED'), false);
  assert.match(f.alerts.at(-2), /지금: 잠금 켜짐/, '확인 창에 지금 상태가 보인다');
  assert.equal(f.req('getDevelopers').success, true, '끄면 바로 확인 보류로');
});

test('속성 정리는 값 없이 개수만 보여 주고, 2주 지난 번호 카운터와 7일 지난 완료 기록만 지운다', () => {
  const f = setup(), now = Date.parse('2026-11-13T00:00:00Z');
  const seed = { AUTH_REQUIRED: 'Y', GEMINI_API_KEY: 'secret-gemini', DEV_LIST_DATA: '[]',
    HELPDESK_ISSUE_SEQ_261020: '3', HELPDESK_ISSUE_SEQ_261029: '1', HELPDESK_ISSUE_SEQ_261030: '1', HELPDESK_ISSUE_SEQ_261110: '2', // 10-30 은 딱 14일 전이라 남김
    HD_INSERT_DONE_old: JSON.stringify({ savedAt: now - 8 * DAY }), HD_INSERT_DONE_new: JSON.stringify({ savedAt: now - DAY }),
    HELPDESK_INSERT_REVISION_1: '4', HELPDESK_CAPTURE_CONFIRMED_1_abc: 'Y', HELPDESK_JIRA_SYNC_EXCLUDED_1_IT: 'Y' };
  Object.entries(seed).forEach(([k, v]) => f.props.set(k, v));
  f.answers.push('no'); f.context.cleanupScriptProperties();
  assert.equal(f.props.size, 12, '아니요면 그대로');
  const shown = f.alerts.at(-1);
  assert.match(shown, /스크립트 속성 12개[\s\S]*이슈번호 카운터: 4개[\s\S]*누락 점검 확인: 1개[\s\S]*그 밖\(열쇠값·담당자 등\): 2개/);
  assert.match(shown, /이슈번호 카운터\(14일 지난 것\) 2개, 중간 등록 완료 기록\(7일 지난 것\) 1개[\s\S]*정리하면 9개가 남습니다/);
  assert.doesNotMatch(shown, /secret-gemini|savedAt/, '값은 보여 주지 않는다');
  f.answers.push('yes'); f.context.cleanupScriptProperties();
  assert.deepEqual([...f.props.keys()].sort(), ['AUTH_REQUIRED', 'DEV_LIST_DATA', 'GEMINI_API_KEY', 'HD_INSERT_DONE_new', 'HELPDESK_CAPTURE_CONFIRMED_1_abc',
    'HELPDESK_INSERT_REVISION_1', 'HELPDESK_ISSUE_SEQ_261030', 'HELPDESK_ISSUE_SEQ_261110', 'HELPDESK_JIRA_SYNC_EXCLUDED_1_IT']);
  assert.match(f.alerts.at(-1), /3개를 지웠습니다\. 남은 속성 9개/);
  f.context.cleanupScriptProperties(); assert.match(f.alerts.at(-1), /지울 것이 없습니다/);
});

console.log(`\n${passed} auth tests passed. No live server, script properties or sheets were touched.`);
