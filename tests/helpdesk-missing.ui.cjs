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
  let browser;const calls=[],errors=[];
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100}});
    await context.addInitScript(()=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-23T09:00:00+09:00']));}static now(){return NativeDate.parse('2026-10-23T09:00:00+09:00');}};});
    await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
      if(url.hostname==='script.google.com'){
        const body=request.method()==='POST'?JSON.parse(request.postData()):null,action=body?.action||url.searchParams.get('action'),data=body?.data||{};
        calls.push({action,data,method:request.method()});const result=f.call(action,data);
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
    assert.equal(await page.locator('#hd-missing-list [data-row]').count(),1);assert.equal(await page.locator('#hd-missing-list script').count(),0);assert.equal(f.state.batches.length,0);
    await page.locator('#hd-missing-tabs [data-filter="all"]').click();assert.equal(await page.locator('#hd-missing-list [data-row]').count(),6);assert.equal(await page.locator('[data-row="2"]').isDisabled(),true);assert.equal(await page.locator('[data-row="5"]').isDisabled(),true);
    await page.locator('#hd-missing-tabs [data-filter="missing"]').click();await page.locator('[data-row="1"]').click();assert.equal(await page.locator('#hd-missing-after').inputValue(),'IT-261023-002');assert.equal(await page.locator('#hd-missing-prepare').isDisabled(),true);
    console.log('PASS 이미지 업로드 후 실제 비교·답글/다른 날짜 제외·불확실한 행 분리·위치 추천·선택만으로 저장 없음');
    if(process.env.KIC_MISSING_VISUAL){
      await page.screenshot({path:path.join(process.env.TEMP,'helpdesk-missing-desktop.png')});
      await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(process.env.TEMP,'helpdesk-missing-mobile.png')});
      const box=await page.locator('#hd-missing-dialog').boundingBox();assert(box.x>=0&&box.x+box.width<=390);assert(await page.locator('#hd-missing-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
      await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.screenshot({path:path.join(process.env.TEMP,'helpdesk-missing-dark.png')});
      assert.deepEqual(errors,[]);console.log('PASS 실제 스타일의 데스크톱·모바일·다크모드 배치. 합성 자료만 사용.');return;
    }
    await page.locator('#hd-missing-confirm').check();f.state.jiraIssues=[{key:'ITM-77',issueNumbers:['IT-261023-003']}];await page.locator('#hd-missing-prepare').click();
    await page.waitForFunction(()=>!document.querySelector('#hd-missing-block').hidden);assert.match(await page.locator('#hd-missing-block').innerText(),/ITM-77/);assert.equal(await page.locator('#addModal').isVisible(),false);assert.equal(f.state.batches.length,0);
    console.log('PASS Jira 참조가 발견되면 경고와 영향 번호 표시·등록 모달 열지 않음');
    f.state.jiraIssues=[];await page.locator('#hd-missing-prepare').click();await page.locator('#hd-insertion-approve').waitFor();
    assert.equal(await page.locator('#hd-missing-dialog').isVisible(),false);assert.equal(await page.locator('#addModal').isVisible(),true);assert.equal(await page.locator('#add-title').inputValue(),'중간에 누락된 요청 <확인>');assert.equal(await page.locator('#add-date').isDisabled(),true);
    assert.equal(await page.locator('#add-details').inputValue(),'');assert.equal(await page.locator('#add-source-link').inputValue(),'');assert.match(await page.locator('#add-insertion-notice').innerText(),/IT-261023-003 → IT-261023-004/);
    await page.locator('#add-details').fill('원문에서 직접 확인한 상세 내용');await page.locator('#add-branch').selectOption('서울본사');await page.locator('#addModal').getByRole('button',{name:'이슈 등록 (이관)',exact:true}).click();assert.equal(calls.filter(x=>x.action==='insertIssue').length,0);
    console.log('PASS 기존 등록 모달 재사용·번호/시간 변경 안내·날짜 잠금·본문/URL 추정 금지·최종 확인 체크 필수');
    await page.locator('#hd-insertion-approve').check();f.state.jiraFailure=true;await page.locator('#addModal').getByRole('button',{name:'이슈 등록 (이관)',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#toast').innerText.includes('중간 등록 실패'));
    assert.equal(await page.locator('#addModal').isVisible(),true);assert.equal(await page.locator('#add-details').inputValue(),'원문에서 직접 확인한 상세 내용');assert.equal(f.state.batches.length,0);assert.equal(calls.filter(x=>x.action==='insertIssue').length,1);
    console.log('PASS 저장 직전 Jira 실패 시 입력 유지·실제 번호/행 변경 없음·자동 쓰기 재시도 없음');
    // 다른 PC에 열려 있던 수정창도 재조회 후 예전 ID로 저장할 수 없어야 합니다.
    const other=await context.newPage();other.on('pageerror',error=>errors.push(error.message));await other.goto(origin+'/index.html');await other.waitForFunction(()=>document.querySelector('#sync-indicator').innerText.includes('동기화 완료'));await other.evaluate(()=>openEditById('IT-261023-003'));await other.locator('#editModal').waitFor();
    f.state.jiraFailure=false;await page.locator('#addModal').getByRole('button',{name:'이슈 등록 (이관)',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#toast').innerText.includes('중간 등록 완료'));
    assert.equal(f.state.batches.length,1);assert.equal(f.state.rows.length,4);assert.equal(f.state.rows.find(x=>x[8]==='중간에 누락된 요청 <확인>')[0],'IT-261023-003');assert.equal(f.state.rows.find(x=>x[8]==='최신 등록 원문')[0],'IT-261023-004');
    await other.evaluate(()=>loadData(true));
    await other.waitForFunction(()=>window.allIssuesMap['IT-261023-003']?.title==='중간에 누락된 요청 <확인>');
    await other.locator('#edit-title').fill('오래된 창에서 덮어쓰면 안 됨');
    await other.locator('#editModal').getByRole('button',{name:'저장하기',exact:true}).click();
    await other.waitForFunction(()=>document.querySelector('#toast').innerText.includes('번호가 변경'));
    assert.equal(f.state.rows.find(x=>x[0]==='IT-261023-003')[8],'중간에 누락된 요청 <확인>');assert.equal(f.state.rows.find(x=>x[0]==='IT-261023-004')[8],'최신 등록 원문');
    console.log('PASS 확인 후 실제 서버 로직의 번호 재배치·시간 사이값 저장·다른 PC 오래된 편집창 보호');
    await page.getByRole('button',{name:'목록 캡처 누락 점검',exact:true}).click();assert.equal(await page.locator('#hd-missing-list [data-row="1"]').isDisabled(),true);await page.locator('#hd-missing-compare').click();await page.waitForFunction(()=>document.querySelector('#hd-missing-status').innerText.includes('누락 의심 0건'));assert.equal(calls.filter(x=>x.action==='analyzeListCapture').length,1);
    await page.setViewportSize({width:390,height:844});assert(await page.locator('#hd-missing-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.keyboard.press('Escape');assert.equal(await page.locator('#hd-missing-dialog').isVisible(),false);
    assert(calls.filter(x=>['analyzeListCapture','compareListCapture','previewIssueInsertion','insertIssue'].includes(x.action)).every(x=>x.method==='POST'));
    assert.deepEqual(errors,[]);console.log('PASS 기존 추출 결과로 재비교·중복 후보 제거·모바일·Escape·신규 API의 POST 전용. 외부 AI/Jira/운영 시트 호출 없음.');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
