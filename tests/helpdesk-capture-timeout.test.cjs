// 응답 지연·늦은 응답·수동 재시도 검증. 실제 API나 시트에 접근하지 않습니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../docs/js/config.js'), 'utf8');
const tests = [];
const test = (name, run) => tests.push({name, run});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
const response = title => ({ok: true, status: 200, text: async () => JSON.stringify({success: true, data: {title}})});
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup(responses) {
  const calls = [], timers = new Map(); let nextTimer = 0;
  const context = vm.createContext({URL, TypeError, AbortController, console: {warn(){}, error(){}},
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, {fn, ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: async (url, options) => {
      calls.push({url, options}); const next = responses.shift();
      if (!next) throw Error('Unexpected extra request');
      return typeof next === 'function' ? next() : next;
    }});
  vm.runInContext(source, context);
  return {context, calls, timers, expire() {
    const timer = [...timers.values()][0]; assert.equal(timer.ms, 30000); timer.fn();
  }};
}
for (const action of ['analyzeCapture', 'analyzeListCapture']) {
  test(action + ': 30초에 종료하고 한 번만 호출하며 이미지·입력은 변경하지 않는다', async () => {
    const f = setup([() => new Promise(() => {})]);
    const data = {images: [{mimeType: 'image/png', data: 'private-image'}], title: '입력한 제목'};
    const before = JSON.stringify(data), pending = f.context.callGASApi(action, data);
    const failed = assert.rejects(pending, error => {
      assert.equal(error.code, 'API_CAPTURE_TIMEOUT');
      assert.match(error.message, /30초.*이미지.*입력 내용.*유지/);
      assert.equal(error.diagnostics.stage, 'request_send');
      return true;
    });
    await flush(); f.expire(); await failed;
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].options.method, 'POST');
    assert.equal(f.calls[0].options.signal.aborted, true); assert.equal(f.timers.size, 0);
    assert.equal(JSON.stringify(data), before);
    const log = JSON.stringify(f.context.getGASDiagnostics());
    assert.match(log, /API_CAPTURE_TIMEOUT/); assert.doesNotMatch(log, /private-image|입력한 제목/);
  });
}
test('응답 본문 읽기가 멈춰도 30초에 종료한다', async () => {
  const f = setup([{...response('unused'), text: () => new Promise(() => {})}]);
  const pending = f.context.callGASApi('analyzeCapture', {});
  const failed = assert.rejects(pending, error => error.code === 'API_CAPTURE_TIMEOUT' && error.httpStatus === 200 && error.diagnostics.stage === 'response_body');
  await flush(); f.expire(); await failed; assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
});
test('성공하면 시간제한을 해제하고 기존 응답을 그대로 반환한다', async () => {
  const f = setup([response('정상 제목')]);
  assert.equal((await f.context.callGASApi('analyzeCapture', {})).title, '정상 제목');
  assert.equal(f.timers.size, 0); assert.equal(f.calls[0].options.signal.aborted, false);
});
test('수동 재시도 후 늦게 도착한 이전 응답은 결과와 성공 로그를 바꾸지 않는다', async () => {
  const old = deferred(), f = setup([() => old.promise, response('새 결과')]);
  let title = '사용자 입력';
  const pending = f.context.callGASApi('analyzeCapture', {}).then(result => { title = result.title; });
  const failed = assert.rejects(pending, error => error.code === 'API_CAPTURE_TIMEOUT');
  await flush(); f.expire(); await failed; assert.equal(title, '사용자 입력');
  title = (await f.context.callGASApi('analyzeCapture', {})).title;
  old.resolve(response('늦은 예전 결과')); await flush();
  assert.equal(title, '새 결과'); assert.equal(f.calls.length, 2);
  const records = f.context.getGASDiagnostics(); assert.equal(records.length, 2);
  assert.equal(records[0].code, 'API_CAPTURE_TIMEOUT'); assert.equal(records[1].outcome, 'success');
  assert.notEqual(records[0].requestId, records[1].requestId); assert.equal(f.timers.size, 0);
});
(async () => {
  for (const {name, run} of tests) { await run(); console.log('PASS ' + name); }
  console.log(`${tests.length} tests passed. No live API or spreadsheet writes.`);
})().catch(error => {console.error(error); process.exitCode = 1;});
