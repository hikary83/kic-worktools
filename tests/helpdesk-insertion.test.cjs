const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,record}=require('./fixtures/helpdesk-insertion-fixture.cjs');

test('원문·답글·다른 날짜·불확실한 행을 구분하고 제목 숫자를 보존한다',()=>{
  const f=fixture(),rows=[{title:'등록 3',requester:'예시 직원',isReply:false,uncertain:false},{title:'중간 누락 원문',requester:'예시 새 직원',isReply:false,uncertain:false},
    {title:'등록 1',requester:'예시 직원',isReply:false,uncertain:false},{title:'[완료] 답글',isReply:true,uncertain:false},{title:'과거 글',requester:'직원',date:'2026-10-22',isReply:false,uncertain:false},{title:'제목 잘림',isReply:null}];
  const result=f.context.compareHelpdeskListCapture({receiptDate:'2026-10-23',rows:rows.map(row=>({date:'2026-10-23',...row}))});
  assert.deepEqual(Array.from(result.rows,x=>x.kind),['registered','missing','registered','reply','missing','review']);
  assert.equal(result.rows[1].positionKnown,false); // 001~003 사이에 기존 002도 있으므로 자동 위치 확정 금지
  assert.equal(f.state.batches.length,0);assert.notEqual(f.context.hdInsertTitle_('26014889-13'),f.context.hdInsertTitle_('26014889-14'));
});
test('앞뒤 원문이 서로 이웃할 때만 삽입 위치를 추천한다',()=>{
  const f=fixture([record(2),record(1)]);const result=f.context.compareHelpdeskListCapture({receiptDate:'2026-10-23',rows:[{title:'등록 2',requester:'예시 직원',isReply:false,uncertain:false},{title:'누락',requester:'새 직원',isReply:false,uncertain:false},{title:'등록 1',requester:'예시 직원',isReply:false,uncertain:false}].map(row=>({date:'2026-10-23',...row}))});
  assert.equal(result.rows[1].suggestedAfterId,'IT-261023-001');assert.equal(result.rows[1].positionKnown,true);
});
test('같은 제목의 다른 작성자·반복 원문은 등록 확정 대신 확인 필요로 남긴다',()=>{
  const f=fixture();const result=f.context.compareHelpdeskListCapture({receiptDate:'2026-10-23',rows:[{title:'등록 2',requester:'다른 직원',isReply:false,uncertain:false},{title:'반복 원문',requester:'직원',isReply:false,uncertain:false},{title:'반복 원문',requester:'직원',isReply:false,uncertain:false}]});assert.deepEqual(Array.from(result.rows,x=>x.kind),['review','review','review']);
});
test('잘못된 날짜·과도한 행·이미지는 거부하고 URL을 추정하지 않는다',()=>{
  const f=fixture();assert.throws(()=>f.context.hdInsertDate_('2026-02-30'),/날짜/);assert.throws(()=>f.context.hdNormalizeListRows_(Array(101).fill({})),/100행/);
  assert.throws(()=>f.context.analyzeHelpdeskListCapture({receiptDate:'2026-10-23',images:[{mimeType:'text/html',data:'AA=='}]}),/이미지/);
  assert.equal(f.context.hdNormalizeListRows_([{sourceLink:'https://guessed.invalid',time:'99:99'}])[0].sourceLink,'');
});
test('일반 중간 삽입은 002를 만들고 기존 002~003을 밀며 시간은 사이값이다',()=>{
  const f=fixture(),preview=f.preview();assert.equal(preview.id,'IT-261023-002');assert.equal(preview.receiptTime,'2026-10-23 09:05');
  assert.deepEqual(Array.from(preview.changes,x=>[x.from,x.to]),[['IT-261023-002','IT-261023-003'],['IT-261023-003','IT-261023-004']]);assert.equal(f.state.batches.length,0);
  const result=f.insert(preview.token);assert.equal(result.id,preview.id);assert.equal(f.state.batches.length,1);assert.equal(f.state.rows.length,4);
  const newRow=f.state.rows.find(x=>x[8]==='중간 누락 원문');assert.equal(newRow[0],'IT-261023-002');assert.equal(newRow[2].toISOString(),'2026-10-23T00:05:00.000Z');
  assert.equal(f.state.rows.find(x=>x[8]==='등록 2')[0],'IT-261023-003');assert.equal(new Set(f.state.rows.map(x=>x[0])).size,4);
});
test('날짜의 시작·끝·빈 일자와 번호 공백을 안전하게 처리한다',()=>{
  let f=fixture(),p=f.preview('');assert.equal(p.id,'IT-261023-001');assert.equal(p.receiptTime,'2026-10-23 08:55');
  p=f.preview('IT-261023-003');assert.equal(p.id,'IT-261023-004');assert.equal(p.changes.length,0);assert.equal(p.receiptTime,'2026-10-23 09:25');
  f=fixture([record(3),record(1)]);p=f.preview();assert.equal(p.id,'IT-261023-002');assert.equal(p.changes.length,0);
  f=fixture([]);f.props.setProperty('HELPDESK_ISSUE_SEQ_261023','5');p=f.preview('');assert.equal(p.id,'IT-261023-006');f.insert(p.token);assert.equal(f.state.rows.length,1);
});
test('중간 시간 여유가 없거나 기존 시간/번호 순서가 맞지 않으면 차단한다',()=>{
  const rows=[record(2),record(1)];rows[0][2]=new Date('2026-10-23T09:01:00+09:00');let f=fixture(rows);assert.throws(()=>f.preview(),/분 단위/);
  rows[0][2]=new Date('2026-10-23T08:00:00+09:00');f=fixture(rows);assert.throws(()=>f.preview(),/순서/);
});
test('Jira 링크·연동 표시가 있는 변경 대상은 조회/쓰기 없이 차단한다',()=>{
  for(const options of [{jira:'https://kic-itsd.atlassian.net/browse/ITM-1'},{linked:'Y'}]){const f=fixture([record(2,'등록 2',options),record(1)]);const p=f.preview();assert.equal(p.allowed,false);assert.match(p.reason,/금지/);assert.equal(f.state.jiraCalls.length,0);assert.equal(f.state.batches.length,0);}
});
test('번호가 바뀌지 않는 앞쪽 Jira 연결은 유지하고 새/기존/목적 번호는 모두 검색한다',()=>{
  const f=fixture([record(3),record(2),record(1,'등록 1',{jira:'https://kic-itsd.atlassian.net/browse/ITM-1'})]);assert.equal(f.preview().allowed,true);
  assert.deepEqual([...f.state.jiraCalls[0].issueNumbers].sort(),['IT-261023-002','IT-261023-003','IT-261023-004']);
});
test('링크가 없어도 Jira가 기존/목적 번호를 참조하면 차단한다',()=>{
  for(const id of ['IT-261023-002','IT-261023-004']){const f=fixture();f.state.jiraIssues=[{key:'ITM-77',issueNumbers:[id]}];const p=f.preview();assert.equal(p.allowed,false);assert.equal(p.jiraKeys[0],'ITM-77');assert.equal(f.state.batches.length,0);}
});
test('Jira 실패·부분 조회 경고는 정상/미연결로 취급하지 않는다',()=>{
  for(const mode of ['failure','partial']){const f=fixture();if(mode==='failure')f.state.jiraFailure=true;else f.state.jiraWarnings=['부분 조회'];const p=f.preview();assert.equal(p.allowed,false);assert.match(p.reason,/완료하지 못/);assert.equal(f.state.batches.length,0);}
});
test('등록 직전 Jira를 재조회하며 새로 생긴 연결은 저장하지 않는다',()=>{
  const f=fixture(),p=f.preview();f.state.jiraIssues=[{key:'ITM-99',issueNumbers:['IT-261023-003']}];assert.throws(()=>f.insert(p.token),/참조/);assert.equal(f.state.jiraCalls.length,2);assert.equal(f.state.batches.length,0);
});
test('미리보기 이후 변경·중복·만료·일자 변조는 저장하지 않는다',()=>{
  let f=fixture(),p=f.preview();f.state.rows[0][14]='다른 사용자가 수정';assert.throws(()=>f.insert(p.token),/목록이 변경/);
  f=fixture();p=f.preview();assert.throws(()=>f.insert(p.token,{title:'등록 2'}),/중복/);assert.throws(()=>f.insert(p.token,{receiptDate:'2026-10-22'}),/일자/);
  const cache=JSON.parse(f.state.cache.get('HD_INSERT_PREVIEW_'+p.token));cache.expiresAt=0;f.state.cache.set('HD_INSERT_PREVIEW_'+p.token,JSON.stringify(cache));assert.throws(()=>f.insert(p.token),/유효시간/);assert.equal(f.state.batches.length,0);
});
test('조회 중 수동 수정도 마지막 지문 검사에서 차단한다',()=>{
  const f=fixture(),p=f.preview();f.state.onJira=()=>{f.state.rows[0][16]='https://kic-itsd.atlassian.net/browse/ITM-3';};assert.throws(()=>f.insert(p.token),/확인 중 목록이 변경/);assert.equal(f.state.batches.length,0);
});
test('기존 본문·상태·수식·비고·다른 일자는 바꾸지 않는다',()=>{
  const f=fixture([record(1,'다음 날',{date:'2026-10-24'}),record(3),record(2),record(1),record(1,'이전 날',{date:'2026-10-22'})]);const before=structuredClone(f.state.rows);const p=f.preview();f.insert(p.token);
  for(const old of before){const current=f.state.rows.find(x=>x[8]===old[8]);assert.deepEqual(current.slice(1),old.slice(1));}
  assert(f.state.batches[0].requests.every(r=>!r.updateCells||r.updateCells.rows[0].values.length===1||r.updateCells.start.columnIndex===0));
});
test('수식처럼 보이는 신규 입력은 수식이 아닌 문자열로 기록한다',()=>{
  const f=fixture(),p=f.preview();f.insert(p.token,{title:'=IMPORTDATA("x")'});const request=f.state.batches[0].requests.find(r=>r.updateCells?.rows[0].values.length===19);assert.equal(request.updateCells.rows[0].values[8].userEnteredValue.stringValue,'=IMPORTDATA("x")');
});
test('문서 시간대가 UTC여도 동일한 KST 시점으로 저장한다',()=>{
  const f=fixture();f.state.zone='UTC';const p=f.preview();f.insert(p.token);assert.equal(f.state.rows.find(x=>x[8]==='중간 누락 원문')[2].toISOString(),'2026-10-23T00:05:00.000Z');
});
test('번호 캐시·팀 공통 싱크 제외를 이동하고 개인 설정은 보존한다',()=>{
  const f=fixture();f.props.setProperty('HELPDESK_JIRA_SYNC_EXCLUDED_77_IT-261023-002','Y');f.props.setProperty('UNRELATED','keep');const p=f.preview();f.insert(p.token);
  assert.equal(f.props.getProperty('HELPDESK_ISSUE_SEQ_261023'),'4');assert.equal(f.props.getProperty('HELPDESK_JIRA_SYNC_EXCLUDED_77_IT-261023-002'),null);assert.equal(f.props.getProperty('HELPDESK_JIRA_SYNC_EXCLUDED_77_IT-261023-003'),'Y');assert.equal(f.props.getProperty('UNRELATED'),'keep');
  assert(![...f.state.props.values()].some(x=>x.includes('새 본문')||x.includes('예시 새 직원')));
});
test('성공 응답이 유실돼도 같은 토큰 재확인은 중복 저장하지 않는다',()=>{
  const f=fixture(),p=f.preview(),first=f.insert(p.token),second=f.insert(p.token);assert.equal(second.id,first.id);assert.equal(f.state.batches.length,1);assert.equal(f.state.rows.length,4);assert.throws(()=>f.insert(p.token,{details:'다른 요청'}),/이미 처리/);
});
test('원자적 저장 후 통신이 끊겨도 표식을 확인해 결과만 복원한다',()=>{
  const f=fixture(),p=f.preview();f.state.writeMode='after-timeout';assert.throws(()=>f.insert(p.token),/timeout/);assert.throws(()=>f.context.assertHelpdeskInsertionIdle_(f.sheet),/결과/);
  const result=f.insert(p.token);assert.equal(result.id,p.id);assert.equal(f.state.batches.length,1);assert.equal(f.state.rows.length,4);
});
test('저장 여부가 불명확하면 자동 재전송하거나 다른 저장을 허용하지 않는다',()=>{
  const f=fixture(),p=f.preview();f.state.writeMode='before-timeout';assert.throws(()=>f.insert(p.token),/timeout/);assert.throws(()=>f.insert(p.token),/확정하지 못/);assert.throws(()=>f.context.assertHelpdeskIdentity_(f.sheet,1),/결과/);assert.equal(f.state.batches.length,1);assert.equal(f.state.rows.length,3);
});
test('Sheets 권한 실패는 일괄 거절하고 순차 쓰기로 폴백하지 않는다',()=>{
  const f=fixture(),p=f.preview();f.state.writeMode='403';assert.throws(()=>f.insert(p.token),/HTTP 403/);assert.equal(f.state.rows.length,3);assert.equal(f.props.getProperty('HELPDESK_INSERT_PENDING_77'),null);assert.equal(f.state.batches.length,1);
});
test('번호 변경 전의 일반 수정·상태·숨김 요청은 오래된 화면에서 적용할 수 없다',()=>{
  const f=fixture(),p=f.preview();f.insert(p.token);
  for(const action of ['updateIssue','updateStatus','updateHidden']){const response=f.call(action,{id:'IT-261023-002',status:'완료',hiddenYn:'Y',title:'덮어쓰면 안 됨'});assert.equal(response.success,false);assert.match(response.error,/번호가 변경/);}
  const fresh=f.call('updateStatus',{id:'IT-261023-002',status:'처리중',identityRevision:1});assert.equal(fresh.success,true);assert.equal(f.state.rows.find(x=>x[0]==='IT-261023-002')[11],'처리중');
});
test('이전 Jira 미리보기는 제외·적용 전에 번호 세대가 다른지 확인한다',()=>{
  const f=fixture(),sync=f.context.previewHelpdeskJiraSync(),p=f.preview();f.insert(p.token);assert.throws(()=>f.context.requireHelpdeskSyncPreview_(sync.token),/번호가 변경/);
});
test('최종 확인 없는 요청과 이미지 지시문/임의 필드로 번호를 지정할 수 없다',()=>{
  const f=fixture(),p=f.preview();assert.throws(()=>f.context.insertHelpdeskIssue({token:p.token,form:f.form()}),/확인/);assert.equal(f.state.batches.length,0);
  const result=f.insert(p.token,{id:'IT-000000-999',status:'완료'});assert.equal(result.id,'IT-261023-002');assert.equal(f.state.rows.find(x=>x[0]===result.id)[11],'접수대기');
});

