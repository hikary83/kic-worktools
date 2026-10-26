// 실제 Jira 조회 모듈을 사용하되 모든 응답은 합성 페이지로 주입합니다.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function lookup(pages,strict=true){
  const context=vm.createContext({}),requests=[];
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend/JiraSyncLookup.js'),'utf8'),context);
  context.helpdeskJiraConfig_=()=>({baseUrl:'https://jira.example.test'});
  context.helpdeskJiraRequest_=(_config,_path,payload)=>{requests.push(payload);return pages.shift()||{};};
  return {requests,run:()=>context.getHelpdeskJiraSyncIssues_({issueKeys:[],issueNumbers:['IT-261023-002'],requireComplete:strict})};
}
test('완료가 명시된 빈 Jira 결과만 미연결 확인으로 사용할 수 있다',()=>{
  const f=lookup([{issues:[],isLast:true}]);assert.equal(f.run().issues.length,0);assert.equal(f.requests.length,1);
  for(const page of [{},{issues:[]},{issues:[],isLast:false},{issues:[],isLast:false,nextPageToken:''}])assert.throws(()=>lookup([page]).run(),/완전성/);
});
test('추가 페이지를 끝까지 조회하고 본문·레이블 참조를 보존한다',()=>{
  const f=lookup([{issues:[],isLast:false,nextPageToken:'page-2'},{isLast:true,issues:[{key:'ITM-7',fields:{summary:'합성 업무',labels:['IT-261023-002'],description:{content:[{text:'IT-261023-003'}]}}}]}]);
  const result=f.run();assert.equal(f.requests.length,2);assert.equal(f.requests[1].nextPageToken,'page-2');assert.deepEqual([...result.issues[0].issueNumbers],['IT-261023-002','IT-261023-003']);
});
test('반복 토큰·잘못된 이슈 형식·깨진 응답을 안전한 미연결로 처리하지 않는다',()=>{
  assert.throws(()=>lookup([{issues:[],isLast:false,nextPageToken:'again'},{issues:[],nextPageToken:'again'}]).run(),/완전성/);
  for(const issue of [null,{key:'ITM-7'},{key:'invalid',fields:{}}])assert.throws(()=>lookup([{issues:[issue],isLast:true}]).run(),/형식/);
  assert.throws(()=>lookup([{issues:{},isLast:true}]).run(),/완전성/);
});
test('조회 상한에 도달해 끝까지 못 읽은 결과는 경고를 반환한다',()=>{
  const f=lookup(Array.from({length:10},(_,i)=>({issues:[],isLast:false,nextPageToken:'page-'+(i+1)})));assert.equal(f.run().warnings.length,1);assert.equal(f.requests.length,10);
});
test('기존 Jira 싱크의 일반 조회 응답 호환성은 유지한다',()=>{
  const f=lookup([{issues:[]}],false);assert.equal(f.run().issues.length,0);
});
