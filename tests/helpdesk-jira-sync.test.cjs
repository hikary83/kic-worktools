// 외부 API/운영 시트를 사용하지 않는 싱크 회귀 테스트: node tests/helpdesk-jira-sync.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = 'https://kic-itsd.atlassian.net';
let passed = 0;

function record(id, status = '접수대기', key = '', linked = '') {
  const row = Array(19).fill('');
  Object.assign(row, { 0: id, 1: '서울본사', 8: '테스트 업무', 9: '본문 보존', 11: status,
    13: '=보존할수식()', 14: '비고 보존', 15: 'https://example.test/source', 16: key ? origin + '/browse/' + key : '', 18: linked });
  return row;
}
function jira(key, status = '진행 중', category = 'indeterminate', refs = [], resolvedAt = '') {
  return { key, title: '테스트 Jira 업무', status, category, issueNumbers: refs, resolvedAt };
}
function setup(rows, issues = [], warnings = [], properties = new Map()) {
  const cache = new Map(), writes = [], calls = [];
  let sequence = 0;
  const sheet = {
    getSheetId: () => 123, getMaxColumns: () => 19, getLastRow: () => rows.length + 2,
    getRange: (row, column, height = 1, width = 1) => ({
      getValues: () => rows.slice(row - 3, row - 3 + height).map(values => values.slice(column - 1, column - 1 + width)),
      setValue(value) { writes.push({ row, column, value }); rows[row - 3][column - 1] = value; return this; },
      setNumberFormat() { return this; }
    })
  };
  const context = vm.createContext({
    Date, START_ROW: 3, JIRA_LINK_COLUMN: 17, JIRA_LINKED_COLUMN: 19, HIDDEN_FLAG_COLUMN: 18, NUMBER_FORMAT_DT: 'yyyy-mm-dd hh:mm:ss',
    getMainSheet: () => sheet,
    normalizeIssueStatus: value => String(value || '접수대기').trim(),
    isJiraLinkedFlagValue: value => ['Y', 'TRUE', '연동'].includes(String(value).toUpperCase()),
    isHiddenFlagValue: value => ['Y', 'TRUE', '숨김', '1'].includes(String(value).toUpperCase()),
    findIssueRowById: (_, id) => { const index = rows.findIndex(row => row[0] === id); return index < 0 ? -1 : index + 3; },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value),
      putAll: entries => Object.entries(entries).forEach(([key, value]) => cache.set(key, value)), remove: key => cache.delete(key) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: () => '00000000-0000-0000-0000-' + String(++sequence).padStart(12, '0') },
    SpreadsheetApp: { flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => Object.fromEntries(properties),
      getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value),
      deleteProperty: key => properties.delete(key) }) },
    UrlFetchApp: { fetch: (url, options) => {
      calls.push({ url, payload: JSON.parse(options.payload) });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ success: true, data: { issues, warnings } }) };
    } }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'backend/JiraSync.js'), 'utf8'), context);
  return { context, rows, cache, writes, calls, properties,
    preview: () => context.previewHelpdeskJiraSync(),
    apply: (token, selections) => context.applyHelpdeskJiraSync({ token, selections }),
    lookup: data => context.lookupHelpdeskJiraSync(data),
    setExcluded: data => context.setHelpdeskJiraSyncExcluded(data) };
}
function test(name, run) { run(); console.log('PASS ' + name); passed++; }