test('새로 접속해 토큰을 잃어도 시트 표식만으로 결과를 확인하고 행을 재전송하지 않는다',()=>{
  const f=fixture(),p=f.preview();f.state.writeMode='after-timeout';assert.throws(()=>f.insert(p.token),/timeout/);
  f.state.cache.clear();const answer=f.call('checkIssueInsertion');assert.equal(answer.success,true);assert.equal(answer.data.recovered,true);
  assert.equal(answer.data.result.id,p.id);assert.equal(f.state.batches.length,1);assert.equal(f.state.rows.length,4);
  assert.equal(f.context.checkHelpdeskInsertion().recovered,false);assert.equal(f.props.getProperty('HELPDESK_INSERT_PENDING_77'),null);
});

test('표식이 없는 미확정 작업은 결과 확인으로도 잠금을 해제하지 않는다',()=>{
  const f=fixture(),p=f.preview();f.state.writeMode='before-timeout';assert.throws(()=>f.insert(p.token),/timeout/);
  assert.throws(()=>f.context.checkHelpdeskInsertion(),/확정하지 못/);assert.equal(f.state.batches.length,1);assert(f.props.getProperty('HELPDESK_INSERT_PENDING_77'));
});

test('408/429/5xx 응답을 확정 실패로 처리하거나 재전송하지 않는다',()=>{
  for(const code of ['408','429','503']){const f=fixture(),p=f.preview();f.state.writeMode=code;assert.throws(()=>f.insert(p.token),new RegExp('HTTP '+code));assert(f.props.getProperty('HELPDESK_INSERT_PENDING_77'));assert.throws(()=>f.insert(p.token),/확정하지 못/);assert.equal(f.state.batches.length,1);}
});

