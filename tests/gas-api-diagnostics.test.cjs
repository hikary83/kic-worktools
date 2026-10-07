// 실제 등록·수정 함수의 단계 진단을 합성 시트로 검증합니다. 운영 저장/외부 API 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../backend/Code.js'), 'utf8');
let passed = 0;
function test(name, run) {run();console.log('PASS '+name);passed++;}
function setup(options = {}) {
  let now = 100000;
  const calls = [], logs = [], writes = [];
  class Clock extends Date { static now() {return now;} }
  const step = (name, ms) => {calls.push(name);now+=ms;};
  const sheet = {getRange: () => ({
    getValues: () => {step('read', 200);return [Array(11).fill('')];},
    setValues: values => {step('write', 470);writes.push(values);if(options.failWrite)throw Error('private-write-error');},
    setNumberFormat: () => {step('format',50);}
  })};
  const context = vm.createContext({Date:Clock,
    Utilities:{getUuid:()=> '00000000-0000-0000-0000-000000000001',formatDate:()=> '2026-10-07 09:00'},
    ContentService:{MimeType:{TEXT:'text/plain'},createTextOutput: text=>({text,setMimeType(){return this;}})},
    console:{log:text=>logs.push(text)},
    LockService:{getScriptLock:()=>({
      waitLock: ms=>{assert.equal(ms,10000);step('lock',options.failLock?10000:7500);if(options.failLock)throw Error('Lock timed out');},
      releaseLock:()=>{step('release',20);}
    })}
  });
  vm.runInContext(source,context);
  Object.assign(context, {
    getMainSheet:()=>{step('open',1200);if(options.failOpen)throw Error('private-open-error');return sheet;},
    getQuarterRequestSheet:()=>{step('quarter-open',1200);return sheet;},
    ensureLinkColumns:()=>step('headers',340),
    reserveIssueIdentity:()=>{step('identity',250);return {id:'IT-test',date:new Clock('2026-10-07T09:00:00+09:00')};},
    findInsertRowForIssueDate:()=>{step('position',90);return 3;},
    insertIssueRowAt:()=>step('insert',300),
    findIssueRowById:()=>{step('find',90);return options.notFound?-1:3;},
    getDevelopers:()=>[{name:'private-staff'}]
  });
  const request = (action, data={}, requestId='kic-1234567890') => JSON.parse(context.doPost({postData:{contents:JSON.stringify({action,data,requestId})}}).text);
  return {context,calls,logs,writes,request};
}
test('등록 성공은 같은 요청 ID와 잠금/삽입/기록 시간을 반환한다',()=>{
  const f=setup();const result=f.request('addIssue',{receiptDate:'2026-10-07',title:'private-title',requester:'private-staff'});
  assert.equal(result.success,true);assert.equal(result.data.id,'IT-test');
  assert.equal(result.diagnostics.requestId,'kic-1234567890');
  assert.equal(result.diagnostics.method,'POST');
  assert.equal(result.diagnostics.writeStarted,true);
  const timings=Object.fromEntries(result.diagnostics.stages.map(s=>[s.stage,s.elapsedMs]));
  assert.equal(timings.sheet_open,1200);assert.equal(timings.lock_wait,7500);assert.equal(timings.sheet_write,470);
  assert.equal(result.diagnostics.elapsedMs,Object.values(timings).reduce((a,b)=>a+b,0));
  assert.equal(f.writes.length,1);assert.equal(f.calls.filter(c=>c==='release').length,1);
  assert.doesNotMatch(f.logs.join(''),/private-title|private-staff|receiptDate/);
});
test('잠금 획득 실패는 미기록 상태와 별도 코드로 반환한다',()=>{
  const f=setup({failLock:true});const result=f.request('addIssue');
  assert.equal(result.success,false);assert.equal(result.code,'ISSUE_LOCK_WAIT_FAILED');
  assert.equal(result.diagnostics.stage,'lock_wait');assert.equal(result.diagnostics.writeStarted,false);
  assert.equal(f.writes.length,0);assert.equal(f.calls.includes('release'),false);
});
test('등록 기록 중 실패는 잠금 해제로 단계가 덮이지 않고 잠금을 해제한다',()=>{
  const f=setup({failWrite:true});const result=f.request('addIssue');
  assert.equal(result.success,false);assert.equal(result.diagnostics.stage,'sheet_write');
  assert.equal(result.diagnostics.writeStarted,true);assert.equal(f.calls.filter(c=>c==='release').length,1);
  assert.doesNotMatch(f.logs.join(''),/private-write-error/);
});
test('수정에는 등록 잠금 대기 없이 찾기/읽기/기록 진단을 남긴다',()=>{
  const f=setup();const result=f.request('updateIssue',{id:'IT-test',title:'private-title',details:'private-body',status:'처리중'});
  assert.equal(result.success,true);assert.equal(result.data.id,'IT-test');
  assert.equal(f.calls.includes('lock'),false);assert.equal(f.writes.length,1);
  assert.ok(result.diagnostics.stages.some(s=>s.stage==='issue_find'));
  assert.ok(result.diagnostics.stages.some(s=>s.stage==='sheet_read'));
  assert.equal(f.writes[0][0][0],'private-title');assert.equal(f.writes[0][0][1],'private-body');
  assert.doesNotMatch(f.logs.join(''),/private-title|private-body/);
});
test('수정할 행을 찾지 못한 경우 기록 전 실패임을 남긴다',()=>{
  const f=setup({notFound:true});const result=f.request('updateIssue',{id:'IT-test'});
  assert.equal(result.success,false);assert.equal(result.diagnostics.stage,'issue_find');
  assert.equal(result.diagnostics.writeStarted,false);assert.equal(f.writes.length,0);
});
test('시트 접근 실패 단계를 남기며 입력 내용은 로그에 남기지 않는다',()=>{
  const f=setup({failOpen:true});const result=f.request('updateIssue',{id:'IT-test',details:'private-body'});
  assert.equal(result.diagnostics.stage,'sheet_open');assert.equal(result.success,false);
  assert.doesNotMatch(f.logs.join(''),/private-open-error|private-body/);
});
test('다른 요청으로 처리 단계가 새지 않는다',()=>{
  const f=setup();f.request('addIssue');const result=f.request('getDevelopers');
  assert.equal(result.diagnostics.writeStarted,null);assert.equal(result.diagnostics.stages.length,2);
  assert.equal(result.data[0].name,'private-staff');
  assert.equal(vm.runInContext('activeApiDiagnostic',f.context),null);
});
test('GET 안내 응답과 조회 응답에 실제 처리 메서드를 남긴다',()=>{
  const f=setup();const info=JSON.parse(f.context.doGet({parameter:{}}).text);
  assert.equal(info.code,'API_INFO_RESPONSE');assert.equal(info.diagnostics.method,'GET');
  const result=JSON.parse(f.context.doGet({parameter:{action:'getDevelopers',requestId:'kic-1234567890'}}).text);
  assert.equal(result.success,true);assert.equal(result.diagnostics.requestId,'kic-1234567890');
});
test('잘못된 JSON·빈 POST도 파싱 실패로 진단한다',()=>{
  const f=setup();
  for(const e of [null,{postData:{contents:'not json'}}]){
    const result=JSON.parse(f.context.doPost(e).text);
    assert.equal(result.success,false);assert.equal(result.diagnostics.stage,'request_parse');
  }
});
test('임의 개인정보 요청 ID는 서버 ID로 교체한다',()=>{
  const f=setup();const result=f.request('getDevelopers',{},'private-staff@example.test');
  assert.match(result.diagnostics.requestId,/^kic-/);assert.doesNotMatch(f.logs.join(''),/private-staff@example/);
});
console.log(`\n${passed} server diagnostic tests passed. No live API or spreadsheet writes.`);
