const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,record}=require('./fixtures/helpdesk-insertion-fixture.cjs');
const row=(extra={})=>({title:'등록 여부 확인 원문',requester:'예시 직원',date:'2026-10-23',time:'14:30',isReply:false,uncertain:false,...extra});
const compare=(f,rows=[row()])=>f.context.compareHelpdeskListCapture({receiptDate:'2026-10-23',rows});
const set=(f,confirmed=true,target=row(),rows=[target])=>f.context.setHelpdeskCaptureConfirmed({receiptDate:'2026-10-23',row:target,rows,confirmed});

test('팀 공통 등록 확인은 목록에서 제외하되 실제 행·상태·Jira·다른 설정을 바꾸지 않는다',()=>{
  const f=fixture(),before=structuredClone(f.state.rows);f.props.setProperty('UNRELATED','keep');
  const result=set(f);assert.equal(result.rows[0].kind,'excluded');assert.equal(result.rows[0].manualConfirmed,true);assert.deepEqual(f.state.rows,before);assert.equal(f.state.batches.length,0);assert.equal(f.state.jiraCalls.length,0);assert.equal(f.props.getProperty('UNRELATED'),'keep');
  const keys=[...f.state.props.keys()].filter(k=>k.startsWith('HELPDESK_CAPTURE_CONFIRMED_'));assert.equal(keys.length,1);assert.match(keys[0],/_[a-f0-9]{64}$/);assert.equal(f.state.props.get(keys[0]),'Y');assert(!keys[0].includes('직원'));assert.equal(compare(f).rows[0].kind,'excluded');
});
test('새 브라우저/사용자 세션의 같은 시트에는 제외가 유지되며 해제 후 다시 원래 분류가 된다',()=>{
  const f=fixture();set(f);const other=fixture();other.state.props=f.state.props;assert.equal(compare(other).rows[0].kind,'excluded');
  assert.equal(set(other,false).rows[0].kind,'missing');assert.equal(compare(f).rows[0].kind,'missing');assert.equal(f.state.batches.length,0);
});
test('확인 제외는 시트·원문 날짜·시각별로 격리하고 문장 끝 마침표 차이는 유지한다',()=>{
  const f=fixture();set(f);assert.equal(compare(f,[row({title:row().title+'.'})]).rows[0].kind,'excluded');
  assert.notEqual(compare(f,[row({date:'2026-10-24'})]).rows[0].kind,'excluded');assert.notEqual(compare(f,[row({time:'14:31'})]).rows[0].kind,'excluded');
  const other=fixture();other.state.props=f.state.props;other.sheet.getSheetId=()=>88;assert.equal(compare(other).rows[0].kind,'missing');
});
test('제외된 원문이 실제로 등록되거나 상태가 바뀌어도 해제 시 최신 등록 일치로 돌아온다',()=>{
  const f=fixture();set(f);f.state.rows.push(record(4,row().title,{requester:row().requester,status:'완료'}));assert.equal(compare(f).rows[0].kind,'excluded');assert.equal(set(f,false).rows[0].kind,'registered');assert.equal(f.state.rows.at(-1)[11],'완료');
});
test('잘못된 플래그·답글·빈 제목/일자·현재 목록에 없는 원문은 저장하지 않는다',()=>{
  const f=fixture();for(const target of [row({title:''}),row({date:'',time:''}),row({isReply:true})])assert.throws(()=>set(f,true,target));
  assert.throws(()=>set(f,'Y'),/값/);assert.throws(()=>set(f,true,row(),[row({title:'다른 원문'})]),/현재 비교 결과/);assert.equal(f.state.props.size,0);assert.equal(f.state.batches.length,0);
  assert.throws(()=>set(f,true,row({time:''})),/작성일시/);assert.throws(()=>set(f,true,row(),[row(),row()]),/여러 건/);assert.equal(f.state.props.size,0);
});
test('제외 한도 초과와 저장 실패는 기존 확인 기록·실제 행을 건드리지 않는다',()=>{
  let f=fixture();for(let i=0;i<1000;i++)f.props.setProperty('HELPDESK_CAPTURE_CONFIRMED_77_'+i,'Y');assert.throws(()=>set(f),/1,000건/);assert.equal(f.state.props.size,1000);
  f=fixture();const original=f.props.setProperty;f.props.setProperty=function(k,v){if(k.startsWith('HELPDESK_CAPTURE_CONFIRMED_'))throw Error('synthetic quota failure');return original.call(this,k,v);};assert.throws(()=>set(f),/quota/);assert.equal(compare(f).rows[0].kind,'missing');assert.equal(f.state.batches.length,0);
});
test('서버 저장 후 응답 유실 시 같은 등록 확인 요청은 멱등이며 복원도 중복 적용해도 안전하다',()=>{
  const f=fixture();set(f);set(f);assert.equal(f.state.props.size,1);set(f,false);set(f,false);assert.equal(f.state.props.size,0);assert.equal(f.state.batches.length,0);
});
test('다른 사용자가 이미 등록 확인한 캡처는 이전 미리보기로 실제 등록할 수 없다',()=>{
  const f=fixture(),target=row({title:'중간 누락 원문',requester:'예시 새 직원'}),p=f.preview('IT-261023-001',{captureRow:target});
  set(f,true,target);assert.throws(()=>f.insert(p.token),/다른 사용자가 이미 등록/);assert.equal(f.state.batches.length,0);assert.equal(f.preview('IT-261023-001',{captureRow:target}).allowed,false);
});
test('실제 등록이 확인된 뒤에는 캡처 등록 확인도 저장해 제목 수정으로 다시 누락되지 않는다',()=>{
  const f=fixture(),target=row({title:'캡처에 보인 원래 제목',requester:'예시 새 직원'}),p=f.preview('IT-261023-001',{captureRow:target});
  f.insert(p.token);assert.equal(compare(f,[target]).rows[0].kind,'excluded');assert.equal(f.state.batches.length,1);
});
test('원문 게시글 링크는 날짜·제목·요청자 차이와 상태에 무관하게 기등록을 확인한다',()=>{
  const source='https://boards.office.hiworks.com/board/postview/3616/90001',f=fixture([record(1,'기존 원문',{date:'2026-10-22',status:'완료',source})]);
  const r=compare(f,[row({title:'OCR에서 달라진 제목',sourceLink:source+'?tracking=value#reply'})]);assert.equal(r.rows[0].kind,'registered');assert.equal(r.rows[0].matches[0],'IT-261022-001');assert.equal(f.state.batches.length,0);
});
test('같은 원문 링크의 중복 등록은 확인 필요이며 일반 첨부 URL만으로 등록 확정하지 않는다',()=>{
  const source='https://boards.office.hiworks.com/board/postview/3616/90001',f=fixture([record(1,'첫 원문',{date:'2026-10-22',source}),record(1,'다른 원문',{source})]);
  assert.equal(compare(f,[row({sourceLink:source})]).rows[0].kind,'review');assert.equal(compare(f,[row({sourceLink:'https://attachment.example/shared.pdf'})]).rows[0].kind,'missing');
});
test('같은 원문 게시글 링크는 다른 접수일에도 중복 삽입을 차단한다',()=>{
  const source='https://boards.office.hiworks.com/board/postview/3616/90001',f=fixture([record(3),record(2),record(1),record(1,'기존 다른 날짜 원문',{date:'2026-10-22',source})]);
  assert.equal(f.preview('IT-261023-001',{sourceLink:source}).allowed,false);assert.equal(f.state.jiraCalls.length,0);assert.equal(f.state.batches.length,0);
});
