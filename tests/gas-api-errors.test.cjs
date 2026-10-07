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
function setup(responses) {
  const calls = [], logs = [];
  const context = vm.createContext({
    TypeError,
    console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error('Unexpected extra request');
      return next;
    }
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
(async () => {
  for (const { name, run } of tests) { await run(); console.log('PASS ' + name); }
  console.log(`\n${tests.length} tests passed. No live API or spreadsheet writes.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