test('미리보기는 시트 쓰기 없이 완료 티켓을 제안한다', () => {
  const fixture = setup([record('IT-261001-001', '처리중', 'ITM-1')], [jira('ITM-1', '완료', 'done', [], '2026-10-01T03:00:00Z')]);
  const preview = fixture.preview();
  assert.equal(fixture.writes.length, 0);
  assert.equal(preview.rows[0].candidates[0].changes.find(change => change.field === 'status').to, '완료');
  assert.deepEqual(fixture.calls[0].payload.data.issueKeys, ['ITM-1']);
});
test('연결 후보는 정확한 이슈번호만 사용하고 복수 후보를 보존한다', () => {
  const fixture = setup([record('IT-261001-001'), record('IT-261001-002')], [
    jira('ITM-1', '진행 중', 'indeterminate', ['IT-261001-001']), jira('ITM-2', '진행 중', 'indeterminate', ['IT-261001-001']),
    jira('ITM-3', '완료', 'done', ['IT-261001-003'])
  ]);
  const preview = fixture.preview();
  assert.equal(preview.rows[0].candidates.length, 2);
  assert.equal(preview.rows[1].candidates.length, 0);
  assert.match(preview.rows[0].message, /여러/);
});
test('Jira 조회 실패를 완료로 오인하지 않는다', () => {
  const fixture = setup([record('IT-261001-001', '처리중', 'ITM-404')], [], ['ITM-404: 조회 실패 (404)']);
  const preview = fixture.preview();
  assert.equal(preview.rows[0].candidates.length, 0);
  assert.match(preview.rows[0].message, /조회하지 못/);
  assert.equal(fixture.writes.length, 0);
});
test('종료된 미연결 건은 제외하고 연결된 종료 건은 확인한다', () => {
  const fixture = setup([record('IT-261001-001', '완료'), record('IT-261001-002', '반려', 'ITM-2'), record('IT-261001-003')]);
  assert.equal(fixture.preview().rows.length, 2);
});
test('선택한 상태/해결일만 반영하고 본문·수식·비고·원문은 보존한다', () => {
  const row = record('IT-261001-001', '처리중', 'ITM-1', 'Y');
  const original = row.slice();
  const fixture = setup([row], [jira('ITM-1', '완료', 'done', [], '2026-10-01T03:00:00Z')]);
  const result = fixture.apply(fixture.preview().token, [{ id: row[0], issueKey: 'ITM-1', fields: ['status'] }]);
  assert.equal(result.applied.length, 1);
  assert.equal(row[11], '완료'); assert.equal(row[12].toISOString(), '2026-10-01T03:00:00.000Z');
  for (let column = 0; column < 19; column++) if (![11, 12, 17].includes(column)) assert.equal(row[column], original[column]);
  assert.deepEqual(fixture.writes.map(write => write.column), [12, 13, 18]);
});
test('Jira 링크만 선택하면 상태와 연동 표시는 바뀌지 않는다', () => {
  const row = record('IT-261001-001');
  const fixture = setup([row], [jira('ITM-1', '완료', 'done', [row[0]])]);
  fixture.apply(fixture.preview().token, [{ id: row[0], issueKey: 'ITM-1', fields: ['jiraLink'] }]);
  assert.equal(row[16], origin + '/browse/ITM-1'); assert.equal(row[11], '접수대기'); assert.equal(row[18], '');
  assert.deepEqual(fixture.writes.map(write => write.column), [17]);
});
test('같은 Jira 이슈번호여도 추적값·해시·끝 슬래시·대소문자가 다르면 주소 정리를 제안한다', () => {
  const urls = [origin + '/browse/ITM-1?atlOrigin=tracking', origin + '/browse/ITM-1#comment-100',
    origin + '/browse/ITM-1/', origin + '/browse/ITM-1/?atlOrigin=tracking#comment-100',
    '  ' + origin + '/browse/itm-1?foo=bar  '];
  urls.forEach(url => {
    const row = record('IT-261001-001', '처리중', 'ITM-1', 'Y'); row[16] = url;
    const fixture = setup([row], [jira('ITM-1')]);
    const preview = fixture.preview();
    assert.equal(preview.rows[0].candidates.length, 1);
    assert.deepEqual(Array.from(preview.rows[0].candidates[0].changes, change => change.field), ['jiraLink']);
    assert.equal(row[16], url); assert.equal(fixture.writes.length, 0);
  });
});
test('주소 정리를 제안해도 상태·연동 표시만 선택하면 원래 링크를 보존한다', () => {
  const row = record('IT-261001-001', '접수대기', 'ITM-1');
  row[16] += '?atlOrigin=tracking';
  const originalLink = row[16];
  const fixture = setup([row], [jira('ITM-1')]);
  const preview = fixture.preview();
  assert.deepEqual(Array.from(preview.rows[0].candidates[0].changes, change => change.field), ['jiraLink', 'jiraLinked', 'status']);
  const result = fixture.apply(preview.token, [{ id: row[0], issueKey: 'ITM-1', fields: ['jiraLinked', 'status'] }]);
  assert.equal(result.applied.length, 1); assert.equal(row[11], '처리중'); assert.equal(row[18], 'Y');
  assert.equal(row[16], originalLink);
  assert.ok(!fixture.writes.some(write => write.column === 17));
});
test('번호가 다른 후보와 잘못된 테넌트는 Jira 링크 변경을 계속 제안한다', () => {
  const row = record('IT-261001-001', '처리중', 'ITM-10', 'Y');
  const fixture = setup([row], [jira('ITM-1'), jira('ITM-10')]);
  const preview = fixture.preview();
  const lookedUp = fixture.lookup({ token: preview.token, id: row[0], issueKey: 'ITM-1' });
  assert.ok(lookedUp.candidates.find(issue => issue.key === 'ITM-1').changes.some(change => change.field === 'jiraLink'));
  const bad = record('IT-261001-002', '처리중', '', 'Y'); bad[16] = 'https://evil.test/browse/ITM-1?atlOrigin=tracking';
  const external = setup([bad], [jira('ITM-1')]); const externalPreview = external.preview();
  const fixed = external.lookup({ token: externalPreview.token, id: bad[0], issueKey: 'ITM-1' });
  assert.ok(fixed.candidates[0].changes.some(change => change.field === 'jiraLink'));
  assert.equal(fixture.writes.length, 0); assert.equal(external.writes.length, 0);
});
test('같은 번호의 주소 정리도 명시적으로 선택한 경우에만 저장한다', () => {
  const row = record('IT-261001-001', '처리중', 'ITM-1', 'Y'); row[16] += '?atlOrigin=tracking';
  const fixture = setup([row], [jira('ITM-1')]);
  fixture.apply(fixture.preview().token, [{ id: row[0], issueKey: 'ITM-1', fields: ['jiraLink'] }]);
  assert.equal(row[16], origin + '/browse/ITM-1'); assert.equal(row[11], '처리중'); assert.equal(row[18], 'Y');
  assert.deepEqual(fixture.writes.map(write => write.column), [17]);
});