test('목적 번호의 과거 제외 기록이나 참조를 확정하지 못한 Jira 후보도 차단한다',()=>{
  let f=fixture();f.props.setProperty('HELPDESK_JIRA_SYNC_EXCLUDED_77_IT-261023-004','Y');assert.match(f.preview().reason,/과거 싱크 제외/);assert.equal(f.state.jiraCalls.length,0);
  f=fixture();f.state.jiraIssues=[{key:'ITM-88',issueNumbers:[]}];assert.equal(f.preview().allowed,false);assert.equal(f.state.batches.length,0);
});

test('비표준 자릿수로 같은 순번을 중복 표현한 일자는 번호를 변경하지 않는다',()=>{
  const rows=[record(2),record(1)];rows[0][0]='IT-261023-0001';const f=fixture(rows);assert.throws(()=>f.preview(),/번호·접수일시/);assert.equal(f.state.batches.length,0);
});

test('반복 제목 원문을 위치 추천의 기준점으로 사용하지 않는다',()=>{
  const f=fixture([record(2),record(1)]),row=(title,requester='예시 직원')=>({title,requester,isReply:false,uncertain:false});
  const result=f.context.compareHelpdeskListCapture({receiptDate:'2026-10-23',rows:[row('등록 2'),row('누락','새 직원'),row('등록 1'),row('등록 1')]});
  assert.equal(result.rows[1].positionKnown,false);
});

