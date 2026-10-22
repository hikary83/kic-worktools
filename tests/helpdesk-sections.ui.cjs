// Test the actual page with synthetic records and mocked operational APIs only.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../docs');
const issue=(id,title,status='접수대기',date='2026-10-22 09:00:00',type='기능개선')=>({id,title,status,date,type,sourceType:'helpdesk',sourceLabel:'헬프',branch:'서울본사',requester:'예시 요청자',dev:'예시 담당자',details:'합성 테스트 내용',system:'CMS',priority:'보통',menu:'예시 메뉴',remark:'원문 메모',actionContent:'',sourceLink:'https://example.invalid/source',jiraLink:''});
const initial=[issue('IT-261022-001','신규 접수 A'),issue('IT-261022-002','신규 접수 B','접수대기',undefined,'오류'),
  issue('IT-261022-003','검토하는 업무','검토중'),issue('IT-261022-004','검색 전용 예정 업무','예정'),issue('IT-261022-005','처리하는 업무','처리중',undefined,'오류'),
  issue('IT-261022-006','완료 업무','완료'),issue('IT-261022-007','반려 업무','반려'),issue('IT-261022-008','상태 미기재 업무',''),issue('IT-261022-009','이전 상태값 업무','과거 상태'),
  issue('IT-261015-001','이월 예정 업무','예정','2026-10-15 09:00:00'),issue('IT-261015-002','이월 반려 업무','반려','2026-10-15 09:00:00')];