test('팀 공통 싱크 제외는 별도 설정에만 저장하고 다른 사용자·새 조회에도 유지한다', () => {
  const row = record('IT-261001-001', '접수대기', 'ITM-1');
  const original = row.slice();
  const properties = new Map([['OTHER_SETTING', 'keep']]);
  const fixture = setup([row], [jira('ITM-1')], [], properties);
  const preview = fixture.preview();
  assert.equal(preview.exclusionSupported, true); assert.equal(preview.rows[0].excluded, false);
  assert.equal(fixture.setExcluded({ token: preview.token, id: row[0], excluded: true }).excluded, true);
  assert.equal(properties.get('HELPDESK_JIRA_SYNC_EXCLUDED_123_' + row[0]), 'Y');
  assert.equal(fixture.preview().rows[0].excluded, true);
  const teammate = setup([row], [jira('ITM-1')], [], properties);
  assert.equal(teammate.preview().rows[0].excluded, true);
  assert.deepEqual(row, original); assert.equal(fixture.writes.length, 0);
  assert.equal(properties.get('OTHER_SETTING'), 'keep');
});

test('전체에서 제외를 해제하면 동일 변경안으로 돌아오고 다른 이슈의 제외는 유지한다', () => {
  const row = record('IT-261001-001', '접수대기', 'ITM-1');
  const properties = new Map([['HELPDESK_JIRA_SYNC_EXCLUDED_123_' + row[0], 'Y'], ['HELPDESK_JIRA_SYNC_EXCLUDED_123_IT-261001-002', 'Y']]);
  const fixture = setup([row], [jira('ITM-1')], [], properties); const preview = fixture.preview();
  assert.equal(preview.rows[0].excluded, true);
  const before = JSON.stringify(preview.rows[0].candidates);
  fixture.setExcluded({ token: preview.token, id: row[0], excluded: false });
  const restored = fixture.preview().rows[0];
  assert.equal(restored.excluded, false); assert.equal(JSON.stringify(restored.candidates), before);
  assert.equal(properties.has('HELPDESK_JIRA_SYNC_EXCLUDED_123_' + row[0]), false);
  assert.equal(properties.get('HELPDESK_JIRA_SYNC_EXCLUDED_123_IT-261001-002'), 'Y');
  assert.equal(fixture.writes.length, 0);
});

