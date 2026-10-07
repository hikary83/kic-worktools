// 목록 조회 정책·캐시·저장/조회 경합 회귀 테스트. 운영 API/시트 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const config = fs.readFileSync(path.resolve(__dirname, '../docs/js/config.js'), 'utf8');
const index = fs.readFileSync(path.resolve(__dirname, '../docs/index.html'), 'utf8');
const tests = [], test = (name, run) => tests.push({ name, run });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const stats = title => ({pendingCurrent:[{id:'IT-test',date:'2026-10-07 09:00',title,status:'접수대기'}],completedCurrent:[],quarterRequestItems:[],developers:[]});
const response = (data = stats('server'), status = 200, success = true) => ({ok:status<400,status,text:async()=>JSON.stringify({success,data})});
const flush = async () => {for(let i=0;i<12;i++) await Promise.resolve();};
function apiFixture(responses, extra = {}) {
  const calls=[], timers=new Map();let nextTimer=0;
  const ctx=vm.createContext({URL,TypeError,AbortController,console:{warn(){},error(){}},
    setTimeout(fn,ms){timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimeout(id){timers.delete(id);},
    fetch:async(url,options)=>{calls.push({url,options});const next=responses.shift();if(next instanceof Error)throw next;
      if(typeof next==='function')return next(url,options);if(!next)throw Error('Unexpected request');return next;},...extra});
  vm.runInContext(config,ctx);
  return {ctx,calls,timers,run:(data={},options={})=>ctx.callGASApi('getDashboardData',data,options),
    timeout:()=>{const timer=[...timers.values()][0];assert.equal(timer.ms,20000);timer.fn();}};
}
test('GET에 조회 조건·요청 ID가 명시되고 HTTP 캐시를 사용하지 않는다', async()=>{
  const f=apiFixture([response()]);await f.run({startDate:'2026-10-01',endDate:'2026-10-07',token:'private'});
  const call=f.calls[0],url=new URL(call.url);assert.equal(call.options.method,'GET');assert.equal(call.options.cache,'no-store');
  assert.equal(url.searchParams.get('action'),'getDashboardData');assert.equal(url.searchParams.get('startDate'),'2026-10-01');
  assert.equal(url.searchParams.get('endDate'),'2026-10-07');assert.match(url.searchParams.get('requestId'),/^kic-/);
  assert.equal(url.searchParams.has('token'),false);assert.equal(f.timers.size,0);
});
test('네트워크 실패 후 POST 한 번·동일 조건/ID로 재조회한다',async()=>{
  let retried=0;const f=apiFixture([new TypeError('Failed to fetch'),response()]);
  await f.run({startDate:'2026-10-01'}, {onRetry:()=>retried++});assert.equal(retried,1);assert.equal(f.calls.length,2);
  const body=JSON.parse(f.calls[1].options.body);assert.equal(body.requestId,new URL(f.calls[0].url).searchParams.get('requestId'));
  assert.equal(body.data.startDate,'2026-10-01');assert.equal(f.calls[1].options.method,'POST');assert.equal(f.timers.size,0);
});
for(const status of [404,408,429,500,503]) test('일시 통신 오류 '+status+'는 한 번 재조회한다',async()=>{
  const f=apiFixture([response(null,status),response()]);await f.run();assert.equal(f.calls.length,2);
});
for(const status of [400,401,403]) test('요청/권한 오류 '+status+'는 재조회하지 않는다',async()=>{
  const f=apiFixture([response(null,status)]);await assert.rejects(f.run(),e=>e.httpStatus===status);assert.equal(f.calls.length,1);
});
test('서버 처리 실패는 새로운 읽기로 숨기지 않는다',async()=>{
  const f=apiFixture([{...response(),text:async()=>JSON.stringify({success:false,error:'Sheet unavailable'})}]);
  await assert.rejects(f.run(),/Sheet unavailable/);assert.equal(f.calls.length,1);
});
test('다른 요청 ID의 성공 응답은 목록으로 채택하지 않는다',async()=>{
  const f=apiFixture([{...response(),text:async()=>JSON.stringify({success:true,data:stats('wrong'),diagnostics:{schema:1,requestId:'kic-1234567890',method:'GET',elapsedMs:2}})},response(stats('correct'))]);
  assert.equal((await f.run()).pendingCurrent[0].title,'correct');assert.equal(f.ctx.getGASDiagnostics()[0].code,'API_REQUEST_MISMATCH');
});
test('같은 ID라도 다른 서버 메서드이면 채택하지 않는다',async()=>{
  const f=apiFixture([(url)=>({...response(),text:async()=>JSON.stringify({success:true,data:stats('wrong'),diagnostics:{schema:1,
    requestId:new URL(url).searchParams.get('requestId'),method:'POST',elapsedMs:2}})}),response()]);
  await f.run();assert.equal(f.ctx.getGASDiagnostics()[0].code,'API_REQUEST_MISMATCH');
});
test('진단 없는 기존 서버 응답도 읽고, 올바른 진단은 유지한다',async()=>{
  const f=apiFixture([(url)=>({...response(),text:async()=>JSON.stringify({success:true,data:stats('ok'),diagnostics:{schema:1,
    requestId:new URL(url).searchParams.get('requestId'),method:'GET',elapsedMs:2}})})]);await f.run();
  assert.equal(f.ctx.getGASDiagnostics()[0].server.method,'GET');assert.equal(f.calls.length,1);
});
test('API_INFO_RESPONSE와 목록 없는 성공 응답은 한 번 재조회한다',async()=>{
  for(const body of [{success:false,code:'API_INFO_RESPONSE'},{success:true,data:'not a list'}]){
    const f=apiFixture([{...response(),text:async()=>JSON.stringify(body)},response()]);await f.run();assert.equal(f.calls.length,2);
  }
});
test('20초 대기 후 abort하고 읽기만 재조회한다',async()=>{
  const f=apiFixture([()=>new Promise(()=>{}),response()]);const result=f.run();await flush();f.timeout();
  await result;assert.equal(f.calls[0].options.signal.aborted,true);assert.equal(f.calls.length,2);
  assert.equal(f.ctx.getGASDiagnostics()[0].code,'API_READ_TIMEOUT');assert.equal(f.ctx.getGASDiagnostics()[0].stage,'request_send');
});
test('본문 읽기가 멈춰도 시간 제한이 적용된다',async()=>{
  const f=apiFixture([{...response(),text:()=>new Promise(()=>{})},response()]);const result=f.run();await flush();f.timeout();await result;
  assert.equal(f.ctx.getGASDiagnostics()[0].stage,'response_body');assert.equal(f.timers.size,0);
});
test('두 번 모두 지연되면 종료하고 세 번째 자동 조회를 하지 않는다',async()=>{
  const f=apiFixture([()=>new Promise(()=>{}),()=>new Promise(()=>{})]);const result=f.run();
  const failed=assert.rejects(result,e=>e.code==='API_READ_TIMEOUT');await flush();f.timeout();await flush();f.timeout();await failed;
  assert.equal(f.calls.length,2);assert.equal(f.timers.size,0);
});
test('시간초과 후 도착한 예전 응답은 성공 기록으로 남지 않는다',async()=>{
  const old=deferred();const f=apiFixture([()=>old.promise,response(stats('new'))]);const result=f.run();await flush();f.timeout();
  assert.equal((await result).pendingCurrent[0].title,'new');old.resolve(response(stats('old')));await flush();
  assert.equal(f.ctx.getGASDiagnostics().length,2);assert.equal(f.ctx.getGASDiagnostics()[0].outcome,'failure');
});
test('재조회 안내 UI 오류가 성공한 조회를 실패로 바꾸지 않는다',async()=>{
  const f=apiFixture([new TypeError('Failed to fetch'),response()]);await f.run({}, {onRetry(){throw Error('UI failed');}});
  assert.equal(f.calls.length,2);
});
for(const action of ['addIssue','updateIssue','updateStatus','updateHidden','saveDevelopers','generateReply','analyzeCapture','applyJiraSync']){
  test(action+'에는 새 시간제한/자동 재시도가 적용되지 않는다',async()=>{
    const f=apiFixture([new TypeError('Failed to fetch')]);await assert.rejects(f.ctx.callGASApi(action,{}));assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].options.method,'POST');assert.equal(f.calls[0].options.signal,undefined);assert.equal(f.timers.size,0);
  });
}

