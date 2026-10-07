// 답변 모델/호환 설정/실패 전환 테스트. 실제 Gemini 호출이나 운영 시트 저장은 하지 않습니다.
// 실행: node tests/helpdesk-reply.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../backend/Code.js'), 'utf8');
let passed = 0;
function test(name, run) { run(); console.log('PASS ' + name); passed++; }
const ok = (text = '문의 사항은 검토 후 개선할 예정입니다.') => [200, {
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }]
}];
const fail = (status, message = 'Synthetic API failure') => [status, { error: { message } }];

function setup(responses = [ok()], apiKey = 'test-key') {
  const calls = [];
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => apiKey }) },
    UrlFetchApp: { fetch: (url, options) => {
      const response = responses[calls.length];
      calls.push({ model: url.match(/models\/([^:]+)/)[1], options, payload: JSON.parse(options.payload) });
      // 예상 밖의 호출은 다음 모델 전환으로 숨겨지지 않도록 테스트 후 호출 수로도 확인합니다.
      if (!response) throw new Error('Unexpected synthetic API call');
      if (response instanceof Error) throw response;
      const [status, body] = response;
      return { getResponseCode: () => status, getContentText: () => JSON.stringify(body) };
    } },
    Utilities: {
      getUuid: () => '00000000-0000-0000-0000-000000000001',
      sleep: () => { throw new Error('Unexpected retry delay'); }
    },
    ContentService: {
      MimeType: { TEXT: 'text/plain' },
      createTextOutput: text => ({ text, setMimeType() { return this; } })
    },
    console: { log() {} }
  });
  vm.runInContext(source, context);
  const request = data => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({
    action: 'generateReply', data, requestId: 'kic-1234567890'
  }) } }).text);
  return { context, calls, request };
}

test('기본 답변은 3.8 Flash와 지원되는 low 설정을 사용한다', () => {
  const f = setup();
  const contents = [{ role: 'user', parts: [{ text: 'synthetic prompt' }] }];
  const result = f.context.callGeminiFastFromServer(contents, 'fast');
  assert.equal(result.model, 'gemini-3.8-flash');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].payload.contents, contents);
  assert.deepEqual(f.calls[0].payload.generationConfig, {
    maxOutputTokens: 1400, thinkingConfig: { thinkingLevel: 'low' }
  });
  assert.equal(f.calls[0].options.method, 'post');
  assert.equal(f.calls[0].options.contentType, 'application/json');
  assert.equal(f.calls[0].options.muteHttpExceptions, true);
});

for (const mode of [undefined, 'unknown']) {
  test(`모드 ${String(mode)}도 기본 답변으로 처리한다`, () => {
    const f = setup();
    assert.equal(f.context.callGeminiFastFromServer([], mode).model, 'gemini-3.8-flash');
    assert.equal(f.calls.length, 1);
  });
}