test('다른 팀원이 조회 후 제외한 이슈는 적용에서 건너뛰고 나머지만 반영한다', () => {
  const rows = [record('IT-261001-001', '접수대기', 'ITM-1'), record('IT-261001-002', '접수대기', 'ITM-2')];
  const fixture = setup(rows, [jira('ITM-1'), jira('ITM-2')]); const original = rows[0].slice();
  const oldPreview = fixture.preview(), teammatePreview = fixture.preview();
  fixture.setExcluded({ token: teammatePreview.token, id: rows[0][0], excluded: true });
  const result = fixture.apply(oldPreview.token, rows.map((row, index) => ({ id: row[0], issueKey: 'ITM-' + (index + 1), fields: ['status'] })));
  assert.equal(result.applied.length, 1); assert.equal(result.applied[0].id, rows[1][0]);
  assert.equal(result.skipped.length, 1); assert.match(result.skipped[0].reason, /싱크 제외/);
  assert.deepEqual(rows[0], original); assert.equal(rows[1][11], '처리중');
});

test('제외했던 미연결 건이 완료·반려돼도 전체에서 해제할 수 있도록 반환한다', () => {
  const rows = [record('IT-261001-001', '완료'), record('IT-261001-002', '반려'), record('IT-261001-003', '완료')];
  const properties = new Map(rows.slice(0, 2).map(row => ['HELPDESK_JIRA_SYNC_EXCLUDED_123_' + row[0], 'Y']));
  const fixture = setup(rows, [], [], properties); const preview = fixture.preview();
  assert.equal(preview.rows.length, 2); assert.ok(preview.rows.every(row => row.excluded));
  fixture.setExcluded({ token: preview.token, id: rows[0][0], excluded: false });
  assert.equal(fixture.preview().rows.length, 1); assert.equal(fixture.writes.length, 0);
});

test('싱크 제외는 시트별로 격리하고 기존 숨김·일정 제외 표시와 섞지 않는다', () => {
  const row = record('IT-261001-001', '처리중', 'ITM-1', 'Y'); row[17] = 'Y';
  const fixture = setup([row], [jira('ITM-1')], [], new Map([
    ['HELPDESK_JIRA_SYNC_EXCLUDED_456_' + row[0], 'Y'], ['HELPDESK_JIRA_SYNC_EXCLUDED_123_IT-BAD', 'Y']
  ]));
  const preview = fixture.preview(); assert.equal(preview.rows[0].excluded, false);
  fixture.setExcluded({ token: preview.token, id: row[0], excluded: true });
  fixture.setExcluded({ token: preview.token, id: row[0], excluded: false });
  assert.equal(row[17], 'Y'); assert.equal(fixture.writes.length, 0);
});