const slice=(from,to)=>{const a=index.indexOf(from),b=index.indexOf(to,a);assert.ok(a>=0&&b>a,from);return index.slice(a,b);};
const dashboardSource=slice('    async function initDashboard()', '    // 서버 getDashboardData의 전주')
  +slice('    function loadData(', '    function setThisWeekAndLoad(')
  +slice('    function applyLocalIssueUpdate(', '    function buildLocalIssueFromAddData(')
  +slice('    function updateIssueInLocalLists(', '    function handleKanbanDrop(');
function dashboardFixture(cached, storageFails=false){
  const stored=new Map();if(cached)stored.set('kic_dashboard_cache',typeof cached==='string'?cached:JSON.stringify(cached));
  const requests=[],rendered=[],elements=new Map(),font=deferred();let now=Date.parse('2026-10-07T08:00:00Z'),fonts=0;
  const element=id=>{if(!elements.has(id)){const classes=new Set();elements.set(id,{value:'',innerHTML:'',className:'',
    classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)}});}return elements.get(id);};
  class Clock extends Date {static now(){return now;}}
  const ctx=vm.createContext({Date:Clock,console:{warn(){}},
    window:{allIssuesMap:{},globalDevList:[]},document:{getElementById:element},
    localStorage:{getItem:k=>stored.get(k),setItem(k,v){if(storageFails)throw Error('quota');stored.set(k,v);}},
    getThisWeekRange:()=>({start:'2026-10-05',end:'2026-10-11'}),initImeProtection(){},loadHelpdeskStaffBranchMap(){},
    ensureKicChartFontReady(){fonts++;return font.promise;},
    runServerFunction(...args){const request=deferred();requests.push({...request,args});return request.promise;},
    buildStatsForCurrentRange(){return {...ctx.window.fullIssueData,developers:ctx.window.fullIssueData.developers,
      pendingCurrent:ctx.window.fullIssueData.issues,quarterRequestItems:ctx.window.fullIssueData.quarterRequestItems};},
    onSuccess(data){ctx.window.currentStats=data;rendered.push(data);element('loading').classList.add('hidden');element('dashboard-content').classList.remove('hidden');},
    onFailure(){},routeIssueToStatsCollections(){},rerenderDashboardAfterLocalChange(){},rerenderIssueBoardWithoutReload(){}});
  vm.runInContext(dashboardSource,ctx);
  return {ctx,requests,stored,rendered,element,font,get fonts(){return fonts;},advance(){now+=1000;},
    cache:()=>JSON.parse(stored.get('kic_dashboard_cache')),status:()=>element('sync-indicator').innerHTML,
    seed(){ctx.setFullIssueData(stats('old'));ctx.onSuccess(ctx.buildStatsForCurrentRange());}};
}
const legacyCache={full:{issues:stats('cached').pendingCurrent},savedAt:Date.parse('2026-10-06T01:00:00Z')};
test('폰트 준비 전에도 이전 목록과 첫 조회가 시작된다',async()=>{
  const f=dashboardFixture(legacyCache);await f.ctx.initDashboard();assert.equal(f.rendered.length,1);assert.equal(f.requests.length,1);
  assert.equal(f.fonts,1);assert.match(f.status(),/이전 목록 표시.*동기화 중/);assert.match(f.status(),/마지막 전체 동기화 2026/);
});
test('캐시가 없어도 폰트를 기다리지 않고 조회한다',async()=>{
  const f=dashboardFixture();await f.ctx.initDashboard();assert.equal(f.requests.length,1);assert.equal(f.rendered.length,0);
  assert.equal(f.element('dashboard-content').classList.contains('hidden'),true);
});
for(const bad of ['bad JSON',{schema:99,full:legacyCache.full},{full:{issues:[null]}},{full:{issues:[],developers:[null]}},{full:{issues:[],quarterRequestItems:'bad'}}]){
  test('손상되거나 호환되지 않는 캐시를 무시한다: '+JSON.stringify(bad),async()=>{
    const f=dashboardFixture(bad);await f.ctx.initDashboard();assert.equal(f.requests.length,1);assert.equal(f.rendered.length,0);
  });
}
test('조회 성공은 캐시·전체 동기화 시각을 갱신하고 안내를 유지한다',async()=>{
  const f=dashboardFixture();const done=f.ctx.fetchFullIssueData();f.requests[0].resolve(stats('fresh'));await done;
  assert.equal(f.cache().schema,2);assert.equal(f.cache().full.issues[0].title,'fresh');assert.ok(f.cache().syncedAt>0);
  assert.match(f.status(),/동기화 완료/);assert.equal(f.element('sync-indicator').className.includes('hidden'),false);
});
test('조회 실패·재조회 중에도 이전 목록과 동기화 시각은 남는다',async()=>{
  const f=dashboardFixture(legacyCache);await f.ctx.initDashboard();const saved=f.ctx.fetchFullIssueData();
  f.requests[0].args[3].onRetry();assert.match(f.status(),/한 번 더 조회 중/);
  f.requests[0].reject(Error('failed'));await saved;assert.equal(f.rendered.length,1);
  assert.match(f.status(),/동기화 실패.*이전 목록 유지/);assert.match(f.status(),/마지막 전체 동기화/);
});
test('새로운 저장 내용은 캐시에 반영하되 전체 동기화 시각은 바꾸지 않는다',async()=>{
  const f=dashboardFixture(legacyCache);f.ctx.restoreDashboardCache();f.ctx.onSuccess(f.ctx.buildStatsForCurrentRange());f.advance();
  f.ctx.applyLocalIssueUpdate({...stats('saved').pendingCurrent[0]});assert.equal(f.cache().full.issues[0].title,'saved');
  assert.equal(f.cache().syncedAt,legacyCache.savedAt);assert.ok(f.cache().lastLocalSaveAt>f.cache().syncedAt);assert.match(f.status(),/저장 내용 반영/);
  const reload=dashboardFixture(f.cache());reload.advance();await reload.ctx.initDashboard();assert.equal(reload.rendered[0].issues[0].title,'saved');
  assert.match(reload.status(),/저장 내용 포함/);
});
test('저장 중 늦게 온 조회는 버리고 한 번 새로 확인한다',async()=>{
  const f=dashboardFixture();f.seed();const done=f.ctx.fetchFullIssueData(true);f.advance();f.ctx.applyLocalIssueUpdate({...stats('saved').pendingCurrent[0]});
  f.requests[0].resolve(stats('OLD response'));await flush();assert.equal(f.ctx.window.fullIssueData.issues[0].title,'saved');
  assert.equal(f.cache().full.issues[0].title,'saved');assert.equal(f.requests.length,2);
  f.requests[1].resolve(stats('saved from server'));await done;assert.equal(f.ctx.window.fullIssueData.issues[0].title,'saved from server');
});
test('새 확인 중 다시 저장돼도 무한 조회하지 않고 저장 내용을 보존한다',async()=>{
  const f=dashboardFixture();f.seed();const done=f.ctx.fetchFullIssueData(true);f.ctx.applyLocalIssueUpdate({...stats('save1').pendingCurrent[0]});
  f.requests[0].resolve(stats('old1'));await flush();f.ctx.applyLocalIssueUpdate({...stats('save2').pendingCurrent[0]});f.requests[1].resolve(stats('old2'));await done;
  assert.equal(f.requests.length,2);assert.equal(f.ctx.window.fullIssueData.issues[0].title,'save2');assert.match(f.status(),/조회로 재확인/);
});
test('진행 중 기간 조회는 중복 요청하지 않고 현재 기간으로 표시한다',async()=>{
  const f=dashboardFixture();f.seed();const first=f.ctx.loadData();f.element('startDate').value='2026-09-01';
  assert.equal(f.ctx.loadData(),first);assert.equal(f.requests.length,1);f.requests[0].resolve(stats('fresh'));await first;
  assert.equal(f.rendered.at(-1).issues[0].title,'fresh');
});
test('칸반 완료·숨김·분기 요청 변경도 캐시에 반영한다',async()=>{
  const f=dashboardFixture();f.seed();f.ctx.applyLocalKanbanStatusChange('IT-test','완료','helpdesk');assert.equal(f.cache().full.issues[0].status,'완료');
  f.ctx.applyLocalIssueHiddenChange('IT-test',true);assert.equal(f.cache().full.issues[0].hiddenFlag,'Y');
  f.ctx.window.fullIssueData.quarterRequestItems.push({id:'quarter-test',sourceType:'quarter',status:'예정'});
  f.ctx.applyLocalKanbanStatusChange('quarter-test','완료','quarter');assert.equal(f.cache().full.quarterRequestItems[0].status,'완료');
});
test('Jira 저장 확인 전의 오래된 목록은 버리고 새로 확인한다',async()=>{
  const f=dashboardFixture();f.seed();const done=f.ctx.fetchFullIssueData(true);f.ctx.markDashboardServerChange();
  assert.equal(f.cache().needsRefresh,true);assert.match(f.status(),/목록 재확인 필요/);
  f.requests[0].resolve(stats('old'));await flush();f.requests[1].resolve(stats('after jira'));await done;
  assert.equal(f.cache().needsRefresh,false);assert.equal(f.cache().full.issues[0].title,'after jira');
});
test('잘못된 서버 목록·캐시 저장 제한은 기존 목록을 손상시키지 않는다',async()=>{
  const f=dashboardFixture(null,true);f.seed();const failed=f.ctx.fetchFullIssueData(true);f.requests[0].resolve({pendingCurrent:[null],completedCurrent:[]});await failed;
  assert.equal(f.ctx.window.fullIssueData.issues[0].title,'old');const good=f.ctx.fetchFullIssueData(true);f.requests[1].resolve(stats('new'));await good;
  assert.equal(f.ctx.window.fullIssueData.issues[0].title,'new');assert.match(f.status(),/동기화 완료/);
});
test('새 전체 조회의 담당자 목록은 빈 목록을 포함해 갱신한다',async()=>{
  const f=dashboardFixture();f.seed();f.ctx.window.globalDevList=[{name:'old'}];const done=f.ctx.fetchFullIssueData(true);f.requests[0].resolve(stats('new'));await done;
  assert.equal(f.ctx.window.globalDevList.length,0);
});
(async()=>{for(const {name,run} of tests){await run();console.log('PASS '+name);}console.log(`\n${tests.length} tests passed. No live API or spreadsheet writes.`);})()
  .catch(error=>{console.error(error);process.exitCode=1;});
