// 상세 줄바꿈 유지·「부분 수정」(서버 @134, 2026-11-16) 검증. 가짜 시트로만 돌리며 운영 시트·서버는 건드리지 않습니다.
// 실행: node tests/helpdesk-update-fields.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = ['Code.js', 'Auth.js'].map(f => fs.readFileSync(path.resolve(__dirname, '../backend/' + f), 'utf8')).join('\n');
let passed = 0;
function test(name, run) { run(); console.log('PASS ' + name); passed++; }

const DETAILS = '첫 줄입니다.\n둘째 줄 "인용" \'따옴표\'\n경로 C:\\temp';
function setup() {
  // 이슈 한 줄(A~S)을 셀 단위로 읽고 써서 어느 칸이 바뀌었는지 봅니다.
  const cells = ['IT-261116-001', '서울본사', new Date('2026-11-16T00:00:00Z'), "요청자 '홍'", 'CMS', '오류', '보통', '견적', "제목 '따옴표'",
    DETAILS, '이광희', '처리중', '', '처리 1줄\n처리 2줄', '비고 "원문"', '', '', '', ''];
  const writes = [], log = [], identity = [];
  const sheet = { getRange: (row, col, height = 1, width = 1) => ({
    getValues: () => [cells.slice(col - 1, col - 1 + width)],
    setValues: values => values[0].forEach((value, i) => { cells[col - 1 + i] = value; writes.push(col + i); }),
    setValue: value => { cells[col - 1] = value; writes.push(col); },
    setNumberFormat() {}
  }) };
  const quarter = { getRange: (row, col) => ({ setValue: () => writes.push('분기:' + col) }) };
  const workSheet = { appendRow: row => log.push([...row]), setFrozenRows() {} };
  const context = vm.createContext({
    console: { log() {} }, Logger: { log() {} },
    Utilities: { formatDate: () => '2026-11-16 10:00:00', getUuid: () => '00000000-0000-0000-0000-000000000001' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => workSheet }) },
    ContentService: { MimeType: { TEXT: 'text/plain' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
  });
  vm.runInContext(source, context);
  Object.assign(context, { getMainSheet: () => sheet, getQuarterRequestSheet: () => quarter, ensureLinkColumns() {}, findIssueRowById: () => 3,
    assertHelpdeskIdentity_: (_, revision) => identity.push(revision) });
  const req = (action, data) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ action, data, requestId: 'kic-test-fields-01' }) } }).text);
  return { context, cells, writes, log, identity, req };
}

test('목록 조회는 줄바꿈·따옴표·역슬래시를 시트 그대로 돌려준다', () => {
  const f = setup(), item = f.context.buildDashboardIssueObject(f.cells, 'helpdesk');
  assert.equal(item.details, DETAILS); assert.equal(item.title, "제목 '따옴표'");
  assert.equal(item.actionContent, '처리 1줄\n처리 2줄'); assert.equal(item.remark, '비고 "원문"'); assert.equal(item.requester, "요청자 '홍'");
  assert.equal(item.sourceLink, '', '빈 칸은 빈 글자');
});

test('웹 수정 창 왕복(조회 → 그대로 저장)에 제목·상세·처리내용이 바뀌지 않는다', () => {
  const f = setup(), item = f.context.buildDashboardIssueObject(f.cells, 'helpdesk');
  const result = f.req('updateIssue', { id: item.id, sourceType: 'helpdesk', identityRevision: 0, title: item.title, details: item.details, dev: item.dev,
    status: item.status, actionContent: item.actionContent, remark: item.remark, sourceLink: item.sourceLink, jiraLink: item.jiraLink });
  assert.equal(result.success, true);
  assert.equal(f.cells[9], DETAILS); assert.equal(f.cells[8], "제목 '따옴표'"); assert.equal(f.cells[13], '처리 1줄\n처리 2줄');
});

test('부분 수정은 보낸 칸만 그 셀에 쓰고 상세·제목·상태는 건드리지 않는다', () => {
  const f = setup();
  const result = f.req('updateIssueFields', { id: 'IT-261116-001', identityRevision: 7, sourceLink: 'https://boards.office.hiworks.com/board/postview/3616/1', dev: '정희철' });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.fields, ['담당', '원문 링크']);
  assert.deepEqual(f.writes, [11, 16], '담당(K)·원문 링크(P) 셀만');
  assert.equal(f.cells[10], '정희철'); assert.equal(f.cells[15], 'https://boards.office.hiworks.com/board/postview/3616/1');
  assert.equal(f.cells[9], DETAILS); assert.equal(f.cells[8], "제목 '따옴표'"); assert.equal(f.cells[11], '처리중');
  assert.deepEqual(f.identity, [7], '중간 등록 번호 변경 확인(행 확인)을 거친다');
  assert.deepEqual(f.log.at(-1).slice(1), ['로그인 전', '부분 수정', 'IT-261116-001', '담당·원문 링크'], '작업 기록에는 칸 이름만');
});

test('처리내용·비고·Jira 링크도 고치고, 빈 글자를 보내면 그 칸을 비운다', () => {
  const f = setup();
  const result = f.req('updateIssueFields', { id: 'IT-261116-001', identityRevision: 0, actionContent: '', remark: '중복 반려', jiraLink: 'https://kic-itsd.atlassian.net/browse/C21R-1' });
  assert.equal(result.success, true);
  assert.deepEqual(f.writes, [14, 15, 17]);
  assert.equal(f.cells[13], ''); assert.equal(f.cells[14], '중복 반려'); assert.equal(f.cells[16], 'https://kic-itsd.atlassian.net/browse/C21R-1');
  assert.equal(f.log.at(-1)[4], '처리내용·비고·Jira 링크');
});

test('다섯 칸 밖(상세·제목·상태 등)이나 빈 요청·글자 아닌 값은 거절하고 아무것도 쓰지 않는다', () => {
  const f = setup();
  assert.match(f.req('updateIssueFields', { id: 'IT-261116-001', details: '바꾸면 안 됨', dev: '정희철' }).error, /고칠 수 없는 칸입니다: details/);
  assert.match(f.req('updateIssueFields', { id: 'IT-261116-001', title: 'x', status: '완료' }).error, /고칠 수 없는 칸입니다: title, status/);
  assert.match(f.req('updateIssueFields', { id: 'IT-261116-001', identityRevision: 0 }).error, /고칠 칸이 없습니다/);
  assert.match(f.req('updateIssueFields', { id: 'IT-261116-001', dev: 3 }).error, /담당 값은 글자여야/);
  assert.match(f.req('updateIssueFields', { dev: '정희철' }).error, /이슈 ID가 없습니다/);
  assert.deepEqual(f.writes, []); assert.equal(f.log.length, 0);
});

test('분기요청 이슈는 분기요청 시트에 쓰고 헬프데스크 행 확인은 건너뛴다', () => {
  const f = setup();
  assert.equal(f.req('updateIssueFields', { id: 'Q-1', sourceType: 'quarter', sourceLink: 'https://x' }).success, true);
  assert.deepEqual(f.writes, ['분기:16']); assert.deepEqual(f.identity, []);
});

console.log(`\n${passed} update-fields tests passed. No live server or sheets were touched.`);
