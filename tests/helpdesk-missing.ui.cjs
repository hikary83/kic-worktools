// 실제 화면+실제 백엔드 로직, 합성 시트/Jira/AI만 사용하는 회귀 테스트.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {fixture,record}=require('./fixtures/helpdesk-insertion-fixture.cjs');
const root=path.resolve(__dirname,'../docs'),f=fixture([record(3,'최신 등록 원문'),record(2,'이전 등록 원문'),record(1,'첫 등록 원문')]);
f.state.aiRows=[{title:'최신 등록 원문',requester:'예시 직원',time:'15:00',isReply:false,uncertain:false},
  {title:'중간에 누락된 요청 <확인>',requester:'예시 새 직원',time:'14:30',isReply:false,uncertain:false},
  {title:'[완료] 답글',requester:'예시 담당자',time:'14:40',isReply:true,uncertain:false},
  {title:'이전 등록 원문',requester:'예시 직원',time:'14:00',isReply:false,uncertain:false},
  {title:'잘린 제목...',requester:'',time:'13:00',isReply:null,uncertain:true},
  {title:'다른 날짜 원문',requester:'예시 직원',date:'2026-10-22',time:'12:00',isReply:false,uncertain:false}];
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=','base64');
const basicStyles='<style>.hidden{display:none!important}#addModal,#editModal,#settingsModal{position:fixed;inset:0;z-index:100;background:#fff;overflow:auto}#addModalContent,#editModalContent{max-width:760px;margin:auto;max-height:90vh;overflow:auto;padding:12px}#addModal input,#addModal textarea,#addModal select{display:block;margin:8px}#addModal button{padding:8px}.kic-lnb{display:none}.flex{display:flex}.flex-wrap{flex-wrap:wrap}button{cursor:pointer}</style>';
(async()=>{
  const server=http.createServer((req,res)=>{const target=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!target.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}try{let body=fs.readFileSync(target);if(target.endsWith('index.html')&&!process.env.KIC_MISSING_VISUAL)body=body.toString().replace('</head>',basicStyles+'</head>');res.setHeader('Content-Type',target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':target.endsWith('.json')?'application/json':'text/html;charset=utf-8');res.end(body);}catch(_){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  let browser,legacyCompare=false,failConfirmation=false,listAnalysisGate=null;const calls=[],errors=[];
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100}});
    await context.addInitScript(()=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-23T09:00:00+09:00']));}static now(){return NativeDate.parse('2026-10-23T09:00:00+09:00');}};});
    await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
      if(url.hostname==='script.google.com'){
        const body=request.method()==='POST'?JSON.parse(request.postData()):null,action=body?.action||url.searchParams.get('action'),data=body?.data||{};
        calls.push({action,data,method:request.method()});if(action==='analyzeListCapture'&&listAnalysisGate)await listAnalysisGate;const result=failConfirmation&&action==='setCaptureConfirmed'?{success:false,error:'synthetic confirmation failure'}:f.call(action,data);
        if(legacyCompare&&['analyzeListCapture','compareListCapture'].includes(action)&&result.data)delete result.data.autoPositionSupported;
        if(result.diagnostics){result.diagnostics.requestId=body?.requestId||url.searchParams.get('requestId');result.diagnostics.method=request.method();}
        return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(result)});
      }
      if(url.pathname.endsWith('/data/staff-branch-map.json'))return route.fulfill({contentType:'application/json',body:JSON.stringify({staff:{'예시 새 직원':'서울본사'}})});
      if(url.origin===origin)return route.continue();
      if(process.env.KIC_MISSING_VISUAL&&url.hostname==='cdn.tailwindcss.com')return route.continue();
      if(url.href.includes('tailwind'))return route.fulfill({contentType:'application/javascript',body:'window.tailwind={};'});
      if(url.href.includes('chart.js'))return route.fulfill({contentType:'application/javascript',body:'window.Chart=class {static defaults={font:{}};constructor(){}destroy(){}resize(){}update(){}};'});
      if(url.href.includes('marked'))return route.fulfill({contentType:'application/javascript',body:'window.marked={parse:x=>x};'});
      if(request.resourceType()==='stylesheet')return route.fulfill({contentType:'text/css',body:''});return route.abort();
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/index.html');
    await page.waitForFunction(()=>document.querySelector('#sync-indicator').innerText.includes('동기화 완료'));
    await page.getByRole('button',{name:'목록 캡처 누락 점검',exact:true}).click();assert.equal(await page.locator('#hd-missing-dialog').isVisible(),true);assert.equal(calls.filter(x=>x.action==='analyzeListCapture').length,0);
    await page.locator('#hd-missing-files').setInputFiles({name:'synthetic-list.png',mimeType:'image/png',buffer:image});
    await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('비교 완료'));
    assert.equal(await page.locator('#hd-missing-list [data-row]').count(),2);assert.equal(await page.locator('#hd-missing-list script').count(),0);assert.equal(f.state.batches.length,0);
    await page.locator('#hd-missing-tabs [data-filter="all"]').click();assert.equal(await page.locator('#hd-missing-list [data-row]').count(),6);assert.equal(await page.locator('[data-row="2"]').isDisabled(),true);assert.equal(await page.locator('[data-row="5"]').isDisabled(),false);
    await page.locator('#hd-missing-tabs [data-filter="missing"]').click();await page.locator('[data-row="1"]').click();assert.equal(await page.locator('#hd-missing-source-date').inputValue(),'2026-10-23');assert.equal(await page.locator('#hd-missing-source-time').inputValue(),'14:30');assert.equal(await page.locator('#hd-missing-prepare').isDisabled(),true);
    for(const id of ['branch','dev','system','type','priority','menu','source-link','jira-link','title','requester','details'])assert.equal(await page.locator('#hd-missing-'+id).isVisible(),true);
    assert.equal(await page.locator('#hd-missing-details').inputValue(),'');assert.equal(await page.locator('#hd-missing-source-link').inputValue(),'');assert.equal(await page.locator('#addModal').isVisible(),false);
    assert(await page.locator('#hd-missing-editor').evaluate(el=>el.previousElementSibling.querySelector('[data-row]')?.dataset.row==='1'));
    console.log('PASS 원문 날짜·시간 보존, 시간만 표시한 오늘과 과거 날짜 혼합 대조, 전체 신규 입력 항목이 목록 안에서 펼쳐짐');
    await page.locator('#hd-missing-post-files').setInputFiles({name:'synthetic-post.png',mimeType:'image/png',buffer:image});await page.waitForFunction(()=>document.querySelector('#hd-missing-post-status').innerText.includes('첨부 완료'));
    f.state.captureData={receiptDate:'2026-10-23',branch:'서울본사',requester:'예시 새 직원',system:'CMS',type:'오류',title:'중간에 누락된 요청 <확인>',details:'게시글 이미지에서 확인한 본문',sourceLink:'https://boards.office.hiworks.com/board/postview/3616/55555'};
    await page.locator('#hd-missing-post-analyze').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-post-status').innerText.includes('자동 입력 완료'));
    assert.equal(await page.locator('#hd-missing-details').inputValue(),'게시글 이미지에서 확인한 본문');assert.equal(await page.locator('#hd-missing-source-link').inputValue(),f.state.captureData.sourceLink);assert.equal(f.state.batches.length,0);
    await page.locator('#hd-missing-details').fill('사용자가 먼저 입력한 본문');f.state.captureData.details='덮어쓰면 안 되는 AI 본문';await page.locator('#hd-missing-post-analyze').click();await page.waitForFunction(()=>!document.querySelector('#hd-missing-post-analyze').disabled);assert.equal(await page.locator('#hd-missing-details').inputValue(),'사용자가 먼저 입력한 본문');
    await page.locator('[data-row="5"]').click();await page.locator('[data-row="1"]').click();assert.equal(await page.locator('#hd-missing-post-thumbs img').count(),1);assert.equal(await page.locator('#hd-missing-details').inputValue(),'사용자가 먼저 입력한 본문');assert(await page.locator('#hd-missing-editor').evaluate(el=>el.previousElementSibling.querySelector('[data-row]')?.dataset.row==='1'));
    console.log('PASS 선택 행 바로 아래 폼, 게시글 이미지 첨부·실제 분석 경로·기존 본문 보존·후보 전환 시 이미지/입력 유지');
    if(process.env.KIC_MISSING_VISUAL){
      await page.locator('.hd-missing-body').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(process.env.TEMP,'helpdesk-missing-reset-desktop.png')});
      const thumbnail=await page.locator('#hd-missing-thumbs img').boundingBox(),remove=await page.getByRole('button',{name:'목록 캡처 1 삭제',exact:true}).boundingBox();assert(Math.abs(thumbnail.y-remove.y)<=2);assert(Math.abs(thumbnail.x+thumbnail.width-remove.x-remove.width)<=2);
      await page.setViewportSize({width:390,height:844});await page.locator('.hd-missing-body').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(process.env.TEMP,'helpdesk-missing-reset-mobile.png')});
      await page.setViewportSize({width:1440,height:1100});await page.locator('#hd-missing-editor').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(process.env.TEMP,'helpdesk-missing-desktop.png')});
      await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(process.env.TEMP,'helpdesk-missing-mobile.png')});
      const box=await page.locator('#hd-missing-dialog').boundingBox();assert(box.x>=0&&box.x+box.width<=390);assert(await page.locator('#hd-missing-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
      await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.screenshot({path:path.join(process.env.TEMP,'helpdesk-missing-dark.png')});
      assert.deepEqual(errors,[]);console.log('PASS 실제 스타일의 데스크톱·모바일·다크모드 배치. 합성 자료만 사용.');return;
    }
    await page.locator('#hd-missing-details').fill('원문에서 직접 확인한 상세 내용');await page.locator('#hd-missing-branch').selectOption('서울본사');await page.locator('#hd-missing-confirm').check();f.state.jiraIssues=[{key:'ITM-77',issueNumbers:['IT-261023-003']}];await page.locator('#hd-missing-prepare').click();
    await page.waitForFunction(()=>!document.querySelector('#hd-missing-block').hidden);assert.match(await page.locator('#hd-missing-block').innerText(),/ITM-77/);assert.equal(await page.locator('#addModal').isVisible(),false);assert.equal(f.state.batches.length,0);
    console.log('PASS 작성시각으로 자동 위치 계산 후 Jira 참조 발견 시 경고·영향 번호 표시, 자동 등록 없음');
    f.state.jiraIssues=[];await page.locator('#hd-missing-prepare').click();await page.locator('#hd-missing-preview').waitFor();
    assert.equal(await page.locator('#hd-missing-dialog').isVisible(),true);assert.equal(await page.locator('#addModal').isVisible(),false);assert.match(await page.locator('#hd-missing-preview-text').innerText(),/IT-261023-003 → IT-261023-004/);assert.match(await page.locator('#hd-missing-preview-text').innerText(),/원문 작성일시: 2026-10-23 14:30/);assert.match(await page.locator('#hd-missing-preview-text').innerText(),/저장 정렬 시간: 2026-10-23 09:15/);
    assert.equal(await page.locator('#hd-missing-submit').isDisabled(),true);assert.equal(calls.filter(x=>x.action==='insertIssue').length,0);
    await page.locator('#hd-insertion-approve').check();await page.locator('#hd-missing-details').fill('수정해서 직접 확인한 상세 내용');assert.equal(await page.locator('#hd-missing-preview').isVisible(),false);assert.equal(await page.locator('#hd-missing-prepare').isDisabled(),true);
    await page.locator('#hd-missing-confirm').check();await page.locator('#hd-missing-prepare').click();await page.locator('#hd-missing-preview').waitFor();
    console.log('PASS 펼침 내에서 원문/정렬 시각·번호 변경 미리보기와 최종 승인, 내용 변경 시 이전 승인 무효화');
    await page.locator('#hd-insertion-approve').check();f.state.jiraFailure=true;await page.locator('#hd-missing-submit').click();await page.waitForFunction(()=>document.querySelector('#toast').innerText.includes('중간 등록 실패'));
    assert.equal(await page.locator('#hd-missing-editor').isVisible(),true);assert.equal(await page.locator('#hd-missing-details').inputValue(),'수정해서 직접 확인한 상세 내용');assert.equal(f.state.batches.length,0);assert.equal(calls.filter(x=>x.action==='insertIssue').length,1);
    console.log('PASS 저장 직전 Jira 실패 시 입력 유지·실제 번호/행 변경 없음·자동 쓰기 재시도 없음');
    // 다른 PC에 열려 있던 수정창도 재조회 후 예전 ID로 저장할 수 없어야 합니다.
    const other=await context.newPage();other.on('pageerror',error=>errors.push(error.message));await other.goto(origin+'/index.html');await other.waitForFunction(()=>document.querySelector('#sync-indicator').innerText.includes('동기화 완료'));await other.evaluate(()=>openEditById('IT-261023-003'));await other.locator('#editModal').waitFor();
    f.state.jiraFailure=false;await page.locator('#hd-missing-submit').click();await page.waitForFunction(()=>document.querySelector('#toast').innerText.includes('중간 등록 완료'));
    assert.equal(f.state.batches.length,1);assert.equal(f.state.rows.length,4);assert.equal(f.state.rows.find(x=>x[8]==='중간에 누락된 요청 <확인>')[0],'IT-261023-003');assert.equal(f.state.rows.find(x=>x[8]==='최신 등록 원문')[0],'IT-261023-004');
    assert([...f.state.notes.values()].some(note=>note.includes('원문 작성일시(한국시간): 2026-10-23 14:30')));
    await other.evaluate(()=>loadData(true));
    await other.waitForFunction(()=>window.allIssuesMap['IT-261023-003']?.title==='중간에 누락된 요청 <확인>');
    await other.locator('#edit-title').fill('오래된 창에서 덮어쓰면 안 됨');
    await other.locator('#editModal').getByRole('button',{name:'저장하기',exact:true}).click();
    await other.waitForFunction(()=>document.querySelector('#toast').innerText.includes('번호가 변경'));
    assert.equal(f.state.rows.find(x=>x[0]==='IT-261023-003')[8],'중간에 누락된 요청 <확인>');assert.equal(f.state.rows.find(x=>x[0]==='IT-261023-004')[8],'최신 등록 원문');
    console.log('PASS 확인 후 실제 서버 로직의 번호 재배치·시간 사이값 저장·다른 PC 오래된 편집창 보호');
    assert.equal(await page.locator('#hd-missing-list [data-row="1"]').isDisabled(),true);await page.locator('#hd-missing-compare').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('누락 의심 1건'));assert.equal(calls.filter(x=>x.action==='analyzeListCapture').length,1);
    const relatedTitle='지난 접수 제목 <img src=x onerror=alert(1)>';
    f.state.rows.push(record(1,relatedTitle,{date:'2026-10-22',status:'완료'}));f.state.rows.find(x=>x[8]==='최신 등록 원문')[11]='완료';
    f.state.aiRows=[{title:'최신 등록 원문.',requester:'예시 직원',time:'15:00',isReply:false,uncertain:false},{title:relatedTitle,requester:'예시 직원',time:'12:00',isReply:false,uncertain:false},{title:'첫 등록 원문',requester:'예시 직원',time:'13:00',isReply:false,uncertain:false}];
    await page.locator('#hd-missing-analyze').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('확인 필요 2건'));
    assert.equal(await page.locator('#hd-missing-tabs [data-filter="review"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#hd-missing-list .hd-missing-related').count(),2);
    assert.match(await page.locator('#hd-missing-list').innerText(),/IT-261022-001.*2026-10-22/);assert.match(await page.locator('#hd-missing-list').innerText(),/IT-261023-004/);assert.equal(await page.locator('#hd-missing-list img').count(),0);
    assert.equal(f.state.batches.length,1);await page.locator('[data-row="1"]').click();assert.match(await page.locator('#hd-missing-position-hint').innerText(),/다른 접수일/);assert.equal(await page.locator('#hd-missing-source-date').inputValue(),'2026-10-23');
    await page.locator('#hd-missing-details').fill('보존할 검토 내용');await page.locator('[data-row="0"]').click();await page.locator('[data-row="1"]').click();assert.equal(await page.locator('#hd-missing-details').inputValue(),'보존할 검토 내용');
    console.log('PASS 완료·다른 접수일·마침표 차이는 기등록 후보로 표시, 확인 필요 자동 선택·후보 원문 이스케이프·자동 등록/위치 확정 없음');
    f.state.aiRows=[{title:'과거 날짜의 누락 요청',requester:'예시 새 직원',date:'2026-10-22',time:'12:45',isReply:false,uncertain:false},{title:relatedTitle,requester:'예시 직원',date:'2026-10-22',time:'12:00',isReply:false,uncertain:false}];
    await page.locator('#hd-missing-analyze').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('누락 의심 1건'));await page.locator('[data-row="0"]').click();
    assert.equal(await page.locator('#hd-missing-source-date').inputValue(),'2026-10-22');await page.locator('#hd-missing-details').fill('과거 원문 내용 직접 입력');await page.locator('#hd-missing-branch').selectOption('서울본사');await page.locator('#hd-missing-confirm').check();await page.locator('#hd-missing-prepare').click();await page.locator('#hd-missing-preview').waitFor();
    assert.equal(await page.locator('#hd-missing-date').inputValue(),'2026-10-22');assert.match(await page.locator('#hd-missing-preview-text').innerText(),/IT-261022-002/);assert.match(await page.locator('#hd-missing-preview-text').innerText(),/2026-10-22 12:45/);assert.equal(f.state.batches.length,1);
    console.log('PASS 원문에 찍힌 과거 날짜의 해당 일자 목록을 다시 확인하고 자동 삽입 준비, 확인만으로 등록 없음');
    f.state.aiRows=[{title:'기존 원문 링크로 등록을 확인할 캡처',requester:'예시 새 직원',date:'2026-10-23',time:'17:00',isReply:false,uncertain:false}];
    await page.locator('#hd-missing-analyze').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('누락 의심 1건'));await page.locator('[data-row="0"]').click();await page.locator('#hd-missing-post-files').setInputFiles({name:'existing-post.png',mimeType:'image/png',buffer:image});await page.waitForFunction(()=>document.querySelector('#hd-missing-post-status').innerText.includes('첨부 완료'));
    f.state.captureData={receiptDate:'2026-10-23',requester:'예시 직원',title:'최신 등록 원문',details:'이미 등록된 게시글 본문',sourceLink:'https://boards.office.hiworks.com/board/postview/3616/10003?tracking=test'};
    await page.locator('#hd-missing-post-analyze').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('기존 등록이 확인'));
    assert.equal(await page.locator('#hd-missing-editor').isVisible(),false);assert.match(await page.locator('#hd-missing-list').innerText(),/IT-261023-004/);assert.equal(f.state.batches.length,1);
    console.log('PASS 게시글 원문 링크로 기존 등록을 확인하면 제목/날짜 차이가 있어도 누락 의심에서 분리, 실제 등록 없음');
    f.state.aiRows=[{title:'수동 등록 확인 요청',requester:'예시 직원',date:'2026-10-23',time:'16:20',isReply:false,uncertain:false},{title:'아직 확인하지 않은 별도 요청',requester:'예시 직원',date:'2026-10-23',time:'16:30',isReply:false,uncertain:false}];
    await page.locator('#hd-missing-analyze').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('누락 의심 2건'));const rowsBefore=structuredClone(f.state.rows),jiraBefore=f.state.jiraCalls.length;
    await page.locator('[data-confirm-row="0"]').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('등록 확인 완료'));
    assert.equal(await page.locator('#hd-missing-list [data-row="0"]').count(),0);assert.equal(await page.locator('#hd-missing-tabs [data-filter="excluded"]').innerText(),'등록 확인 제외 1');assert.deepEqual(f.state.rows,rowsBefore);assert.equal(f.state.jiraCalls.length,jiraBefore);
    await other.evaluate(()=>closeEditModal());await other.getByRole('button',{name:'목록 캡처 누락 점검',exact:true}).click();await other.locator('#hd-missing-files').setInputFiles({name:'same-list.png',mimeType:'image/png',buffer:image});await other.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('비교 완료'));
    assert.equal(await other.locator('#hd-missing-list [data-row="0"]').count(),0);await other.locator('#hd-missing-tabs [data-filter="excluded"]').click();await other.locator('[data-restore-row="0"]').click();await other.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('제외를 해제'));
    await page.locator('#hd-missing-compare').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('누락 의심 2건'));assert.deepEqual(f.state.rows,rowsBefore);assert.equal(f.state.batches.length,1);
    failConfirmation=true;await page.locator('[data-confirm-row="1"]').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('저장 여부를 확인하지 못'));
    assert.equal(await page.locator('#hd-missing-list [data-row="1"]').count(),1);failConfirmation=false;
    console.log('PASS 팀 공통 등록 확인·다른 화면에서도 제외 유지·복원·실제 상태/Jira 미변경·저장 실패 시 거짓 제외 없음');
    legacyCompare=true;const beforePreview=calls.filter(x=>x.action==='previewIssueInsertion').length;await page.locator('#hd-missing-analyze').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('화면과 업무 API를 함께 재배포'));assert.equal(await page.locator('#hd-missing-list [data-row]').count(),0);assert.equal(await page.locator('#hd-missing-editor').isVisible(),false);assert.equal(calls.filter(x=>x.action==='previewIssueInsertion').length,beforePreview);
    await page.setViewportSize({width:390,height:844});assert(await page.locator('#hd-missing-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.keyboard.press('Escape');assert.equal(await page.locator('#hd-missing-dialog').isVisible(),false);
    assert(calls.filter(x=>['analyzeListCapture','compareListCapture','previewIssueInsertion','insertIssue','setCaptureConfirmed','analyzeCapture'].includes(x.action)).every(x=>x.method==='POST'));
    assert.deepEqual(errors,[]);console.log('PASS 기존 추출 결과로 재비교·중복 후보 제거·모바일·Escape·신규 API의 POST 전용. 외부 AI/Jira/운영 시트 호출 없음.');
    legacyCompare=false;f.state.aiRows=[{title:'삭제 확인용 원문',requester:'예시 새 직원',date:'2026-10-21',time:'14:00',isReply:false,uncertain:false}];
    await page.setViewportSize({width:1440,height:1100});await page.getByRole('button',{name:'목록 캡처 누락 점검',exact:true}).click();await page.locator('#hd-missing-clear').click();
    assert.equal(await page.locator('#hd-missing-analyze').isDisabled(),true);assert.equal(await page.locator('#hd-missing-compare').isDisabled(),true);
    const listFiles=[{name:'delete-list.png',mimeType:'image/png',buffer:image},{name:'delete-list-2.png',mimeType:'image/png',buffer:image}];
    await page.locator('#hd-missing-files').setInputFiles(listFiles);await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('비교 완료'));
    assert.equal(await page.locator('#hd-missing-thumbs img').count(),2);assert.equal(await page.locator('#hd-missing-files').inputValue(),'');
    await page.locator('[data-row="0"]').click();await page.locator('#hd-missing-details').fill('이미지 삭제 후에도 보존할 입력');await page.locator('#hd-missing-branch').selectOption('서울본사');await page.locator('#hd-missing-confirm').check();await page.locator('#hd-missing-prepare').click();await page.locator('#hd-missing-preview').waitFor();await page.locator('#hd-insertion-approve').check();
    assert.equal(await page.locator('#hd-missing-submit').isDisabled(),false);
    const analysisBeforeDelete=calls.filter(item=>item.action==='analyzeListCapture').length,propsBeforeDelete=[...f.state.props],batchesBeforeDelete=f.state.batches.length;
    await page.getByRole('button',{name:'목록 캡처 1 삭제',exact:true}).click();
    assert.equal(await page.locator('#hd-missing-thumbs img').count(),1);assert.equal(await page.locator('#hd-missing-list [data-row]').count(),0);assert.equal(await page.locator('#hd-missing-preview').isVisible(),false);assert.equal(await page.locator('#hd-missing-editor').isVisible(),false);assert.equal(await page.locator('#hd-missing-submit').isDisabled(),true);assert.equal(await page.evaluate(()=>HelpdeskMissingCheck.insertion()),null);
    assert.equal(calls.filter(item=>item.action==='analyzeListCapture').length,analysisBeforeDelete);assert.equal(await page.locator('#hd-missing-compare').isDisabled(),true);
    let finishAnalysis;listAnalysisGate=new Promise(resolve=>finishAnalysis=resolve);
    try{await page.locator('#hd-missing-analyze').click();assert.equal(await page.getByRole('button',{name:'목록 캡처 1 삭제',exact:true}).isDisabled(),true);assert.equal(await page.locator('#hd-missing-clear').isDisabled(),true);}finally{listAnalysisGate=null;finishAnalysis();}
    await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('비교 완료'));assert.equal(calls.filter(item=>item.action==='analyzeListCapture').at(-1).data.images.length,1);
    await page.locator('[data-row="0"]').click();assert.equal(await page.locator('#hd-missing-details').inputValue(),'이미지 삭제 후에도 보존할 입력');
    await page.locator('#hd-missing-clear').click();assert.equal(await page.locator('#hd-missing-thumbs img').count(),0);assert.equal(await page.locator('#hd-missing-list [data-row]').count(),0);assert.equal(await page.locator('#hd-missing-clear').isDisabled(),true);assert.equal(await page.locator('#hd-missing-analyze').isDisabled(),true);
    await page.locator('#hd-missing-files').setInputFiles(listFiles[0]);await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('비교 완료'));assert.equal(await page.locator('#hd-missing-thumbs img').count(),1);
    await page.getByRole('button',{name:'목록 캡처 1 삭제',exact:true}).click();assert.equal(await page.locator('#hd-missing-thumbs img').count(),0);assert.equal(await page.locator('#hd-missing-analyze').isDisabled(),true);assert.equal(await page.locator('#hd-missing-compare').isDisabled(),true);
    assert.deepEqual([...f.state.props],propsBeforeDelete);assert.equal(f.state.batches.length,batchesBeforeDelete);assert.deepEqual(errors,[]);
    console.log('PASS 목록 이미지 개별 삭제·전체 초기화·잔여 이미지 재분석·동일 파일 재첨부·오래된 등록 승인 무효화·입력/팀 설정 보존·분석 중 삭제 차단');
    // v2.10.3: 누적 첨부·후보 근거·정정값 반영·등록 확인 연결 기준점
    f.state.jiraIssues=[];f.state.jiraWarnings=[];f.state.jiraFailure=false;f.state.rows.push(record(1,'교정필증 발행 일자 표시 오류 문의',{date:'2026-10-20'}));
    f.state.aiRows=[{title:'날짜 정정 필요 원문',requester:'예시 새 직원',date:'알수없음',time:'',isReply:false,uncertain:false},
      {title:'교정필증 발행 일자의 표시 오류 문의',requester:'예시 직원',date:'26-10-20',time:'14:00',isReply:false,uncertain:false},
      {title:'누락된 별도 요청 원문입니다',requester:'예시 새 직원',date:'26-10-20',time:'14:30',isReply:false,uncertain:false}];
    const propsBeforeLink=[...f.state.props],batchesBeforeLink=f.state.batches.length,analyses=()=>calls.filter(item=>item.action==='analyzeListCapture').length;
    const waitAnalyses=async count=>{for(let i=0;i<200&&analyses()<count;i++)await page.waitForTimeout(25);await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('비교 완료'));};
    assert.equal(await page.locator('#hd-missing-thumbs img').count(),0);let before=analyses();
    await page.locator('#hd-missing-files').setInputFiles({name:'page-1.png',mimeType:'image/png',buffer:image});await waitAnalyses(before+1);
    await page.locator('#hd-missing-files').setInputFiles({name:'page-2.png',mimeType:'image/png',buffer:image});await waitAnalyses(before+2);
    assert.equal(await page.locator('#hd-missing-thumbs img').count(),2);assert.equal(calls.filter(item=>item.action==='analyzeListCapture').at(-1).data.images.length,2);
    await page.locator('#hd-missing-files').setInputFiles([{name:'page-3.png',mimeType:'image/png',buffer:image},{name:'page-4.png',mimeType:'image/png',buffer:image}]);
    await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('최대 3장'));assert.equal(await page.locator('#hd-missing-thumbs img').count(),2);assert.equal(analyses(),before+2);
    await page.locator('#hd-missing-files').setInputFiles({name:'page-3.png',mimeType:'image/png',buffer:image});await waitAnalyses(before+3);assert.equal(await page.locator('#hd-missing-thumbs img').count(),3);
    await page.locator('#hd-missing-tabs [data-filter="review"]').click();
    const typoText=await page.locator('[data-row="1"]').evaluate(el=>el.closest('.hd-missing-row').innerText);assert.match(typoText,/IT-261020-001/);assert.match(typoText,/작성자 예시 직원 일치/);assert.match(typoText,/제목 차이: 캡처 “[^”]*일자의 표시[^”]*” ↔ 등록 “[^”]*일자 표시[^”]*”/);
    assert.match(await page.locator('[data-confirm-row="1"]').innerText(),/IT-261020-001와 동일/);assert.equal(await page.locator('[data-confirm-row="0"]').isDisabled(),true);
    await page.locator('#hd-missing-tabs [data-filter="missing"]').click();await page.locator('[data-row="2"]').click();
    await page.locator('#hd-missing-branch').selectOption('서울본사');await page.locator('#hd-missing-details').fill('연결 기준점 확인용 본문');await page.locator('#hd-missing-confirm').check();await page.locator('#hd-missing-prepare').click();
    await page.waitForFunction(()=>!document.querySelector('#hd-missing-block').hidden&&document.querySelector('#hd-missing-block').innerText.includes('IT-261020-001'));
    assert.match(await page.locator('#hd-missing-block').innerText(),/등록 확인/);assert.equal(await page.locator('#hd-missing-preview').isVisible(),false);
    await page.locator('#hd-missing-tabs [data-filter="review"]').click();await page.locator('[data-confirm-row="1"]').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('삽입 위치 기준점'));
    await page.locator('#hd-missing-tabs [data-filter="excluded"]').click();assert.match(await page.locator('[data-row="1"]').evaluate(el=>el.closest('.hd-missing-row').innerText),/위치 기준점 연결: IT-261020-001/);
    await page.locator('#hd-missing-tabs [data-filter="missing"]').click();await page.locator('[data-row="2"]').click();assert.equal(await page.locator('#hd-missing-details').inputValue(),'연결 기준점 확인용 본문');
    await page.locator('#hd-missing-confirm').check();await page.locator('#hd-missing-prepare').click();await page.locator('#hd-missing-preview').waitFor();
    const linkedPreview=calls.filter(item=>item.action==='previewIssueInsertion').at(-1).data;assert.equal(linkedPreview.captureRows[1].linkedIssueId,'IT-261020-001');assert.equal(linkedPreview.captureRows[2].linkedIssueId,undefined);
    assert.match(await page.locator('#hd-missing-preview-text').innerText(),/IT-261020-002/);assert.equal(f.state.batches.length,batchesBeforeLink);
    await page.locator('#hd-missing-tabs [data-filter="review"]').click();await page.locator('[data-row="0"]').click();assert.equal(await page.locator('[data-confirm-row="0"]').isDisabled(),true);
    await page.locator('#hd-missing-source-date').fill('2026-10-20');await page.locator('#hd-missing-source-time').fill('15:00');assert.equal(await page.locator('[data-confirm-row="0"]').isDisabled(),false);
    await page.locator('[data-confirm-row="0"]').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('등록 확인 완료'));
    const corrected=calls.filter(item=>item.action==='setCaptureConfirmed').at(-1).data.row;assert.equal(corrected.rawDate,'2026-10-20');assert.equal(corrected.rawTime,'15:00');
    await page.locator('#hd-missing-tabs [data-filter="excluded"]').click();await page.locator('[data-restore-row="0"]').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('제외를 해제'));
    await page.locator('#hd-missing-tabs [data-filter="all"]').click();assert.match(await page.locator('[data-row="0"]').evaluate(el=>el.closest('.hd-missing-row').innerText),/2026-10-20 15:00/);
    await page.locator('#hd-missing-tabs [data-filter="excluded"]').click();await page.locator('[data-restore-row="1"]').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('제외를 해제'));
    await page.locator('#hd-missing-tabs [data-filter="all"]').click();assert.doesNotMatch(await page.locator('[data-row="1"]').evaluate(el=>el.closest('.hd-missing-row').innerText),/위치 기준점 연결/);
    assert.deepEqual([...f.state.props],propsBeforeLink);assert.equal(f.state.batches.length,batchesBeforeLink);assert.deepEqual(errors,[]);
    console.log('PASS 목록 이미지 누적 첨부·3장 초과 차단, 후보 근거(작성자·제목 차이) 표시, 정정한 작성일시로 등록 확인, 기준점 부족 안내 후 등록 확인 연결로 위치 계산, 등록·번호 변경 없음');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