test('제외된 이슈는 수동 조회도 차단하고 해제 후에는 기존 미리보기로 조회 가능하다', () => {
  const row = record('IT-261001-001'); const fixture = setup([row], [jira('ITM-99')]); const preview = fixture.preview();
  fixture.setExcluded({ token: preview.token, id: row[0], excluded: true });
  const before = fixture.calls.length;
  assert.throws(() => fixture.lookup({ token: preview.token, id: row[0], issueKey: 'ITM-99' }), /제외된/);
  assert.equal(fixture.calls.length, before);
  fixture.setExcluded({ token: preview.token, id: row[0], excluded: false });
  const restored = fixture.lookup({ token: preview.token, id: row[0], issueKey: 'ITM-99' });
  assert.equal(restored.excluded, false); assert.equal(restored.candidates[0].key, 'ITM-99');
});

test('임의 번호·문자열 설정·만료·삭제된 이슈의 제외 요청은 저장하지 않는다', () => {
  const row = record('IT-261001-001'); const fixture = setup([row]); const preview = fixture.preview();
  assert.throws(() => fixture.setExcluded({ token: preview.token, id: row[0], excluded: 'false' }), /설정/);
  assert.throws(() => fixture.setExcluded({ token: preview.token, id: 'IT-261001-999', excluded: true }), /다시 조회/);
  assert.throws(() => fixture.setExcluded({ token: 'invalid', id: row[0], excluded: true }), /다시 조회/);
  row[0] = 'IT-261001-002';
  assert.throws(() => fixture.setExcluded({ token: preview.token, id: 'IT-261001-001', excluded: true }), /찾을 수/);
  fixture.cache.clear();
  assert.throws(() => fixture.setExcluded({ token: preview.token, id: row[0], excluded: true }), /유효시간/);
  assert.equal(fixture.properties.size, 0); assert.equal(fixture.writes.length, 0);
});
test('새 후보의 상태만 기존 링크에 적용할 수 없다', () => {
  const fixture = setup([record('IT-261001-001')], [jira('ITM-1', '완료', 'done', ['IT-261001-001'])]);
  assert.throws(() => fixture.apply(fixture.preview().token, [{ id: 'IT-261001-001', issueKey: 'ITM-1', fields: ['status'] }]), /링크 변경/);
  assert.equal(fixture.writes.length, 0);
});
test('조회 후 변경된 행은 건너뛴다', () => {
  const row = record('IT-261001-001', '접수대기', 'ITM-1');
  const fixture = setup([row], [jira('ITM-1')]); const preview = fixture.preview(); row[11] = '검토중';
  const result = fixture.apply(preview.token, [{ id: row[0], issueKey: 'ITM-1', fields: ['status'] }]);
  assert.equal(result.applied.length, 0); assert.equal(result.skipped.length, 1); assert.equal(fixture.writes.length, 0);
});
test('만료·중복 적용·임의 컬럼 변경을 차단한다', () => {
  const fixture = setup([record('IT-261001-001', '접수대기', 'ITM-1')], [jira('ITM-1')]);
  const preview = fixture.preview();
  assert.throws(() => fixture.apply(preview.token, [{ id: 'IT-261001-001', issueKey: 'ITM-1', fields: ['title'] }]), /허용되지/);
  assert.equal(fixture.writes.length, 0);
  fixture.apply(preview.token, [{ id: 'IT-261001-001', issueKey: 'ITM-1', fields: ['status'] }]);
  assert.throws(() => fixture.apply(preview.token, [{ id: 'IT-261001-001', issueKey: 'ITM-1', fields: ['status'] }]), /유효시간/);
  const next = fixture.preview(); fixture.cache.clear();
  assert.throws(() => fixture.lookup({ token: next.token, id: 'IT-261001-001', issueKey: 'ITM-1' }), /유효시간/);
});
test('해결일이 없으면 임의의 완료일을 만들지 않고 재개하면 완료일을 비운다', () => {
  const row = record('IT-261001-001', '처리중', 'ITM-1', 'Y'); row[12] = new Date('2026-09-30T02:00:00Z');
  const fixture = setup([row], [jira('ITM-1', '완료', 'done')]);
  fixture.apply(fixture.preview().token, [{ id: row[0], issueKey: 'ITM-1', fields: ['status'] }]);
  assert.equal(row[12].toISOString(), '2026-09-30T02:00:00.000Z');
  const reopen = setup([row], [jira('ITM-1', '진행 중', 'indeterminate')]);
  reopen.apply(reopen.preview().token, [{ id: row[0], issueKey: 'ITM-1', fields: ['status'] }]);
  assert.equal(row[12], '');
});
test('수동 조회는 후보만 추가하며 시트는 변경하지 않는다', () => {
  const fixture = setup([record('IT-261001-001')], [jira('ITM-99')]);
  const preview = fixture.preview(); assert.equal(preview.rows[0].candidates.length, 0);
  const row = fixture.lookup({ token: preview.token, id: 'IT-261001-001', issueKey: 'itm-99' });
  assert.equal(row.candidates[0].key, 'ITM-99'); assert.equal(fixture.writes.length, 0);
});
test('미리보기와 수동 조회 응답 모두 원문 링크를 유지한다', () => {
  const source = 'https://example.test/board?post=123&section=it';
  const recordRow = record('IT-261001-001'); recordRow[15] = source;
  const fixture = setup([recordRow], [jira('ITM-99')]);
  const preview = fixture.preview();
  assert.equal(preview.rows[0].sourceLink, source);
  const row = fixture.lookup({ token: preview.token, id: recordRow[0], issueKey: 'ITM-99' });
  assert.equal(row.sourceLink, source);
  assert.equal(fixture.writes.length, 0);
});
test('외부 테넌트 링크/모르는 상태를 자동 판단하지 않는다', () => {
  const fixture = setup([]); const ctx = fixture.context;
  assert.equal(ctx.helpdeskJiraKey_('https://evil.test/browse/ITM-1'), '');
  assert.equal(ctx.helpdeskJiraKey_(origin + '/browse/ITM-1?foo=1'), 'ITM-1');
  assert.equal(ctx.helpdeskJiraStatus_({ status: 'Custom unknown' }), '');
  assert.equal(ctx.helpdeskJiraStatus_({ status: 'Cancelled', category: 'done' }), '반려');
});