test('저장 API 권한은 행 쓰기 없이 점검하고 접근 실패 시 등록창 진입 전에 차단한다',()=>{
  const f=fixture();let answer=f.call('checkIssueInsertion',{verifyStorage:true});assert.equal(answer.data.storage.ready,true);
  f.state.storageStatus=403;answer=f.call('checkIssueInsertion',{verifyStorage:true});assert.equal(answer.data.storage.ready,false);
  const p=f.preview();assert.equal(p.allowed,false);assert.match(p.reason,/저장 API/);assert.equal(f.state.batches.length,0);assert.equal(f.state.props.size,0);
});

test('과거 접수 시간이 순번과 달라도 누락 대조는 가능하고 실제 삽입 위치만 검증한다',()=>{
  const rows=[record(3),record(2),record(1)];rows[0][2]=new Date('2026-10-23T08:00:00+09:00');const f=fixture(rows);
  const result=f.context.compareHelpdeskListCapture({receiptDate:'2026-10-23',rows:[{title:'등록 2',date:'2026-10-23',requester:'예시 직원',isReply:false,uncertain:false}]});
  assert.equal(result.rows[0].kind,'registered');assert.match(result.timeOrderWarning,/일부 기존 번호/);assert.equal(f.state.batches.length,0);
  const p=f.preview('IT-261023-001');assert.equal(p.allowed,true);assert.equal(p.receiptTime,'2026-10-23 09:05');
  assert.throws(()=>f.preview('IT-261023-002'),/선택한 앞뒤/);assert.equal(f.state.batches.length,0);
});
