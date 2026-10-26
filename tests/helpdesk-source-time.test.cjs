const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,record}=require('./fixtures/helpdesk-insertion-fixture.cjs');
const source=(title,time,extra={})=>({title,time,requester:'예시 직원',isReply:false,uncertain:false,...extra});
function automatic(f,time='14:30',extra={}){
  return f.preview('IT-261023-003',{autoPosition:true,sourceDate:'2026-10-23',sourceTime:time,captureRows:[source('등록 3','15:00'),source('누락 원문',time),source('등록 2','14:00'),source('등록 1','13:00')],...extra});
}
test('시간만 보이면 비교 기준일이 아닌 서버의 오늘 한국 날짜를 적용한다',()=>{
  const f=fixture();f.state.now=Date.parse('2026-10-25T15:05:00Z');
  const r=f.context.compareHelpdeskListCapture({receiptDate:'2026-10-23',rows:[source('오늘 접수','09:08')]});
  assert.equal(r.rows[0].date,'2026-10-26');assert.equal(r.rows[0].time,'09:08');assert.equal(r.rows[0].dateSource,'today');assert.equal(r.rows[0].kind,'missing');
});
test('날짜와 시간은 원문 그대로 유지하며 연도가 없으면 올해 적용 사실을 표시한다',()=>{
  const f=fixture();f.state.now=Date.parse('2026-10-26T03:00:00Z');
  for(const date of ['2026-10-23','2026.10.23','2026/10/23','2026년 10월 23일']){const r=f.context.hdCaptureStamp_(date,'오후 4:17');assert.equal(r.date,'2026-10-23');assert.equal(r.time,'16:17');assert.equal(r.dateSource,'visible');}
  const both=f.context.hdCaptureStamp_('2026.10.23. 16:17:31','');assert.equal(both.time,'16:17:31');assert.equal(both.date,'2026-10-23');
  const short=f.context.hdCaptureStamp_('10.23','16:17');assert.equal(short.date,'2026-10-23');assert.equal(short.dateSource,'year-assumed');assert.match(short.dateWarning,/연도/);
});
test('잘못된 날짜·시간은 오늘 또는 임의 시각으로 보완하지 않는다',()=>{
  const f=fixture();let r=f.context.hdCaptureStamp_('2026-02-30','16:17');assert.equal(r.date,'');assert(r.dateWarning);
  r=f.context.hdCaptureStamp_('','25:61');assert.equal(r.date,'');assert.equal(r.time,'');
  r=f.context.hdCaptureStamp_('2026-10-23','');assert.equal(r.date,'2026-10-23');assert.equal(r.time,'');
  assert.throws(()=>automatic(f,'25:61'),/작성 날짜와 시간/);
});
test('재비교 시 원문 표시값과 최초 인식 날짜를 유지한다',()=>{
  const f=fixture(),first=f.context.hdNormalizeListRows_([source('원문','09:08')]);f.state.now+=86400000;
  const second=f.context.hdNormalizeListRows_(first);assert.equal(second[0].date,'2026-10-23');assert.equal(second[0].rawDate,'');assert.equal(second[0].rawTime,'09:08');
});
test('같은 캡처의 여러 날짜는 각각 원문 날짜의 등록 여부를 비교한다',()=>{
  const f=fixture([record(1,'지난 원문',{date:'2026-10-22',status:'완료'}),record(1,'오늘 원문')]);
  const r=f.context.compareHelpdeskListCapture({receiptDate:'2026-10-23',rows:[source('지난 원문','16:17',{date:'2026-10-22'}),source('오늘 원문','09:08')]});
  assert.deepEqual(Array.from(r.rows,x=>x.kind),['registered','registered']);assert.deepEqual(Array.from(r.rows,x=>x.date),['2026-10-22','2026-10-23']);assert.equal(f.state.batches.length,0);
});
test('원문 14:30으로 앞뒤 14:00~15:00 사이를 자동 선택하되 정렬 시각은 기존 사이값이다',()=>{
  const f=fixture(),p=automatic(f);assert.equal(p.id,'IT-261023-003');assert.equal(p.older,'IT-261023-002');assert.equal(p.newer,'IT-261023-003');assert.equal(p.receiptTime,'2026-10-23 09:15');assert.equal(p.originalPostedAt,'2026-10-23 14:30');assert.equal(p.positionBasis,'capture');assert.equal(f.state.batches.length,0);
  const result=f.insert(p.token);assert.equal(result.originalPostedAt,'2026-10-23 14:30');const note=[...f.state.notes.values()].find(n=>n.includes('원문 작성일시'));assert.match(note,/2026-10-23 14:30$/);assert.equal(f.state.rows.find(row=>row[0]===result.id)[2].toISOString(),'2026-10-23T00:15:00.000Z');
});
test('초 단위가 실제로 보인 경우에만 원문 보존 값에 초를 포함한다',()=>{
  const f=fixture(),p=automatic(f,'14:30:31');assert.equal(p.originalPostedAt,'2026-10-23 14:30:31');
});
test('동일 원문 시각·서로 모순되는 시각·중간 기준점 부족은 등록하지 않는다',()=>{
  const f=fixture();assert.throws(()=>automatic(f,'14:00'),/작성시각이 같은/);
  assert.throws(()=>automatic(f,'14:30',{captureRows:[source('등록 1','13:00'),source('등록 3','15:00')]}),/시각을 확인하지 못/);
  assert.throws(()=>automatic(f,'14:30',{captureRows:[source('등록 2','14:00'),source('등록 2','14:05')]}),/서로 다르게/);
  assert.equal(f.state.batches.length,0);
});
test('캡처 기준점이 없으면 서로 다른 정렬 시각으로 위치를 추정하지 않는다',()=>{
  const f=fixture();assert.throws(()=>automatic(f,'09:15',{captureRows:[]}),/정렬 시간과 원문 시각을 섞어/);assert.equal(f.state.batches.length,0);
});
test('첫·마지막 및 빈 일자의 위치도 원문 작성시각으로 자동 결정한다',()=>{
  let f=fixture();assert.equal(automatic(f,'12:00').id,'IT-261023-001');assert.equal(automatic(f,'16:00').id,'IT-261023-004');
  f=fixture([]);const p=automatic(f,'12:00',{captureRows:[]});assert.equal(p.id,'IT-261023-001');assert.equal(p.positionBasis,'empty-day');assert.equal(p.originalPostedAt,'2026-10-23 12:00');
});
test('연결된 Jira 번호가 이동하는 자동 위치는 기존과 동일하게 차단한다',()=>{
  const f=fixture([record(3,'등록 3',{jira:'https://kic-itsd.atlassian.net/browse/ITM-3'}),record(2),record(1)]),p=automatic(f);assert.equal(p.allowed,false);assert.equal(f.state.batches.length,0);
});
test('원문 시각을 포함한 원자적 저장도 응답 유실 시 표식으로 한 번만 복구한다',()=>{
  const f=fixture(),p=automatic(f);f.state.writeMode='after-timeout';assert.throws(()=>f.insert(p.token),/timeout/);const result=f.context.checkHelpdeskInsertion();assert.equal(result.recovered,true);assert.equal(result.result.originalPostedAt,p.originalPostedAt);assert.equal(f.state.batches.length,1);
});
test('하이웍스 두 자리 연도(26-10-25)는 원문 날짜로 읽고 월·일로 오해하지 않는다',()=>{
  const f=fixture();f.state.now=Date.parse('2026-10-26T02:58:00Z');
  for(const [date,time] of [['26-10-25','17:39'],['26-10-25 17:39',''],['','26-10-25 17:39'],['26.10.25','17:39'],['26/10/25','오후 5:39']]){
    const r=f.context.hdCaptureStamp_(date,time);assert.equal(r.date,'2026-10-25');assert.equal(r.time,'17:39');assert.equal(r.dateSource,'visible');assert.equal(r.dateWarning,'');
  }
  const short=f.context.hdCaptureStamp_('10.23','16:17');assert.equal(short.date,'2026-10-23');assert.equal(short.dateSource,'year-assumed');
  assert.equal(f.context.hdCaptureStamp_('26-13-25','17:39').date,'');
});
test('두 자리 연도로 표시된 과거 원문도 해당 날짜의 등록 건과 대조하고 시간만 보인 행은 오늘로 비교한다',()=>{
  const f=fixture([record(1,'지난 원문',{date:'2026-10-23',status:'완료'})]);f.state.now=Date.parse('2026-10-26T02:58:00Z');
  const rows=[{title:'지난 원문',requester:'예시 직원',date:'26-10-23',time:'16:34',isReply:false,uncertain:false},{title:'오늘 원문',requester:'예시 직원',date:'',time:'09:08',isReply:false,uncertain:false}];
  const r=f.context.compareHelpdeskListCapture({receiptDate:'2026-10-26',rows});
  assert.deepEqual(Array.from(r.rows,x=>x.kind),['registered','missing']);assert.deepEqual(Array.from(r.rows,x=>x.date),['2026-10-23','2026-10-26']);
  const again=f.context.compareHelpdeskListCapture({receiptDate:'2026-10-23',rows:r.rows});assert.deepEqual(Array.from(again.rows,x=>x.date),['2026-10-23','2026-10-26']);
});
const linkedDay=()=>fixture([record(3,'견적서 출력 버튼 오류 확인 요청'),record(2,'교정필증 발행 일자 표시 오류 문의'),record(1,'사용자 권한 추가 신청 드립니다')]);
const linkedRows=(link)=>[source('견적서 출력 버튼 오류 확인 요청','15:00'),source('누락 원문','14:30'),source('교정필증 발행 일자의 표시 오류 문의','14:00',link?{linkedIssueId:link}:{}),source('사용자 권한 추가 신청 드립니다','13:00')];
test('기준점이 부족하면 작성시각을 확인하지 못한 기존 번호와 해결 방법을 알려 준다',()=>{
  const f=linkedDay();
  assert.throws(()=>f.preview('',{autoPosition:true,sourceDate:'2026-10-23',sourceTime:'14:30',captureRows:linkedRows()}),error=>/IT-261023-002 「교정필증 발행 일자 표시 오류 문의」/.test(error.message)&&/등록 확인/.test(error.message)&&!/IT-261023-001/.test(error.message));
  assert.throws(()=>automatic(fixture(),'09:15',{captureRows:[]}),error=>/정렬 시간과 원문 시각을 섞어/.test(error.message)&&/IT-261023-001/.test(error.message));
  assert.equal(f.state.batches.length,0);
});
test('담당자가 등록 확인으로 연결한 같은 날짜·한 글자 차이 기존 건은 위치 기준점으로 쓴다',()=>{
  const f=linkedDay(),p=f.preview('',{autoPosition:true,sourceDate:'2026-10-23',sourceTime:'14:30',captureRows:linkedRows('IT-261023-002')});
  assert.equal(p.allowed,true);assert.equal(p.id,'IT-261023-003');assert.equal(p.older,'IT-261023-002');assert.equal(p.newer,'IT-261023-003');assert.equal(p.originalPostedAt,'2026-10-23 14:30');assert.equal(f.state.batches.length,0);
});
test('제목이 맞지 않는 기존 번호로 연결하면 기준점으로 쓰지 않고 차단한다',()=>{
  const f=linkedDay();
  assert.throws(()=>f.preview('',{autoPosition:true,sourceDate:'2026-10-23',sourceTime:'14:30',captureRows:linkedRows('IT-261023-003')}),/연결한 IT-261023-003/);
  assert.throws(()=>f.preview('',{autoPosition:true,sourceDate:'2026-10-23',sourceTime:'14:30',captureRows:linkedRows('IT-261023-009')}),/연결한 IT-261023-009/);
  assert.equal(f.state.batches.length,0);
});
