// Pure display partition tests; no API, workbook or state changes.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.resolve(__dirname,'../docs/index.html'),'utf8');
const source=html.match(/    function splitCurrentIssues\(items\) \{[\s\S]*?\n    \}/)[0];
const context=vm.createContext({});vm.runInContext(source,context);
const split=items=>context.splitCurrentIssues(items);
test('접수대기와 검토중·예정·처리중을 중복 없이 분리한다',()=>{
  const items=['접수대기','검토중','예정','처리중'].map((status,i)=>({id:String(i),status})),s=split(items);
  assert.deepEqual(Array.from(s.intake,item=>item.id),['0']);assert.deepEqual(Array.from(s.progress,item=>item.id),['1','2','3']);
  assert.equal(s.intake.length+s.progress.length,items.length);
  assert.equal(new Set([...s.intake,...s.progress]).size,items.length);
  assert.deepEqual({...s.statusCounts},{검토중:1,예정:1,처리중:1});
});
test('상태 미기재·미등록 값도 누락 없이 접수 확인에 남긴다',()=>{
  const items=[{status:''},{status:null},{},{status:'새로운 상태'},{status:'constructor'},{status:'toString'}],s=split(items);
  assert.equal(s.intake.length,6);assert.equal(s.progress.length,0);
});
test('분류 시 앞뒤 공백만 허용하고 원본 상태를 수정하지 않는다',()=>{
  const items=[{status:' 검토중 '},{status:' 접수대기 '}],snapshot=JSON.stringify(items),s=split(items);
  assert.equal(s.progress.length,1);assert.equal(s.intake.length,1);assert.equal(s.progress[0],items[0]);assert.equal(JSON.stringify(items),snapshot);
});
test('분리 후에도 원래의 순서·객체와 업무 필드를 유지한다',()=>{
  const items=[{id:'a',status:'처리중',jiraLink:'https://example.invalid/'},{id:'b',status:'접수대기'},{id:'c',status:'처리중',remark:'메모'}],s=split(items);
  assert.deepEqual(Array.from(s.progress,item=>item.id),['a','c']);assert.equal(s.intake[0],items[1]);assert.equal(s.progress[1].remark,'메모');
});
test('빈 목록에서도 세 상태의 건수는 모두 0이다',()=>{
  for(const items of [[],null,undefined]){const s=split(items);assert.equal(s.intake.length,0);assert.equal(s.progress.length,0);assert.deepEqual({...s.statusCounts},{검토중:0,예정:0,처리중:0});}
});
test('상태별 건수 합계는 진행 관리 전체 건수와 같다',()=>{
  const items=['검토중','검토중','예정','처리중','처리중','처리중','접수대기'].map(status=>({status})),s=split(items);
  assert.equal(Object.values(s.statusCounts).reduce((a,b)=>a+b,0),s.progress.length);assert.equal(s.statusCounts.처리중,3);
});
test('네 영역의 툴팁은 실제 표시 기준과 연결된다',()=>{
  assert.match(html,/aria-describedby="tooltip-intake-current"/);assert.match(html,/id="tooltip-intake-current"[^>]*>상태: 접수대기/);
  assert.match(html,/id="tooltip-progress-current"[^>]*>상태: 검토중·예정·처리중/);
  assert.match(html,/id="tooltip-done-current"[^>]*>상태: 완료·반려/);
  assert.match(html,/id="tooltip-past"[^>]*>상태: 접수대기·검토중·예정·처리중·반려/);
});

test('툴팁은 상태를 먼저 표시하고 줄바꿈 후 조회 범위를 설명한다',()=>{
  for(const id of ['tooltip-intake-current','tooltip-progress-current','tooltip-done-current','tooltip-past']){
    const tooltip=html.match(new RegExp('id="'+id+'"[^>]*>([\\s\\S]*?)</span>'))[1];
    assert.match(tooltip,/^상태: [^<]+<br>조회 (기간 내|시작일 이전)/);
    assert.equal((tooltip.match(/<br>/g)||[]).length,1);
  }
});
