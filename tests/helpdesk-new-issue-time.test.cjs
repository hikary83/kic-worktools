// 메인 신규 등록의 원문 작성시각 기준 접수일시(v2.10.8). 합성 시트만 사용합니다.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,record}=require('./fixtures/helpdesk-insertion-fixture.cjs');
test('신규 등록은 원문 작성시각이 없으면 저장하지 않는다',()=>{
  const f=fixture();assert.throws(()=>f.context.hdNewIssueSourceTime_(f.sheet,'2026-10-23',''),/원문 작성시각을 입력/);assert.throws(()=>f.context.hdNewIssueSourceTime_(f.sheet,'2026-10-23','25:61'),/원문 작성시각을 입력/);
});
test('그날 작성시각이 같거나 더 늦은 등록 건이 있으면 중간 등록으로 안내하고, 마지막이면 그 시각을 쓴다',()=>{
  const f=fixture();
  assert.throws(()=>f.context.hdNewIssueSourceTime_(f.sheet,'2026-10-23','09:15'),/IT-261023-003, 09:20.*중간 등록/);
  assert.throws(()=>f.context.hdNewIssueSourceTime_(f.sheet,'2026-10-23','09:20'),/같거나 더 늦은/);
  const ok=f.context.hdNewIssueSourceTime_(f.sheet,'2026-10-23','14:30');assert.equal(ok.time,'14:30');assert.equal(new Date(ok.value).toISOString(),'2026-10-23T05:30:00.000Z');
  assert.equal(f.context.hdNewIssueSourceTime_(f.sheet,'2026-10-24','08:00').date,'2026-10-24');
});
test('메모에 저장된 실제 원문 시각을 기준으로 순서를 확인한다',()=>{
  const f=fixture();f.state.notes.set('3:1','원문 작성일시(한국시간): 2026-10-23 16:00');
  assert.throws(()=>f.context.hdNewIssueSourceTime_(f.sheet,'2026-10-23','14:30'),/IT-261023-003, 16:00/);
  assert.equal(f.context.hdNewIssueSourceTime_(f.sheet,'2026-10-23','16:30').time,'16:30');
});
test('게시글 캡처의 작성시각은 24시간제로 정리하고 알 수 없으면 비운다',()=>{
  const f=fixture();
  assert.equal(f.context.normalizeHelpdeskCaptureResult({receiptDate:'2026-10-23',receiptTime:'오후 4:17'}).receiptTime,'16:17');
  assert.equal(f.context.normalizeHelpdeskCaptureResult({receiptDate:'2026-10-23',receiptTime:'14:30:05'}).receiptTime,'14:30:05');
  assert.equal(f.context.normalizeHelpdeskCaptureResult({receiptDate:'',receiptTime:'25:99'}).receiptTime,'');
  assert.equal(f.context.normalizeHelpdeskCaptureResult({}).receiptTime,'');
});
