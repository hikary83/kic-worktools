// 공통 API 오류 표시 회귀 테스트. 외부 API·운영 데이터 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../docs/js/config.js'), 'utf8');
const tests = [];
const test = (name, run) => tests.push({ name, run });
const response = (body, status = 200, raw = false) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => raw ? body : JSON.stringify(body)
});
function setup(responses, extra = {}) {
  const calls = [], logs = [];
  const context = vm.createContext({
    TypeError, URL,
    console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error('Unexpected extra request');
      return next;
    },
    ...extra
  });
  vm.runInContext(source, context);
  return { context, calls, logs, run: (action = 'generateReply') => context.callGASApi(action, {}) };
}
async function failure(fixture, pattern, code, action) {
  await assert.rejects(fixture.run(action), error => {
    assert.match(error.message, pattern);
    if (code) assert.equal(error.code, code);
    return true;
  });
}

test('성공 응답의 기존 데이터 구조를 유지한다', async () => {
  const f = setup([response({ success: true, data: { text: '정상 답변' } })]);
  assert.equal((await f.run()).text, '정상 답변');
});
test('서버 message를 버리지 않고 표시한다', async () => {
  await failure(setup([response({ success: false, message: '서버 상세 이유' })]), /서버 상세 이유/, 'API_EXECUTION_ERROR');
});
test('HTTP 200 서버 안내 응답을 시간초과로 단정하지 않는다', async () => {
  const f = setup([response({ success: false, message: 'KIC API Server is running. Please use GitHub Pages frontend to access UI.' })]);
  await assert.rejects(f.run(), error => {
    assert.equal(error.code, 'API_INFO_RESPONSE');
    assert.equal(error.httpStatus, 200);
    assert.match(error.message, /정상 처리 여부를 확인하지 못했습니다/);
    assert.doesNotMatch(error.message, /지연|시간초과|한도 초과/);
    return true;
  });
});
test('서버 안내 오류 코드도 인식한다', async () => {
  await failure(setup([response({ success: false, code: 'API_INFO_RESPONSE' })]), /서버 안내/, 'API_INFO_RESPONSE');
});
test('정보 없는 실패는 원인 미확인으로 표시한다', async () => {
  await failure(setup([response({ success: false })]), /원인을 확인하지 못했습니다/, 'API_ERROR_NO_DETAILS');
});
test('429 한도 초과는 모델의 원래 오류도 표시한다', async () => {
  await failure(setup([response({ success: false, error: 'Error: gemini-2.5-flash: HTTP 429 - Resource exhausted' })]), /한도 초과\(429\)[\s\S]*gemini-2.5-flash/, 'UPSTREAM_RATE_LIMIT');
});
test('구조화된 오류 코드만 있어도 429를 식별한다', async () => {
  await failure(setup([response({ success: false, error: { code: 429 } })]), /한도 초과/, 'UPSTREAM_RATE_LIMIT');
});
test('503 일시 오류와 원문을 함께 표시한다', async () => {
  await failure(setup([response({ success: false, error: { code: 503, message: 'UNAVAILABLE: busy' } })]), /일시 오류\(503\)[\s\S]*busy/, 'UPSTREAM_UNAVAILABLE');
});
test('인증 오류를 구분한다', async () => {
  await failure(setup([response({ success: false, error: '인증 오류: permission denied' })]), /인증 또는 접근 권한/, 'UPSTREAM_AUTH_ERROR');
});
test('알 수 없는 서버 오류는 원래 설명을 보존한다', async () => {
  await failure(setup([response({ success: false, error: 'Error: Spreadsheet unavailable' })]), /Spreadsheet unavailable/, 'API_EXECUTION_ERROR');
});
test('HTML 응답 본문은 화면에 덤프하지 않는다', async () => {
  await failure(setup([response('<html>private page</html>', 200, true)]), /다른 형식/, 'API_INVALID_RESPONSE');
});
for (const invalid of [null, [], 'hello']) {
  test('잘못된 JSON 응답 구조: ' + JSON.stringify(invalid), async () => {
    await failure(setup([response(invalid)]), /응답 구조/, 'API_INVALID_RESPONSE');
  });
}
test('실제 요청 서버 HTTP 오류와 상세 이유를 보존한다', async () => {
  await failure(setup([response({ error: { message: 'Service unavailable' } }, 503)]), /HTTP 503[\s\S]*Service unavailable/, 'API_HTTP_ERROR');
});
test('네트워크 오류를 서버 지연으로 단정하지 않는다', async () => {
  await failure(setup([new TypeError('Failed to fetch')]), /네트워크 연결 또는 브라우저 접근 정책/, 'API_NETWORK_ERROR');
});
test('서버 오류 메시지에서 인증 키와 토큰을 숨긴다', async () => {
  const f = setup([response({ success: false, error: 'HTTP 429 https://example.test/?key=secret-key&access_token=secret-token Authorization: Bearer secret-auth' })]);
  await assert.rejects(f.run(), error => {
    assert.doesNotMatch(error.message, /secret-key|secret-token|secret-auth/);
    assert.match(error.message, /숨김/);
    return true;
  });
});
test('긴 상세 오류를 제한한다', async () => {
  const f = setup([response({ success: false, error: 'a'.repeat(5000) })]);
  await assert.rejects(f.run(), error => error.message.length === 700);
});
test('JSON 형태 인증 정보와 기본 인증 토큰도 숨긴다', async () => {
  const f = setup([response({ success: false, error: 'HTTP 403 {"api_key":"secret-json","access_token":"secret-access","Authorization":"Basic secret-basic"}' })]);
  await assert.rejects(f.run(), error => {
    assert.doesNotMatch(error.message, /secret-json|secret-access|secret-basic/);
    return true;
  });
});
for (const action of ['analyzeCapture', 'generateReply', 'addIssue', 'updateIssue', 'updateStatus', 'updateHidden', 'previewJiraSync', 'lookupJiraSync', 'applyJiraSync', 'setJiraSyncExcluded']) {
  test(action + ' 실패 시 추가 GET/쓰기 재시도를 하지 않는다', async () => {
    const f = setup([response({ success: false, error: 'Test server failure' })]);
    await failure(f, /Test server failure/, 'API_EXECUTION_ERROR', action);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.method, 'POST');
  });
}
for (const action of ['getDashboardData', 'getDevelopers', 'getBlogPostPlans']) {
  test(action + ' 기존 읽기 전용 GET 대체 경로를 유지한다', async () => {
    const f = setup([new Error('Test network failure'), response({ success: true, data: 'ok' })]);
    assert.equal(await f.run(action), 'ok');
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].options.method, 'GET');
  });
}
test('404의 시간·최종 응답 경로·형식을 보관하고 일회성 키는 제외한다', async () => {
  const f = setup([{ ...response('<html>private response</html>', 404, true), redirected: true,
    url: 'https://script.googleusercontent.com/macros/echo?user_content_key=secret-key&lib=secret-lib#private' }]);
  await assert.rejects(f.run('addIssue'), error => {
    assert.equal(error.diagnostics.stage, 'response_parse');
    assert.equal(error.diagnostics.responseFormat, 'html');
    assert.equal(error.diagnostics.httpStatus, 404);
    assert.equal(error.diagnostics.responseAddress, 'https://script.googleusercontent.com/macros/echo');
    assert.ok(Number.isFinite(error.diagnostics.elapsedMs));
    assert.equal(error.requestId, JSON.parse(f.calls[0].options.body).requestId);
    return true;
  });
  assert.doesNotMatch(JSON.stringify(f.context.getGASDiagnostics()), /secret|private|user_content_key/);
});
test('네트워크 실패는 전송 단계, 본문 읽기 실패는 읽기 단계로 남긴다', async () => {
  const f = setup([new TypeError('Failed to fetch')]);
  await assert.rejects(f.run(), error => error.diagnostics.stage === 'request_send');
  const bodyFailure = setup([{ ...response(''), text: async () => { throw new TypeError('Failed to fetch'); } }]);
  await assert.rejects(bodyFailure.run(), error => error.diagnostics.stage === 'response_body' && error.httpStatus === 200);
});
test('POST·GET 실패/성공 기록은 같은 요청 ID와 각 메서드로 구분한다', async () => {
  const f = setup([new TypeError('Failed to fetch'), response({success: true, data: 'ok'})]);
  assert.equal(await f.run('getDevelopers'), 'ok');
  const records = f.context.getGASDiagnostics();
  assert.equal(records.length, 2);
  assert.equal(records[0].outcome, 'failure');
  assert.equal(records[1].outcome, 'success');
  assert.equal(records[0].requestId, records[1].requestId);
  assert.equal(records[1].method, 'GET');
});
test('요청 본문·이름·사진·서버 오류 원문은 진단에 보관하지 않는다', async () => {
  const saved = new Map();
  const f = setup([response({success: false, error: 'Error: private-title secret-staff secret-body'})], {
    localStorage: {getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value)}
  });
  await assert.rejects(f.context.callGASApi('analyzeCapture', {title:'private-title',requester:'secret-staff',images:['secret-image'],body:'secret-body'}));
  assert.doesNotMatch([...saved.values()].join('') + JSON.stringify(f.logs), /private-title|secret-staff|secret-image|secret-body/);
});
test('서버 단계 시간은 허용된 필드만 보관하고 성공 데이터는 변경하지 않는다', async () => {
  const f = setup([response({success:true,data:{id:'IT-test'},diagnostics:{schema:1,requestId:'kic-1234567890',method:'POST',elapsedMs:1500,stage:'sheet_write',writeStarted:true,
    stages:[{stage:'lock_wait',elapsedMs:1000,private:'secret'}],body:'secret-body',token:'secret-token'}})]);
  assert.equal((await f.run('addIssue')).id, 'IT-test');
  const record = f.context.getGASDiagnostics()[0];
  assert.equal(record.server.elapsedMs, 1500);
  assert.equal(record.server.stages[0].elapsedMs, 1000);
  assert.doesNotMatch(JSON.stringify(record), /secret|token|private/);
});
test('저장 제한 때문에 실제 저장 성공을 실패로 바꾸지 않는다', async () => {
  const f = setup([response({success:true,data:'saved'})], {localStorage:{getItem(){throw Error('denied');},setItem(){throw Error('quota');}}});
  assert.equal(await f.run('updateIssue'), 'saved');
  assert.equal(f.context.getGASDiagnostics().length, 1);
});
test('진단 UI 오류 때문에 실제 저장 성공을 실패로 바꾸지 않는다', async () => {
  let now = Date.now();
  class Clock extends Date { static now() {now += 11000;return now;} }
  const f = setup([response({success:true,data:'saved'})], {Date:Clock,document:{body:{},getElementById(){throw Error('UI unavailable');}}});
  assert.equal(await f.run('updateIssue'), 'saved');
});
test('로그 수를 40건으로 제한한다', async () => {
  const f = setup(Array.from({length:45}, () => response({success:true,data:'ok'})));
  for(let i=0;i<45;i++) await f.run();
  assert.equal(f.context.getGASDiagnostics().length, 40);
});
test('24시간 이전 기록은 읽어오거나 복사하지 않는다', async () => {
  const old = {requestId:'kic-1234567890',startedAt:new Date(Date.now()-90000000).toISOString(),action:'addIssue',outcome:'failure'};
  const f = setup([], {localStorage:{getItem:()=>JSON.stringify([old]),setItem(){}}});
  assert.equal(f.context.getGASDiagnostics().length,0);
});
test('손상된 로컬 기록과 추가 개인정보 필드를 무시한다', async () => {
  const saved = {requestId:'kic-1234567890',startedAt:new Date().toISOString(),action:'addIssue',outcome:'failure',responseAddress:'https://name:password@example.test/private-title?token=secret',title:'secret-title'};
  const f = setup([], {localStorage:{getItem:()=>JSON.stringify([null,saved,{requestId:'secret-staff'}]),setItem(){}}});
  assert.equal(f.context.getGASDiagnostics().length,1);
  assert.equal(f.context.getGASDiagnostics()[0].responseAddress,'https://example.test');
  assert.doesNotMatch(JSON.stringify(f.context.getGASDiagnostics()),/secret|password|private-title|name/);
});
test('복사한 로그에도 인증키·본문이 포함되지 않는다', async () => {
  let copied = '';
  const f = setup([response({success:false,error:'Authorization: Bearer secret-token'})], {navigator:{clipboard:{writeText:async text=>{copied=text;}}}});
  await assert.rejects(f.run());
  await f.context.copyGASDiagnostics();
  assert.equal(JSON.parse(copied).records.length,1);
  assert.doesNotMatch(copied,/secret-token|Bearer|Authorization/);
});
test('등록 잠금 대기 실패를 별도 코드로 구분한다', async () => {
  await failure(setup([response({success:false,code:'ISSUE_LOCK_WAIT_FAILED',error:'Exception: timed out'})]), /등록 잠금 대기/, 'ISSUE_LOCK_WAIT_FAILED','addIssue');
});
(async () => {
  for (const { name, run } of tests) { await run(); console.log('PASS ' + name); }
  console.log(`\n${tests.length} tests passed. No live API or spreadsheet writes.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