test('Jira 전용 조회는 Done 필터 없이 페이지를 읽고 ADF/레이블의 이슈번호를 추출한다', () => {
  const requests = [];
  const context = vm.createContext({
    requiredProperties_: () => [], getJiraConfig_: () => ({ baseUrl: origin, email: 'test', apiToken: 'test' }),
    getProjectSettings_: () => [{ key: 'ITM', enabled: true }],
    jiraRequest_: (_, url, options) => {
      requests.push({ url, options });
      return { isLast: true, issues: [{ key: 'ITM-1', fields: { summary: '완료 업무', labels: ['IT-261001-002'],
        description: { content: [{ content: [{ text: '관련 이슈 IT-261001-001' }] }] }, status: { name: '완료', statusCategory: { key: 'done' } } } }] };
    }, Utilities: { base64Encode: value => value }, UrlFetchApp: { fetchAll: () => [] }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'jira-api/HelpdeskSync.js'), 'utf8'), context);
  const result = context.getHelpdeskJiraSyncIssues_({ issueNumbers: ['IT-261001-001'] });
  assert.equal(result.issues[0].category, 'done');
  assert.deepEqual(Array.from(result.issues[0].issueNumbers).sort(), ['IT-261001-001', 'IT-261001-002']);
  assert.equal(requests[0].url, '/rest/api/3/search/jql');
  assert.ok(!requests[0].options.payload.jql.includes('statusCategory'));
  assert.ok(requests[0].options.payload.jql.includes('text ~ "\\"IT-261001-001\\""'));
});

console.log(`\n${passed} tests passed. No live API or spreadsheet writes.`);
