// 모델별 캡처 진단 회귀 검증. 외부 API/운영 시트 호출 없음.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const serverSource=fs.readFileSync(path.resolve(__dirname,'../backend/Code.js'),'utf8');
const clientSource=fs.readFileSync(path.resolve(__dirname,'../docs/js/config.js'),'utf8');
const tests=[],test=(name,run)=>tests.push({name,run});
const candidate=(text='{"title":"private-title","details":"private-body","requester":"private-staff"}',finishReason='STOP')=>({candidates:[{finishReason,content:{parts:[{text}]}}]});
const response=(body=candidate(),ms=1500,status=200)=>({body,ms,status});
const jsonError=(status,apiStatus)=>response({error:{message:'private-error ?key=secret-key Authorization: Bearer secret-token',status:apiStatus}},500,status);
const images=[{mimeType:'image/jpeg',data:'secret-image'}];
function setup(responses,options={}){
  let now=100000;const calls=[],logs=[];
  class Clock extends Date{static now(){return now;}}
  const context=vm.createContext({Date:Clock,console:{log:value=>logs.push(value)},
    Utilities:{getUuid:()=> '00000000-0000-0000-0000-000000000001'},
    ContentService:{MimeType:{TEXT:'text/plain'},createTextOutput:text=>({text,setMimeType(){return this;}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>options.noKey?'':'secret-key'})},
    UrlFetchApp:{fetch:(url,config)=>{
      calls.push({model:url.match(/models\/([^:]+)/)[1],config:JSON.parse(config.payload)});
      const r=responses.shift();if(!r)throw Error('Unexpected extra attempt');now+=r.ms||500;
      if(r.error)throw Error(r.error);
      return {getResponseCode:()=>r.status,getContentText:()=>{now+=r.bodyMs||0;return r.raw===undefined?JSON.stringify(r.body):r.raw;}};
    }} });
  vm.runInContext(serverSource,context);
  const request=(payload={images})=>JSON.parse(context.doPost({postData:{contents:JSON.stringify({action:'analyzeCapture',requestId:'kic-1234567890',data:payload})}}).text);
  return {context,calls,logs,request};
}
test('첫 모델 성공: 모델·호출 시간·전체 시간과 분석 결과 보존',()=>{
  const f=setup([{...response(candidate(),1200),bodyMs:30}]),r=f.request(),ai=r.diagnostics.ai;
  assert.equal(r.success,true);assert.equal(r.data.data.title,'private-title');assert.equal(ai.task,'capture');
  assert.equal(ai.selectedModel,'gemini-3.5-flash-lite');assert.equal(ai.attemptCount,1);assert.equal(ai.fallbackUsed,false);
  assert.equal(ai.totalElapsedMs,1230);assert.equal(ai.attempts[0].upstreamMs,1200);assert.equal(ai.attempts[0].elapsedMs,1230);
  assert.equal(ai.attempts[0].code,'OK');assert.equal(ai.attempts[0].outcome,'success');assert.equal(ai.attempts[0].httpStatus,200);
  assert.equal(r.diagnostics.stage,'capture_normalize');assert.ok(r.diagnostics.stages.some(s=>s.stage==='capture_prepare'));
  assert.equal(r.diagnostics.stages.find(s=>s.stage==='capture_models').elapsedMs,1230);
  assert.doesNotMatch(f.logs.join('')+JSON.stringify(r.diagnostics),/secret|private-title|private-body|private-staff/);
});
test('429 후 전환 성공: 실패/성공별 시간과 선택 모델 기록',()=>{
  const f=setup([jsonError(429,'RESOURCE_EXHAUSTED'),response(candidate(),900)]),r=f.request(),ai=r.diagnostics.ai;
  assert.equal(r.success,true);assert.equal(ai.attemptCount,2);assert.equal(ai.fallbackUsed,true);assert.equal(ai.selectedModel,'gemini-2.5-flash-lite');
  assert.equal(ai.totalElapsedMs,1400);assert.equal(ai.attempts[0].httpStatus,429);assert.equal(ai.attempts[0].apiStatus,'RESOURCE_EXHAUSTED');
  assert.equal(ai.attempts[0].code,'AI_HTTP_ERROR');assert.equal(ai.attempts[1].code,'OK');assert.deepEqual(f.calls.map(c=>c.model),['gemini-3.5-flash-lite','gemini-2.5-flash-lite']);
});
for(const [name,first,code] of [
  ['응답 잘림',response(candidate('{"title":"unfinished','MAX_TOKENS')),'AI_RESPONSE_TRUNCATED'],
  ['분석 JSON 해석 실패',response(candidate('not json')),'AI_INVALID_JSON'],
  ['빈 응답',response({candidates:[]}),'AI_EMPTY_RESPONSE'],
  ['외부 응답 JSON 아님',{...response(),raw:'<html>private-error</html>'},'AI_INVALID_API_RESPONSE'],
  ['HTTP 404',jsonError(404,'NOT_FOUND'),'AI_HTTP_ERROR'],
  ['HTTP 503',jsonError(503,'UNAVAILABLE'),'AI_HTTP_ERROR'],
  ['호출 예외',{error:'private-error secret-token',ms:250},'AI_REQUEST_ERROR'],
  ['호출 시간초과',{error:'Exception: Request timed out: secret-key',ms:5000},'AI_TIMEOUT']
]) test(name+' 원인을 기록하면서 기존 다음 모델 전환 유지',()=>{
  const f=setup([first,response()]),r=f.request();assert.equal(r.success,true);assert.equal(f.calls.length,2);
  assert.equal(r.diagnostics.ai.attempts[0].code,code);assert.equal(r.diagnostics.ai.selectedModel,'gemini-2.5-flash-lite');
  assert.doesNotMatch(f.logs.join('')+JSON.stringify(r.diagnostics),/private-error|secret/);
});
test('모든 모델 실패도 시도 순서/상태/시간을 빠짐없이 기록',()=>{
  const f=setup(Array.from({length:4},()=>jsonError(429,'RESOURCE_EXHAUSTED'))),r=f.request();assert.equal(r.success,false);
  assert.equal(r.diagnostics.ai.attemptCount,4);assert.equal(r.diagnostics.ai.selectedModel,'');assert.equal(r.diagnostics.ai.totalElapsedMs,2000);
  assert.deepEqual(f.calls.map(c=>c.model),['gemini-3.5-flash-lite','gemini-2.5-flash-lite','gemini-2.5-flash','gemini-3.5-flash']);
  assert.equal(r.diagnostics.stage,'capture_models');assert.match(r.error,/HTTP 429/);
});
for(const status of [401,403])test('인증 오류 '+status+'는 전환 없이 한 시도만 기록',()=>{
  const f=setup([jsonError(status,'PERMISSION_DENIED')]),r=f.request();assert.equal(r.success,false);assert.equal(f.calls.length,1);
  assert.equal(r.diagnostics.ai.attempts[0].code,'AI_AUTH_ERROR');assert.equal(r.diagnostics.ai.fallbackUsed,false);
});
test('유효하지 않은 API 키 400은 기존 중단 동작 유지',()=>{
  const f=setup([response({error:{message:'API key not valid. secret-key',status:'INVALID_ARGUMENT'}},400,400)]),r=f.request();
  assert.equal(r.success,false);assert.equal(f.calls.length,1);assert.equal(r.diagnostics.ai.attempts[0].code,'AI_INVALID_API_KEY');
});
test('API 키/이미지 없음은 모델 미호출로 기록',()=>{
  for(const [options,payload] of [[{noKey:true},{images}],[{},{}]]){
    const f=setup([],options),r=f.request(payload);assert.equal(r.success,false);assert.equal(f.calls.length,0);
    assert.equal(r.diagnostics.ai.attemptCount,0);assert.equal(r.diagnostics.ai.selectedModel,'');
  }
});
test('샘플링·사고 설정·출력 한도·요청 데이터는 기존과 동일',()=>{
  const f=setup([jsonError(503,'UNAVAILABLE'),response()]);f.request();const configs=f.calls.map(c=>c.config.generationConfig);
  assert.equal(configs[0].maxOutputTokens,4096);assert.equal(configs[0].responseMimeType,'application/json');
  assert.equal(configs[0].thinkingConfig.thinkingLevel,'minimal');assert.equal(configs[0].temperature,undefined);
  assert.equal(configs[1].thinkingConfig.thinkingBudget,0);assert.equal(configs[1].temperature,0.1);assert.equal(configs[1].topP,0.7);
  assert.equal(f.calls[0].config.contents[0].parts[1].inlineData.data,'secret-image');
});
test('외부 오류 상태/완료 사유의 임의 문구는 서버 진단에 저장하지 않음',()=>{
  const f=setup([jsonError(503,'private-body'),response(candidate(undefined,'private-staff'))]),r=f.request();
  assert.equal(r.diagnostics.ai.attempts[0].apiStatus,'');assert.equal(r.diagnostics.ai.attempts[1].finishReason,'');
  assert.doesNotMatch(f.logs.join('')+JSON.stringify(r.diagnostics),/private-body|private-staff|secret/);
});
test('다음 API 요청이나 직접 함수 호출로 진단 정보가 새지 않음',()=>{
  const f=setup([response(),response()]);f.request();f.context.getDevelopers=()=>[];
  const next=JSON.parse(f.context.doGet({parameter:{action:'getDevelopers'}}).text);assert.equal(next.diagnostics.ai,undefined);
  assert.match(f.context.callGeminiJsonFastFromServer([]),/private-title/);assert.equal(vm.runInContext('activeApiDiagnostic',f.context),null);
});