const quarter={...issue('Q-001','분기 요청','접수대기','2026-09-01 09:00:00'),sourceType:'quarter',sourceLabel:'분기'};
const developers=[{name:'예시 담당자',email:'test@example.invalid'}];
const chartStub='window.Chart=class {static defaults={font:{}};constructor(ctx,config){this.data=config.data;this.options=config.options;}destroy(){}resize(){}update(){}};';
const basicStyles='<style>.hidden{display:none!important}.relative{position:relative}.absolute{position:absolute}.flex-col{flex-direction:column}#globalSearchClearBtn{position:absolute;right:4px;top:4px;width:28px;height:28px}.kic-lnb{display:none!important}.flex{display:flex}.flex-wrap{flex-wrap:wrap}.items-center{align-items:center}.justify-between{justify-content:space-between}.gap-2{gap:8px}.shrink-0{flex-shrink:0}.flex-1{flex:1}.min-w-0{min-width:0}.grid{display:grid;gap:16px}.mb-4{margin-bottom:16px}#dashboard-content>div{margin:24px}#editModal,#addModal,#settingsModal{position:fixed;inset:0;z-index:100;background:#fff;overflow:auto}#editModalContent{max-width:600px;margin:auto}.hd-section-help-button:before{content:"ⓘ"}.kic-tool-offset{margin-left:0!important;padding-left:0!important}body.kic-with-lnb{padding-left:0!important}</style>';
(async()=>{
  const server=http.createServer((req,res)=>{
    const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
    if(!target.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
    try{let body=fs.readFileSync(target);if(target.endsWith('index.html'))body=body.toString().replace('</head>',basicStyles+'</head>');res.setHeader('Content-Type',target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':target.endsWith('.json')?'application/json':'text/html; charset=utf-8');res.end(body);}catch(_){res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;let browser;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:1100}}),requests=[],errors=[];let items=structuredClone(initial),failWrite=false;
    await context.addInitScript(({items,quarter,developers})=>{
      const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-22T03:00:00Z']));}static now(){return NativeDate.parse('2026-10-22T03:00:00Z');}};
      if(!localStorage.getItem('kic_dashboard_cache'))localStorage.setItem('kic_dashboard_cache',JSON.stringify({schema:1,savedAt:Date.now(),full:{issues:items,quarterRequestItems:[quarter],developers}}));
    },{items,quarter,developers});
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.hostname==='script.google.com'){
        const body=request.method()==='POST'?JSON.parse(request.postData()):null,action=body?.action||url.searchParams.get('action'),requestId=body?.requestId||url.searchParams.get('requestId');requests.push({action,data:body?.data});
        let data;if(action==='getDashboardData')data={pendingCurrent:items.filter(x=>!['완료','반려'].includes(x.status)),completedCurrent:items.filter(x=>['완료','반려'].includes(x.status)),quarterRequestItems:[quarter],developers};
        else if(action==='updateIssue'){if(failWrite)return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({success:false,error:'테스트 저장 실패'})});const item=items.find(x=>x.id===body.data.id);Object.assign(item,body.data);data={id:item.id};}
        else throw Error('Unexpected operational action: '+action);
        return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({success:true,data,diagnostics:{schema:1,requestId,method:request.method(),elapsedMs:10}})});
      }
      if(url.origin===origin)return route.continue();
      if(process.env.KIC_SECTIONS_VISUAL==='1'&&url.hostname==='cdn.tailwindcss.com')return route.continue();
      if(url.href.includes('tailwind'))return route.fulfill({contentType:'application/javascript',body:'window.tailwind={};'});
      if(url.href.includes('chart.js'))return route.fulfill({contentType:'application/javascript',body:chartStub});
      if(url.href.includes('marked'))return route.fulfill({contentType:'application/javascript',body:'window.marked={parse:x=>x};'});
      if(request.resourceType()==='stylesheet')return route.fulfill({contentType:'text/css',body:''});return route.abort();
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const count=async(id,value)=>assert.equal(await page.locator('#'+id).innerText(),value+'건');
    const card=id=>page.locator('#'+id+' .kic-card-interactive');
    await page.goto(origin+'/index.html');await page.waitForFunction(()=>document.querySelector('#kpi-total').innerText==='9'&&document.querySelector('#sync-indicator').innerText.includes('동기화 완료'));
    await count('count-pending-current',4);await count('count-progress-current',3);await count('count-done-current',2);await count('count-past',3);
    assert.equal(await card('pending-current-container').count(),4);assert.equal(await card('progress-current-container').count(),3);
    assert.equal(await page.locator('#progress-current-container').isVisible(),false);assert.equal(await page.locator('#done-current-container').isVisible(),false);assert.equal(await page.locator('#pending-past-container').isVisible(),false);
    for(const status of ['검토중','예정','처리중'])assert.match(await page.locator('#progress-current-status-counts').innerText(),new RegExp(status+' 1건'));
    assert.equal(await page.locator('#kpi-pending').innerText(),'7');assert.equal(await page.locator('#btn-toggle-progress').getAttribute('aria-expanded'),'false');
    if(process.env.KIC_SECTIONS_VISUAL==='1'){
      // Visual QA is limited to this change; modal/API flows use the offline fixture below.
      await page.locator('#tab-pending-content').screenshot({path:path.join(process.env.TEMP,'helpdesk-sections-desktop.png')});
      await page.getByRole('button',{name:'진행 관리 상태 안내',exact:true}).hover();assert.equal(await page.locator('#tooltip-progress-current').isVisible(),true);
      await page.setViewportSize({width:390,height:844});
      await page.getByRole('button',{name:'진행 관리 상태 안내',exact:true}).evaluate(el=>el.scrollIntoView({block:'center'}));
      await page.getByRole('button',{name:'진행 관리 상태 안내',exact:true}).focus();
      await page.waitForFunction(()=>{const r=document.querySelector('#tooltip-progress-current').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth;});
      await page.screenshot({path:path.join(process.env.TEMP,'helpdesk-sections-mobile-tooltip.png')});
      await page.evaluate(()=>document.documentElement.classList.remove('dark'));await page.waitForTimeout(250);assert.equal(await page.locator('#tooltip-progress-current').isVisible(),true);
      await page.screenshot({path:path.join(process.env.TEMP,'helpdesk-sections-mobile-light.png')});
      assert.deepEqual(errors,[]);assert.equal(requests.filter(x=>x.action==='updateIssue').length,0);
      console.log('PASS 실제 스타일의 기본 접힘·상태 건수·마우스 툴팁·모바일·라이트/다크 배치. 합성 자료만 표시.');return;
    }
    console.log('PASS 캐시·첫 조회의 접수/진행 분리, 기본 접힘, 상태별 건수 및 기존 KPI·완료·이월 보존');
    await page.locator('#btn-toggle-progress').click();assert.equal(await page.locator('#progress-current-container').isVisible(),true);
    await page.evaluate(()=>onSuccess(currentStats,false));assert.equal(await page.locator('#progress-current-container').isVisible(),true);
    await page.locator('#pending-current-container [data-filter-type="오류"]').click();assert.equal(await card('pending-current-container').count(),1);assert.equal(await card('progress-current-container').count(),3);
    await page.locator('#progress-current-container [data-filter-type="기능개선"]').click();assert.equal(await card('progress-current-container').count(),2);assert.equal(await card('pending-current-container').count(),1);
    await page.locator('#btn-toggle-progress').click();
    console.log('PASS 수동 펼침 상태 보존 및 영역별 독립 유형 필터');
    await page.evaluate(()=>openEditById('IT-261022-001'));assert.equal(await page.locator('#edit-status').inputValue(),'접수대기');assert.equal(requests.filter(x=>x.action==='updateIssue').length,0);
    await page.locator('#edit-status').selectOption('검토중');await page.locator('#editModal').getByRole('button',{name:'저장하기',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#count-progress-current').innerText==='4건');await count('count-pending-current',3);assert.equal(await page.locator('#progress-current-container').isVisible(),false);assert.equal(await page.locator('#kpi-pending').innerText(),'7');
    await page.evaluate(()=>openEditById('IT-261022-003'));await page.locator('#edit-status').selectOption('완료');await page.locator('#editModal').getByRole('button',{name:'저장하기',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#count-done-current').innerText==='3건');await count('count-progress-current',3);assert.equal(await page.locator('#kpi-pending').innerText(),'6');
    failWrite=true;await page.evaluate(()=>openEditById('IT-261022-002'));await page.locator('#edit-status').selectOption('예정');await page.locator('#editModal').getByRole('button',{name:'저장하기',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#toast').innerText.includes('실패'));await count('count-pending-current',3);await count('count-progress-current',3);await page.evaluate(()=>closeEditModal());failWrite=false;
    console.log('PASS 모달 열기만으로 상태 미변경, 저장 성공 시 영역 이동·실패 시 기존 목록 보존');
    await page.locator('#globalSearchInput').fill('검색 전용 예정');await page.waitForFunction(()=>document.querySelector('#count-progress-current').innerText==='1건');await count('count-pending-current',0);assert.equal(await page.locator('#progress-current-container').isVisible(),true);assert.match(await page.locator('#globalSearchSummary').innerText(),/검색 결과 1건/);
    await page.locator('#globalSearchClearBtn').click();await page.waitForFunction(()=>document.querySelector('#count-progress-current').innerText==='3건');assert.equal(await page.locator('#progress-current-container').isVisible(),false);await page.waitForTimeout(120); // 기존 IME 검색 초기화의 80ms 지연까지 완료
    await page.locator('#globalSearchInput').fill('존재하지 않는 검색');await page.waitForFunction(()=>document.querySelector('#count-progress-current').innerText==='0건');assert.match(await page.locator('#progress-current-container').innerText(),/검색 결과가 없습니다/);await page.locator('#globalSearchClearBtn').click();await page.waitForTimeout(120);
    console.log('PASS 검색 시 진행 관리 자동 펼침·전체 검색 건수·초기화 재접힘·빈 결과 처리');
    for(const [label,id,text] of [['접수 확인 상태 안내','tooltip-intake-current','접수대기'],['진행 관리 상태 안내','tooltip-progress-current','검토중·예정·처리중'],['완료 영역 상태 안내','tooltip-done-current','완료·반려'],['이월 영역 상태 안내','tooltip-past','미완료 분기 요청']]){
      await page.getByRole('button',{name:label,exact:true}).focus();assert.equal(await page.locator('#'+id).isVisible(),true);const tooltipText=await page.locator('#'+id).innerText();assert(tooltipText.includes(text));assert.match(tooltipText,/^상태: [^\n]+\n조회 /);
    }
    await page.keyboard.press('Escape');assert.equal(await page.locator('#tooltip-past').isVisible(),false);
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'진행 관리 상태 안내',exact:true}).focus();const box=await page.locator('#tooltip-progress-current').boundingBox();assert(box.x>=0&&box.x+box.width<=390,'Tooltip outside mobile viewport: '+JSON.stringify({box,layout:await page.locator('#tooltip-progress-current').evaluate(el=>{const a=[];for(let p=el;p&&a.length<7;p=p.parentElement){const r=p.getBoundingClientRect();a.push({tag:p.tagName,id:p.id,classes:p.className,x:r.x,width:r.width,position:getComputedStyle(p).position});}return a;})}));
    await page.evaluate(()=>document.documentElement.classList.add('dark'));assert.equal(await page.locator('#tooltip-progress-current').isVisible(),true);
    console.log('PASS 네 영역 툴팁의 키보드 포커스·모바일 경계·다크모드 표시');
    await page.setViewportSize({width:1440,height:1100});await page.reload();await page.waitForFunction(()=>document.querySelector('#sync-indicator').innerText.includes('동기화 완료'));await count('count-pending-current',3);await count('count-progress-current',3);assert.equal(await page.locator('#progress-current-container').isVisible(),false);
    await page.locator('#startDate').fill('2026-10-12');await page.locator('#endDate').fill('2026-10-18');await page.getByRole('button',{name:'조회',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#kpi-total').innerText==='2');await count('count-pending-current',0);await count('count-progress-current',1);await count('count-done-current',1);assert.equal(await page.locator('#progress-current-container').isVisible(),false);
    assert.deepEqual(errors,[]);assert.equal(requests.filter(x=>x.action==='updateIssue').length,3);
    console.log('PASS 재접속 시 저장 상태 반영·진행 관리 초기 접힘. 운영 API 호출·실제 데이터 변경 없음.');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
