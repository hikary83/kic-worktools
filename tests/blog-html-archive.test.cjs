// 블로그 원문 HTML 보관·내려받기(v3.2.2, 서버 @136, 2026-11-27) 검증. 가짜 시트·가짜 드라이브로만 돌리며 운영 시트·서버는 건드리지 않습니다.
// 실행: node tests/blog-html-archive.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = ['Code.js', 'Auth.js'].map(f => fs.readFileSync(path.join(root, 'backend', f), 'utf8')).join('\n');
let passed = 0;
function test(name, run) { run(); console.log('PASS ' + name); passed++; }

const HTML = '<!DOCTYPE html>\n<html lang="ko"><head><meta charset="utf-8"><title>12-15</title></head><body><p>본문 "따옴표" ▲</p></body></html>';
function setup() {
  const grid = [
    ['No', '포스팅 일자', '카테고리', '주제', '키워드/자료', '비고', '포스팅 여부', '포스팅 URL'],
    [74, '2026-12-01 (화)', '02_솔루션', '교정 성적서 관리', '', '', '△', ''],
    [75, '2026-12-15 (화)', '01_이론', '2026년 측정/품질 이슈 총결산', '', '', '', '']
  ];
  const width = () => Math.max(...grid.map(r => r.length));
  // dropdown: 드롭다운 칸(목록에 없는 값은 버려짐, 설정을 풀면 받음) · stuck: 무엇을 해도 안 받는 칸
  const dropdown = new Set(), stuck = new Set();
  const range = (r, c, h = 1, w = 1) => ({
    getValues: () => Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
    getValue: () => (grid[r - 1] || [])[c - 1] ?? '',
    setValue(v) { if (dropdown.has(r + ',' + c) || stuck.has(r + ',' + c)) return this; while (grid[r - 1].length < c) grid[r - 1].push(''); grid[r - 1][c - 1] = v; return this; },
    clearDataValidations() { dropdown.delete(r + ',' + c); return this; },
    setBackground() { return this; }, setFontWeight() { return this; }, setHorizontalAlignment() { return this; }
  });
  const sheet = { getLastRow: () => grid.length, getLastColumn: width, getMaxColumns: () => 26, insertColumnsAfter() {}, getRange: range };

  const files = {}, props = {};
  let nextId = 1;
  const makeFile = blob => {
    const id = 'file' + String(nextId++).padStart(30, '0'), f = { trashed: false };
    Object.assign(f, { getId: () => id, getName: () => blob.name, getUrl: () => `https://drive.google.com/file/d/${id}/view?usp=drivesdk`,
      getBlob: () => ({ getDataAsString: () => blob.data }), setTrashed: t => { f.trashed = t; }, isTrashed: () => f.trashed });
    return (files[id] = f);
  };
  const folders = [];
  const DriveApp = {
    createFolder: name => { const id = 'folder' + folders.length + '0'.repeat(25), f = { name, getId: () => id, getUrl: () => 'https://drive.google.com/drive/folders/' + id, isTrashed: () => false, createFile: makeFile,
      getFilesByName: n => { const list = Object.values(files).filter(x => x.getName() === n); return { hasNext: () => list.length > 0, next: () => list.shift() }; } }; folders.push(f); return f; },
    getFolderById: id => { const f = folders.find(x => x.getId() === id); if (!f) throw new Error('no folder'); return f; },
    getFileById: id => { if (!files[id]) throw new Error('no file'); return files[id]; }
  };
  const log = [], workSheet = { appendRow: row => log.push([...row]), setFrozenRows() {} };
  const context = vm.createContext({
    console: { log() {} }, Logger: { log() {} }, DriveApp,
    Utilities: { formatDate: () => '2026-11-27 10:00:00', getUuid: () => '00000000-0000-0000-0000-000000000001', newBlob: (data, type, name) => ({ data, type, name }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => workSheet }), flush() {} },
    ContentService: { MimeType: { TEXT: 'text/plain' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
  });
  vm.runInContext(source, context);
  Object.assign(context, { getBlogPostingSheet: () => sheet });
  const req = (action, data) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ action, data, requestId: 'kic-test-blog-html-01' }) } }).text);
  return { grid, files, folders, props, log, req, context, dropdown, stuck };
}

