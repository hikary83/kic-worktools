// 실제 헬프데스크 DOM의 로딩/캐시/저장 경합 검증. 모든 운영 API·외부 라이브러리는 모의 응답입니다.
// node tests/helpdesk-loading.ui.cjs <playwright 모듈 경로>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '../docs');
const issue = (id,title,date,status='접수대기') => ({id,title,date,status,sourceType:'helpdesk',sourceLabel:'헬프',branch:'서울본사',requester:'테스트',
  dev:'테스트 담당자',details:'테스트 상세 내용',system:'CMS',type:'기능개선',priority:'보통',menu:'테스트 메뉴',remark:'',actionContent:'',sourceLink:'',jiraLink:''});
const items=[issue('IT-261007-001','캐시 첫 업무','2026-10-07 09:00'),issue('IT-261006-002','완료 업무','2026-10-06 09:00','완료'),
  issue('IT-260930-003','이전 기간 업무','2026-09-30 09:00','예정')];
const developers=[{name:'테스트 담당자',email:'test@example.invalid'}];
const stats=title=>({pendingCurrent:[{...items[0],title},items[2]],completedCurrent:[items[1]],quarterRequestItems:[],developers});
const cache={full:{issues:items,quarterRequestItems:[],developers},savedAt:Date.parse('2026-10-06T08:00:00Z')};
const chartStub=`window.chartBuilds=[];window.Chart=class {static defaults={font:{}};constructor(ctx,config){this.data=config.data;this.options=config.options;window.chartBuilds.push(config);}destroy(){}resize(){}update(){}};`;
async function main(){
  const server=http.createServer((req,res)=>{
    const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
    if(!target.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
    try{
      let body=fs.readFileSync(target);
      if(target.endsWith('index.html')) body=body.toString().replace('</head>','<style>.hidden{display:none!important}.kic-lnb{display:none!important}.flex{display:flex}.block{display:block}#editModal,#addModal,#settingsModal{position:fixed;inset:0;z-index:100;background:#fff;overflow:auto}#editModalContent{max-width:600px;margin:auto}body{font-family:sans-serif}</style></head>');
      res.setHeader('Content-Type',target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':target.endsWith('.json')?'application/json':'text/html; charset=utf-8');res.end(body);
    }catch(_){res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;let browser;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});
    async function fixture(cached=true,accelerated=false){
      const context=await browser.newContext({viewport:{width:1280,height:900}}),requests=[],errors=[];
      await context.addInitScript(({cache,accelerated})=>{
        const NativeDate=Date,base=NativeDate.now(),start=Math.max(NativeDate.parse('2026-10-07T08:00:00Z'),Number(localStorage.getItem('test-clock'))||0);
        localStorage.setItem('test-clock',String(start+60000));
        window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[start+NativeDate.now()-base]));}static now(){return start+NativeDate.now()-base;}};
        if(cache&&!localStorage.getItem('kic_dashboard_cache'))localStorage.setItem('kic_dashboard_cache',JSON.stringify(cache));
        const pendingFont=new Promise(resolve=>window.releaseFonts=()=>{window.fontsReleased=true;resolve([]);});
        Object.defineProperty(document,'fonts',{value:{load:()=>pendingFont,ready:pendingFont},configurable:true});
        if(accelerated){const nativeTimer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>nativeTimer(fn,ms===20000?500:ms,...args);}
      },{cache:cached?cache:null,accelerated});
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.hostname==='script.google.com'){
          const body=request.method()==='POST'?JSON.parse(request.postData()):null;
          const entry={method:request.method(),action:body?.action||url.searchParams.get('action'),data:body?.data,
            requestId:body?.requestId||url.searchParams.get('requestId'),route};requests.push(entry);
          if(entry.action==='getDashboardData')return; // 테스트에서 순서대로 응답합니다.
          if(entry.action==='updateIssue')return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({success:true,data:{}})});
          if(entry.action==='saveDevelopers')return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({success:true,data:{}})});
          if(entry.action==='addIssue')return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({success:true,data:{id:'IT-261007-004',date:'2026-10-07 10:00'}})});
          throw Error('Unexpected operation: '+entry.action);
        }
        if(url.origin===origin)return route.continue();
        if(url.href.includes('tailwind'))return route.fulfill({contentType:'application/javascript',body:'window.tailwind={};'});
        if(url.href.includes('chart.js'))return route.fulfill({contentType:'application/javascript',body:chartStub});
        if(url.href.includes('marked'))return route.fulfill({contentType:'application/javascript',body:'window.marked={parse:x=>x};'});
        if(request.resourceType()==='stylesheet')return route.fulfill({contentType:'text/css',body:''});
        return route.abort();
      });
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      const reply=async(entry,title,status=200)=>entry.route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(status===200?
        {success:true,data:stats(title),diagnostics:{schema:1,requestId:entry.requestId,method:entry.method,elapsedMs:10}}:{success:false,error:'Service unavailable'})});
      const reads=()=>requests.filter(r=>r.action==='getDashboardData');
      await page.goto(origin+'/index.html');return {page,context,requests,errors,reply,reads};
    }
    const f=await fixture();const {page}=f;
    await page.waitForFunction(()=>document.getElementById('kpi-total').innerText==='2');
    assert.equal(f.reads().length,1);assert.equal(f.reads()[0].method,'GET');
    assert.equal(await page.evaluate(()=>chartBuilds.length),0);assert.equal(await page.locator('#dashboard-content').isVisible(),true);
    assert.match(await page.locator('#sync-indicator').innerText(),/이전 목록 표시.*동기화 중[\s\S]*2026.10.06/);
    console.log('PASS 폰트·조회 응답을 기다리지 않고 캐시 목록과 KPI를 표시');
    await page.locator('#startDate').fill('2026-09-28');await page.locator('#endDate').fill('2026-10-04');
    await page.getByRole('button',{name:'조회',exact:true}).click();assert.equal(await page.locator('#kpi-total').innerText(),'1');assert.equal(f.reads().length,1);
    await page.getByRole('button',{name:'이번주',exact:true}).click();assert.equal(await page.locator('#kpi-total').innerText(),'2');
    await f.reply(f.reads()[0],'새 전체 목록');await page.waitForFunction(()=>fullIssueData.issues.some(i=>i.title==='새 전체 목록'));
    await page.evaluate(()=>releaseFonts());await page.waitForFunction(()=>chartBuilds.length>=4);
    assert.match(await page.locator('#sync-indicator').innerText(),/동기화 완료/);
    assert.equal(await page.evaluate(()=>chartBuilds.at(-1).data.datasets[0].data.reduce((a,b)=>a+b,0)),2);
    console.log('PASS 조회 기간 즉시 집계·중복 요청 방지·폰트 준비 후 최신 차트 표시');

    await page.getByRole('button',{name:'조회',exact:true}).click();await page.waitForFunction(()=>fullIssueFetchPromise!==null);
    await page.evaluate(()=>openEditById('IT-261007-001'));await page.locator('#edit-title').fill('수정 성공한 업무');
    await page.locator('#editModal').getByRole('button',{name:'저장하기',exact:true}).click();
    await page.waitForFunction(()=>fullIssueData.issues.some(i=>i.title==='수정 성공한 업무'));
    assert.equal(f.requests.filter(r=>r.action==='updateIssue').length,1);
    let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('kic_dashboard_cache')));
    assert.ok(saved.full.issues.some(i=>i.title==='수정 성공한 업무'));assert.ok(saved.lastLocalSaveAt>saved.syncedAt);
    await f.reply(f.reads()[1],'저장 전 오래된 조회');await page.waitForFunction(()=>getGASDiagnostics().filter(r=>r.action==='getDashboardData').length>=2);
    for(let i=0;i<30&&f.reads().length<3;i++)await page.waitForTimeout(20);
    assert.equal(f.reads().length,3);assert.equal(await page.evaluate(()=>fullIssueData.issues.find(i=>i.id==='IT-261007-001').title),'수정 성공한 업무');
    await f.reply(f.reads()[2],'수정 성공한 업무');await page.waitForFunction(()=>fullIssueFetchPromise===null);
    console.log('PASS 실제 수정 저장·캐시 반영·늦은 목록 덮어쓰기 방지·새 확인 한 번');

    await page.evaluate(()=>openSettingsModal());await page.locator('.dev-name').fill('새 담당자');
    await page.locator('#settingsModal').getByRole('button',{name:'설정 저장',exact:true}).click();
    await page.waitForFunction(()=>fullIssueData.developers[0].name==='새 담당자');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kic_dashboard_cache')).full.developers[0].name),'새 담당자');
    console.log('PASS 담당자 설정 저장도 캐시와 최신 목록에 반영');

    await page.evaluate(()=>openAddModal());await page.locator('#add-branch').selectOption('서울본사');
    await page.locator('#add-title').fill('신규 등록 테스트');await page.locator('#add-details').fill('저장 성공 후 캐시 반영 확인');
    await page.locator('#addModal').getByRole('button',{name:'이슈 등록 (이관)',exact:true}).click();
    await page.waitForFunction(()=>fullIssueData.issues.some(i=>i.id==='IT-261007-004'));
    assert.equal(f.requests.filter(r=>r.action==='addIssue').length,1);
    assert.equal(await page.locator('#kpi-total').innerText(),'3');
    assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('kic_dashboard_cache')).full.issues.some(i=>i.id==='IT-261007-004')));
    console.log('PASS 실제 신규 등록 성공·캐시 반영·등록 요청 한 번');

    await page.reload();await page.waitForFunction(()=>document.getElementById('kpi-total').innerText==='3');
    assert.ok(await page.evaluate(()=>fullIssueData.issues.some(i=>i.title==='수정 성공한 업무')));
    assert.match(await page.locator('#sync-indicator').innerText(),/저장 내용 포함/);
    await f.reply(f.reads()[3],null,403);await page.waitForFunction(()=>fullIssueFetchPromise===null);
    assert.match(await page.locator('#sync-indicator').innerText(),/동기화 실패.*이전 목록 유지/);
    assert.equal(await page.locator('#dashboard-content').isVisible(),true);
    await page.waitForTimeout(4200);assert.equal(await page.locator('#sync-indicator').isVisible(),true);
    assert.equal(f.reads().length,4);assert.deepEqual(f.errors,[]);await f.context.close();
    console.log('PASS 재접속 시 저장된 목록 복원·권한 오류 재시도 없음·실패 안내 지속');

    const timed=await fixture(false,true);
    await timed.page.waitForFunction(()=>getGASDiagnostics().some(r=>r.code==='API_READ_TIMEOUT'));
    assert.match(await timed.page.locator('#sync-indicator').innerText(),/한 번 더 조회 중/);
    for(let i=0;i<20&&timed.reads().length<2;i++)await timed.page.waitForTimeout(5);
    assert.equal(timed.reads().length,2);assert.equal(timed.reads()[1].method,'POST');await timed.reply(timed.reads()[1],'재조회 성공');
    await timed.page.waitForFunction(()=>fullIssueFetchPromise===null);
    assert.equal(await timed.page.locator('#dashboard-content').isVisible(),true);assert.deepEqual(timed.errors,[]);
    await timed.context.close();console.log('PASS 초기 캐시 없음·합성 시간초과·한 번 재조회 후 정상 표시');
    console.log('\n7 browser test groups passed. No live API or spreadsheet writes. External font/chart assets were mocked.');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