function clientFixture(serverResult,existingStorage){
  const storage=existingStorage||new Map();let copied='';
  const context=vm.createContext({URL,TypeError,AbortController,setTimeout,clearTimeout,console:{warn(){},error(){}},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    navigator:{clipboard:{writeText:async value=>{copied=value;}}},
    fetch:async()=>({ok:true,status:200,text:async()=>JSON.stringify(serverResult)})});
  vm.runInContext(clientSource,context);return {context,storage,get copied(){return copied;}};
}
test('서버 모델 진단이 저장·복사·새로고침 이후에도 유지됨',async()=>{
  const result=setup([jsonError(429,'RESOURCE_EXHAUSTED'),response()]).request(),f=clientFixture(result);
  const data=await f.context.callGASApi('analyzeCapture',{images});assert.equal(data.data.title,'private-title');
  await f.context.copyGASDiagnostics();const log=JSON.parse(f.copied);assert.equal(log.version,'v2.8.9');
  const ai=log.records[0].server.ai;assert.equal(ai.selectedModel,'gemini-2.5-flash-lite');assert.equal(ai.fallbackUsed,true);
  assert.equal(ai.attempts[0].reason,'호출 한도 초과(HTTP 429)');assert.doesNotMatch(f.copied,/secret|private-title|private-body|private-staff|private-error/);
  const reload=clientFixture(result,f.storage);
  assert.equal(reload.context.getGASDiagnostics()[0].server.ai.attemptCount,2);
});
test('임의 모델/이유/추가 개인정보는 화면 로그에서 제거',()=>{
  const f=clientFixture({}),safe=f.context.safeGASCaptureDiagnostic({task:'capture',selectedModel:'private-staff',fallbackUsed:true,attemptCount:999,
    attempts:[{model:'private-staff',code:'OK',outcome:'success'},{model:'gemini-2.5-flash-lite',elapsedMs:100,upstreamMs:50,httpStatus:429,
      code:'AI_HTTP_ERROR',outcome:'failure',reason:'private-body',apiStatus:'private-title',finishReason:'secret-token',image:'secret-image'}]});
  assert.equal(safe.selectedModel,'');assert.equal(safe.attemptCount,1);assert.equal(safe.fallbackUsed,false);assert.match(safe.attempts[0].reason,/한도 초과/);
  assert.doesNotMatch(JSON.stringify(safe),/private|secret|image/);
});
test('기존 서버 진단·다른 기능은 AI 필드 없이 유지',()=>{
  const f=clientFixture({}),safe=f.context.safeGASServerDiagnostic({schema:1,requestId:'kic-1234567890',method:'POST',elapsedMs:100,stages:[]});
  assert.equal(safe.ai,undefined);assert.equal(safe.elapsedMs,100);assert.equal(f.context.safeGASCaptureDiagnostic({task:'reply',attempts:[]}),null);
});
test('모델 시도 수·비정상 시간·HTTP 상태는 제한하고 이유는 고정 코드로만 생성',()=>{
  const f=clientFixture({}),safe=f.context.safeGASCaptureDiagnostic({task:'capture',attempts:Array(20).fill({model:'gemini-2.5-flash',elapsedMs:99999999,
    upstreamMs:-1,httpStatus:999,code:'secret-token',outcome:'success'})});
  assert.equal(safe.attemptCount,8);assert.equal(safe.totalElapsedMs,3600000);assert.equal(safe.attempts[0].upstreamMs,null);
  assert.equal(safe.attempts[0].httpStatus,null);assert.equal(safe.attempts[0].outcome,'failure');assert.equal(safe.selectedModel,'');
});
(async()=>{for(const {name,run} of tests){await run();console.log('PASS '+name);}console.log(`\n${tests.length} capture diagnostic tests passed. No live API or spreadsheet writes.`);})()
  .catch(error=>{console.error(error);process.exitCode=1;});
