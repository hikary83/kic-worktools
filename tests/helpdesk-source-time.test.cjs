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