for (const [name, response] of [
  ['404 모델 미지원', fail(404)],
  ['429 호출 한도', fail(429)],
  ['503 일시 오류', fail(503)],
  ['400 잘못된 모델 설정', fail(400, 'Unsupported setting')],
  ['빈 답변', ok('')],
  ['통신 예외', new Error('Synthetic network failure')]
]) {
  test(`${name}이면 기존 3.5 Flash-Lite로 전환한다`, () => {
    const f = setup([response, ok()]);
    assert.equal(f.context.callGeminiFastFromServer([], 'fast').model, 'gemini-3.5-flash-lite');
    assert.deepEqual(f.calls.map(c => c.model), ['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    assert.equal(f.calls[1].payload.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  });
}

test('기존 전환 순서와 각 모델의 호출 설정을 유지한다', () => {
  const f = setup([fail(503), fail(503), fail(503), ok()]);
  assert.equal(f.context.callGeminiFastFromServer([], 'fast').model, 'gemini-2.5-flash-lite');
  assert.deepEqual(f.calls.map(c => c.model), [
    'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash-lite'
  ]);
  assert.equal(f.calls[2].payload.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.deepEqual(f.calls[3].payload.generationConfig, {
    maxOutputTokens: 1400, temperature: 0.18, topP: 0.8, thinkingConfig: { thinkingBudget: 0 }
  });
});

for (const [status, message] of [
  [400, 'API key not valid'], [401, 'Unauthenticated'], [403, 'Permission denied']
]) {
  test(`인증 오류 ${status}는 반복 호출하지 않는다`, () => {
    const f = setup([fail(status, message)]);
    assert.throws(() => f.context.callGeminiFastFromServer([], 'fast'), /Gemini API 키|인증 오류/);
    assert.equal(f.calls.length, 1);
  });
}

test('모든 모델이 실패하면 오류를 반환하고 추가 호출하지 않는다', () => {
  const f = setup(Array.from({ length: 4 }, () => fail(429)));
  assert.throws(() => f.context.callGeminiFastFromServer([], 'fast'), /Gemini 답변 생성.*gemini-2.5-flash-lite.*HTTP 429/);
  assert.equal(f.calls.length, 4);
});

test('API 키 미설정이면 외부 호출 전에 중단한다', () => {
  const f = setup([], '');
  assert.throws(() => f.context.callGeminiFastFromServer([], 'fast'), /Gemini API 키가 설정되어 있지/);
  assert.equal(f.calls.length, 0);
});

test('다시 생성은 기존 3.7 Flash/low/1800 설정을 유지한다', () => {
  const f = setup();
  assert.equal(f.context.callGeminiFastFromServer([], 'precise').model, 'gemini-3.7-flash');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].payload.generationConfig, {
    maxOutputTokens: 1800, thinkingConfig: { thinkingLevel: 'low' }
  });
});

test('캡처·일반 생성·다시 생성 모델 목록은 변경하지 않는다', () => {
  const f = setup();
  const list = name => JSON.parse(vm.runInContext(`JSON.stringify(${name})`, f.context));
  assert.deepEqual(list('GEMINI_CAPTURE_MODELS'), [
    'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.5-flash'
  ]);
  assert.deepEqual(list('GEMINI_MODELS'), [
    'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash'
  ]);
  assert.deepEqual(list('GEMINI_REPLY_PRECISE_MODELS'), [
    'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'
  ]);
});

for (const withImage of [false, true]) {
  test(`${withImage ? '참고 이미지가 있는 답변 메뉴' : '이미지 없는 수정 모달'}의 공통 API도 3.8을 사용한다`, () => {
    const f = setup([ok('```markdown\n검토 후 개선할 예정입니다.\n```')]);
    const data = {
      requestText: 'synthetic request', draftAnswer: 'synthetic draft', mode: 'fast',
      images: withImage ? [{ mimeType: 'image/png', data: 'data:image/png;base64,dGVzdA==' }] : []
    };
    const result = f.request(data);
    assert.equal(result.success, true);
    assert.equal(result.data.success, true);
    assert.equal(result.data.model, 'gemini-3.8-flash');
    assert.equal(result.data.mode, 'fast');
    assert.equal(f.calls.length, 1);
    const parts = f.calls[0].payload.contents[0].parts;
    assert.match(parts[0].text, /최종 답변의 결론은 반드시 \[답변 초안\]을 따르세요/);
    assert.match(parts[0].text, /synthetic request/);
    assert.match(parts[0].text, /synthetic draft/);
    assert.match(parts[0].text, /초안에 없는 완료 여부, 확정 일정/);
    assert.equal(parts.length, withImage ? 2 : 1);
    if (withImage) assert.deepEqual(parts[1], { inlineData: { mimeType: 'image/png', data: 'dGVzdA==' } });
    assert.equal(result.data.text, '안녕하세요, IT전략실입니다.\n\n검토 후 개선할 예정입니다.\n\n감사합니다.');
    assert.equal(result.diagnostics.action, 'generateReply');
  });
}

test('초안이 없으면 기존 입력 검증을 유지한다', () => {
  const f = setup([]);
  const result = f.request({ requestText: 'synthetic request' });
  assert.equal(result.success, false);
  assert.match(result.error, /답변 초안을 입력/);
  assert.equal(f.calls.length, 0);
});

test('두 화면의 기본 버튼은 같은 fast 경로를 사용하고 재생성은 precise를 유지한다', () => {
  const modal = fs.readFileSync(path.resolve(__dirname, '../docs/index.html'), 'utf8');
  const reply = fs.readFileSync(path.resolve(__dirname, '../docs/reply.html'), 'utf8');
  assert.match(modal, /id="edit-ai-reply-btn"[^>]+onclick="generateEditAiReply\('fast'\)"/);
  assert.match(modal, /id="edit-ai-regenerate-btn"[^>]+onclick="generateEditAiReply\('precise'\)"/);
  assert.match(modal, /functionName === 'generateHelpdeskReply'[\s\S]*?callGASApi\('generateReply', args\[0\]\)/);
  assert.match(reply, /callGASApi\("generateReply", \{ requestText, draftAnswer, images, mode: 'fast' \}\)/);
});

console.log(`\n${passed} helpdesk reply tests passed. No live API or spreadsheet writes.`);