test('저장하면 드라이브 폴더에 파일을 만들고 「원문 HTML」 열에 주소를 적는다', () => {
  const f = setup();
  const res = f.req('saveBlogPostHtml', { row: 3, date: '2026-12-15', html: HTML });
  assert.equal(res.success, true, res.error);
  assert.equal(res.data.name, '2026-12-15_2026년 측정품질 이슈 총결산.html', '파일 이름에서 / 같은 글자는 뺀다');
  assert.equal(f.folders.length, 1); assert.equal(f.folders[0].name, 'KIC 블로그 원문');
  assert.equal(f.grid[0][8], '원문 HTML', '맨 뒤(I열)에 머리글을 만든다');
  assert.match(f.grid[2][8], /^https:\/\/drive\.google\.com\/file\/d\//);
  assert.equal(f.grid[2][6], '', '상태 칸은 그대로'); assert.equal(f.grid[2][7], '', 'URL 칸은 그대로');
  assert.deepEqual(f.log.at(-1).slice(1), ['로그인 전', '블로그 원문 등록', '3행', ''], '작업 기록에 본문은 남기지 않는다');
  const plans = f.req('getBlogPostPlans', {}).data;
  assert.deepEqual(plans.map(p => [p.row, p.hasHtml]), [[2, false], [3, true]]);
  assert.equal(plans[1].postUrl, '', '원문 열을 포스팅 URL 로 읽지 않는다');
});

test('내려받기는 같은 내용과 파일 이름을 돌려준다', () => {
  const f = setup();
  f.req('saveBlogPostHtml', { row: 3, date: '2026-12-15', html: HTML });
  const res = f.req('getBlogPostHtml', { row: 3, date: '2026-12-15' });
  assert.equal(res.success, true, res.error);
  assert.equal(res.data.html, HTML); assert.equal(res.data.name, '2026-12-15_2026년 측정품질 이슈 총결산.html');
});

test('다시 올리면 새 파일로 바꾸고 이전 파일은 휴지통으로, 폴더는 다시 만들지 않는다', () => {
  const f = setup();
  f.req('saveBlogPostHtml', { row: 3, date: '2026-12-15', html: HTML });
  const first = f.grid[2][8];
  f.req('saveBlogPostHtml', { row: 3, date: '2026-12-15', html: HTML.replace('본문', '고친 본문') });
  assert.notEqual(f.grid[2][8], first);
  assert.deepEqual(Object.values(f.files).map(x => x.isTrashed()), [true, false]);
  assert.equal(f.folders.length, 1);
  assert.match(f.req('getBlogPostHtml', { row: 3, date: '2026-12-15' }).data.html, /고친 본문/);
});

test('드롭다운 칸이면 그 칸 설정만 풀고 적는다 · 그래도 안 들어가면 실패로 답하고 새 파일은 휴지통으로', () => {
  const f = setup();
  f.grid[0].push('원문 HTML');
  f.dropdown.add('3,9');
  const ok = f.req('saveBlogPostHtml', { row: 3, date: '2026-12-15', html: HTML });
  assert.equal(ok.success, true, ok.error);
  assert.match(f.grid[2][8], /^https:\/\/drive\.google\.com\/file\/d\//);
  f.stuck.add('2,9');
  const bad = f.req('saveBlogPostHtml', { row: 2, date: '2026-12-01', html: HTML });
  assert.match(bad.error, /2행 「원문 HTML」 칸에 파일 주소가 들어가지 않았습니다/);
  assert.deepEqual(Object.values(f.files).map(x => x.isTrashed()), [false, true], '실패한 새 파일만 휴지통');
});

test('시트와 연결이 끊긴 같은 이름 파일은 다시 올릴 때 휴지통으로 보낸다', () => {
  const f = setup();
  f.grid[0].push('원문 HTML');
  f.stuck.add('3,9');
  f.req('saveBlogPostHtml', { row: 3, date: '2026-12-15', html: HTML });
  f.stuck.delete('3,9');
  const orphan = Object.values(f.files)[0];
  orphan.setTrashed(false); // 예전 서버가 남긴, 시트와 연결 안 된 파일
  const res = f.req('saveBlogPostHtml', { row: 3, date: '2026-12-15', html: HTML });
  assert.equal(res.success, true, res.error);
  assert.equal(orphan.isTrashed(), true);
  assert.equal(Object.values(f.files).filter(x => !x.isTrashed()).length, 1);
});

test('행과 날짜가 다르거나 HTML 이 아니면 거절하고 아무것도 만들지 않는다', () => {
  const f = setup();
  assert.match(f.req('saveBlogPostHtml', { row: 2, date: '2026-12-15', html: HTML }).error, /2행 일자\(2026-12-01 \(화\)\)가 2026-12-15과 다릅니다/);
  assert.match(f.req('saveBlogPostHtml', { row: 3, html: HTML }).error, /빈 값과 다릅니다/);
  assert.match(f.req('saveBlogPostHtml', { row: 9, date: '2026-12-15', html: HTML }).error, /유효하지 않은 행 번호/);
  assert.match(f.req('saveBlogPostHtml', { row: 3, date: '2026-12-15', html: '그냥 글' }).error, /HTML 문서가 아닙니다/);
  assert.equal(Object.keys(f.files).length, 0); assert.equal(f.folders.length, 0); assert.equal(f.grid[0].length, 8, '열도 만들지 않는다');
  assert.match(f.req('getBlogPostHtml', { row: 3, date: '2026-12-15' }).error, /등록된 원문이 없습니다/);
  f.req('saveBlogPostHtml', { row: 3, date: '2026-12-15', html: HTML });
  assert.match(f.req('getBlogPostHtml', { row: 3, date: '2026-12-01' }).error, /다릅니다/, '내려받기도 날짜를 맞춰 본다');
});

test('편집기용 prepareBlogHtmlFolder 는 드라이브 권한을 먼저 확인하고 폴더 주소를 돌려준다', () => {
  const f = setup(), asked = [];
  f.context.ScriptApp = { AuthMode: { FULL: 'FULL' }, requireScopes: (mode, scopes) => asked.push([mode, ...scopes]) };
  assert.equal(f.context.prepareBlogHtmlFolder(), 'https://drive.google.com/drive/folders/' + f.folders[0].getId());
  assert.deepEqual(asked, [['FULL', 'https://www.googleapis.com/auth/drive']]);
  assert.equal(f.folders[0].name, 'KIC 블로그 원문');
  f.context.prepareBlogHtmlFolder();
  assert.equal(f.folders.length, 1, '두 번 실행해도 폴더는 하나');
});

test('창 뒤 막은 글자색이 아니라 공용 막 색을 쓰고, 일정 상세 창에 「원문 다운」 버튼이 있다', () => {
  for (const page of fs.readdirSync(path.join(root, 'docs')).filter(n => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, 'docs', page), 'utf8');
    assert.doesNotMatch(html, /fixed inset-0[^"]*bg-\[var\(--ink\)\]/, page + ': 창 뒤 막이 글자색이면 어두운 테마에서 하얗게 보인다');
  }
  const marketer = fs.readFileSync(path.join(root, 'docs', 'marketer.html'), 'utf8');
  assert.match(marketer, /id="modal-btn-html" onclick="downloadModalPlanHtml\(\)"/);
  assert.match(marketer, /runServerFunction\('getBlogPostHtml', \{ row: plan\.row, date:/);
});

console.log(`${passed} passed`);
