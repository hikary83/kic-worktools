// 캡처 분석 모델 재시도 테스트(외부 API 미사용): node tests/helpdesk-capture.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function run(responses) {
  const calls = [];
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-key' }) },
    UrlFetchApp: { fetch: url => {
      const [code, body] = responses[calls.length];
      calls.push(url.match(/models\/([^:]+)/)[1]);
      return { getResponseCode: () => code, getContentText: () => JSON.stringify(body) };
    } }
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../backend/Code.js'), 'utf8'), context);
  try { return { text: context.callGeminiJsonFastFromServer([]), calls }; }
  catch (error) { return { error: error.message, calls }; }
}
const ok = (text, finishReason = 'STOP') => [200, { candidates: [{ finishReason, content: { parts: [{ text }] } }] }];

let r = run([ok('{"title":"잘린', 'MAX_TOKENS'), ok('{"title":"정상"}')]);
assert.equal(r.text, '{"title":"정상"}');
assert.equal(r.calls.length, 2);
console.log('PASS 잘린 응답은 다음 모델로 재시도한다');

r = run([ok('JSON 아님'), ok('{"title":"정상"}')]);
assert.equal(r.text, '{"title":"정상"}');
console.log('PASS 해석 불가 응답은 다음 모델로 재시도한다');

r = run(Array(4).fill([429, { error: { message: 'Resource exhausted' } }]));
assert.equal(r.calls.length, 4);
assert.match(r.error, /HTTP 429/);
assert.equal(r.error.split(' / ').length, 4);
console.log('PASS 모두 실패하면 모델별 이유를 함께 보여준다');
