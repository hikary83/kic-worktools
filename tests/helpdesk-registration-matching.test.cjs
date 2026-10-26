const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,record}=require('./fixtures/helpdesk-insertion-fixture.cjs');
const original=(title,extra={})=>({title,date:'2026-10-23',time:'12:00',requester:'예시 직원',isReply:false,uncertain:false,...extra});
const compare=(f,rows,receiptDate='2026-10-23')=>f.context.compareHelpdeskListCapture({receiptDate,rows});

test('완료·반려·접수대기·검토중·예정·처리중·숨김 모두 동일하게 등록 일치로 비교한다',()=>{
  const statuses=['완료','반려','접수대기','검토중','예정','처리중'];
  const rows=statuses.map((status,i)=>record(i+1,'등록 업무 '+(i+1),{status})).reverse();rows[0][17]='Y';
  const f=fixture(rows),before=structuredClone(f.state.rows),result=compare(f,statuses.map((_,i)=>original('등록 업무 '+(i+1))));
  assert(result.rows.every(row=>row.kind==='registered'));assert.equal(result.existing.length,6);assert.deepEqual(f.state.rows,before);assert.equal(f.state.batches.length,0);
});
test('같은 등록 건의 처리 상태만 바뀌어도 등록 여부 판정은 동일하다',()=>{
  const f=fixture([record(1,'상태 변경 비교 원문',{status:'접수대기'})]),a=compare(f,[original('상태 변경 비교 원문')]);
  f.state.rows[0][11]='완료';f.state.rows[0][17]='Y';const b=compare(f,[original('상태 변경 비교 원문')]);
  assert.deepEqual(a.rows,b.rows);assert.equal(b.rows[0].kind,'registered');assert.equal(f.state.batches.length,0);
});
test('원문에 찍힌 23일을 유지하면 비교 기준일과 무관하게 등록 일치다',()=>{
  const titles=['[부산] 접수 하나 할때마다 에러팝업이 뜹니다','불량내역서 엑셀 출력 시 페이지 수 오류'];
  const f=fixture([record(2,titles[1],{status:'처리중'}),record(1,titles[0],{status:'완료'})]);
  assert(compare(f,titles.map(title=>original(title))).rows.every(row=>row.kind==='registered'));
  const other=compare(f,titles.map(title=>original(title)),'2026-10-26');assert(other.rows.every(row=>row.kind==='registered'));
  assert(other.rows.every(row=>row.related[0].date.startsWith('2026-10-23')));assert.equal(other.existing.length,0);assert(other.rows.every(row=>!row.positionKnown));assert.equal(f.state.batches.length,0);
});
test('마침표·완료 말머리·한 글자 인식 차이는 누락이나 등록 확정 대신 확인 필요다',()=>{
  const title='불량내역서 엑셀 출력 시 페이지 수 오류',f=fixture([record(1,title,{status:'완료'})]);
  for(const candidate of [title+'.','[완료] '+title,'[조치 진행 중] '+title,'불량내역서 엑셀 출력 시 페이자 수 오류']){
    const row=compare(f,[original(candidate)]).rows[0];assert.equal(row.kind,'review',candidate);assert.equal(row.related[0].id,'IT-261023-001');assert.equal(row.matches.length,0);assert.equal(row.positionKnown,false);
  }
  assert.equal(f.state.batches.length,0);
});
test('작성자가 다르거나 인식이 불확실한 동일 제목도 등록 확정하지 않는다',()=>{
  const f=fixture([record(1,'동일 제목 확인')]);
  for(const extra of [{requester:'다른 직원'},{requester:''},{uncertain:true},{isReply:null}]){
    const row=compare(f,[original('동일 제목 확인',extra)]).rows[0];assert.equal(row.kind,'review');assert.equal(row.related[0].id,'IT-261023-001');
  }
});
test('등록된 답글 형태의 제목을 발견해도 답글은 등록 후보로 추가하지 않는다',()=>{
  const f=fixture([record(1,'원문 제목',{status:'완료'})]);
  const row=compare(f,[original('[완료] 원문 제목',{isReply:true})]).rows[0];assert.equal(row.kind,'reply');assert.equal(row.related.length,0);assert.equal(f.state.batches.length,0);
});
test('게시 날짜가 기준일과 달라도 원문 날짜의 등록 건을 찾고 위치 추천은 섞지 않는다',()=>{
  const f=fixture([record(1,'과거 등록 원문',{date:'2026-10-22',status:'완료'})]);
  const row=compare(f,[original('과거 등록 원문',{date:'2026-10-22'})]).rows[0];assert.equal(row.kind,'registered');assert.equal(row.positionKnown,false);
});
test('번호가 다른 별도 요청과 짧은 일반 제목을 유사 일치로 합치지 않는다',()=>{
  const f=fixture([record(1,'26014889-13 성적서 진행상태 수정 요청'),record(2,'짧은 오류')]);
  for(const title of ['26014889-14 성적서 진행상태 수정 요청','짧은 문의','전혀 새로운 등록 요청']){
    const row=compare(f,[original(title)]).rows[0];assert.equal(row.kind,'missing');assert.equal(row.related.length,0);
  }
});
test('동일 제목의 별도 요청은 날짜·기존 번호별로 후보를 유지하고 5건까지만 표시한다',()=>{
  const rows=Array.from({length:8},(_,i)=>record(1,'반복 접수 제목',{date:'2026-10-'+String(i+10),status:i%2?'완료':'반려'})),f=fixture(rows);
  const row=compare(f,[original('반복 접수 제목')]).rows[0];assert.equal(row.kind,'review');assert.equal(row.relatedCount,8);assert.equal(row.related.length,5);
  assert.equal(new Set(row.related.map(x=>x.id)).size,5);assert.equal(row.matches.length,0);
});
test('유사 제목이나 다른 날짜 후보는 위치 추천의 기준점으로 사용하지 않는다',()=>{
  const f=fixture([record(2,'최신 원문 접수 제목'),record(1,'이전 원문 접수 제목')]);
  const row=compare(f,[original('최신 원문 접수 제목.'),original('누락된 별도 요청'),original('이전 원문 접수 제목')]).rows[1];assert.equal(row.kind,'missing');assert.equal(row.positionKnown,false);
});
test('클라이언트가 이전 후보/상태 값을 보내도 원본 시트로 다시 비교한다',()=>{
  const f=fixture([record(1,'저장된 원문',{status:'완료'})]);
  const row=compare(f,[original('전혀 다른 원문',{kind:'registered',related:[{id:'IT-000000-999'}],status:'완료'})]).rows[0];assert.equal(row.kind,'missing');assert.equal(row.related.length,0);assert.equal(f.state.batches.length,0);
});
