// Synthetic records only. No operational API, source workbook or GitHub write.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const origin=process.argv[2]||'http://127.0.0.1:12496';
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('Only a loopback preview is allowed.');
(async()=>{
  const {DEFINITIONS,readDataset}=await import(pathToFileURL(path.resolve(__dirname,'../docs/dashboard/js/usage-model.mjs')).href);
  const dataset=(kind,rows)=>readDataset([{name:'예시 로그',rows:[DEFINITIONS.find(def=>def.id===kind).required,...rows]}],'example_2026-10-21.xlsx');
  const change=(time,company,user,id)=>[time,company,user,id,'계측기 통합 대장','수정','예시 장비','설치 위치','원본 전','원본 후'];
  const changes=dataset('customerChanges',[
    change('2026-10-20 09:00:00','예시 고객 A','예시 고객','customer@example.invalid'),
    change('2026-10-21 09:00:00','예시 고객 A','예시 운영자',' Admin@KIC21.CO.KR '),
    change('2026-10-21 09:01:00','지원 전용 고객사','예시 운영자','admin@kic21.co.kr'),
    change('2026-10-21 09:02:00','예시 고객 B','고객 도메인','customer@kic21.co.kr.example.invalid'),
    change('잘못된 일시','지원 전용 고객사','예시 운영자','admin@kic21.co.kr')]);
  const access=dataset('customerAccess',[
    ['2026-10-20 08:00:00','예시 고객 A','예시 고객','customer@example.invalid','로그인','성공','192.0.2.1'],
    ['2026-10-21 08:00:00','예시 고객 A','예시 고객','customer@example.invalid','로그인','성공','192.0.2.1'],
    ['2026-10-21 08:01:00','예시 고객 A','예시 고객','customer@example.invalid','로그인','실패','192.0.2.1'],
    ['2026-10-20 08:01:00','지원 전용 고객사','예시 운영자','admin@kic21.co.kr','로그인','실패','192.0.2.2'],
    ['2026-10-21 08:01:00','지원 전용 고객사','예시 운영자','admin@kic21.co.kr','로그인','성공','192.0.2.2']]);
  const proxy=dataset('proxy',[['2026-10-20 07:50:00','예시 운영자','admin@kic21.co.kr','예시 고객 A','예시 고객 (customer@example.invalid)','예시 지원','192.0.2.2']]);
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1500,height:1100},locale:'ko-KR'}),errors=[];
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==new URL(origin).origin)throw Error('External request is not allowed.');
      if(url.pathname.endsWith('/staff-branch-map.json'))return route.fulfill({contentType:'application/json',body:JSON.stringify({staff:{예시운영자:'서울본사'}})});
      if(url.pathname.endsWith('/shared-data/manifest.json'))return route.fulfill({contentType:'application/json',body:JSON.stringify({schema:1,files:{}})});
      return route.continue();
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.name));
    await page.goto(origin+'/dashboard/');await page.waitForSelector('html[data-app-ready="true"]');
    await page.evaluate(async datasets=>{
      await new Promise((resolve,reject)=>{const r=indexedDB.open('cwiz-usage-analysis-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('analysis');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('analysis','readwrite');t.objectStore('analysis').put({schema:1,datasets},'current');t.oncomplete=()=>{db.close();resolve();};t.onerror=()=>reject(t.error);};});
    },[changes,access,proxy]);
    await page.reload();await page.waitForSelector('.kpi');await page.waitForFunction(()=>document.querySelector('#statusNote').textContent.includes('복원'));
    const card=label=>page.locator('.kpi').filter({has:page.locator('.kpi-label',{hasText:new RegExp('^'+label+'$')})});
    const value=async(label,number)=>assert.equal((await card(label).locator('.kpi-value').innerText()).replace(/\D/g,''),String(number));
    const count=async number=>assert.match(await page.locator('#dialogBody > .small-caption').first().innerText(),new RegExp(number+'행'));
    const close=()=>page.locator('#dialogClose').click();
    await value('고객 변경이력',2);await value('데이터 작업 고객사',2);await value('작업 계정',2);await value('로그인 고객사',1);await value('재방문 고객사',1);
    assert.match(await page.locator('[data-source-kind="customerChanges"] b').innerText(),/5행/);
    await card('고객 변경이력').click();await count(2);assert.equal(await page.locator('#dialogKind').inputValue(),'customerChanges');assert.equal(await page.locator('#includeInvalid').count(),0);
    assert(!(await page.locator('.change-log-table').innerText()).includes('예시 운영자'));await close();
    const weeks=await page.locator('[data-week-start]').getAttribute('aria-label');assert.match(weeks,/변경 2행/);
    await page.locator('[data-week-start]').click();await count(2);await close();
    await page.locator('#tab-customers').click();assert(!(await page.locator('#analysisView').innerText()).includes('지원 전용 고객사'));assert(!(await page.locator('#analysisView').innerText()).includes('예시 운영자'));
    assert((await page.locator('#analysisView').innerText()).includes('customer@kic21.co.kr.example.invalid'));
    if(process.env.CWIZ_DOMAIN_QA==='1')await page.screenshot({path:path.join(process.env.TEMP,'cwiz-domain-customers.png'),fullPage:true});
    await page.locator('#tab-support').click();await value('고객사 지원 작업',2);await value('고객사 관리자 접속',2);
    assert.match(await card('관리자 활동').innerText(),/미제공/);
    await page.locator('[data-filter="operatorLimit"]').selectOption('all');
    await page.locator('[data-operator].cell-button').click();await count(2);assert.equal(await page.locator('#dialogKind').inputValue(),'supportChanges');await close();
    await card('고객사 지원 작업').click();await count(2);assert.equal(await page.locator('#dialogKind').inputValue(),'supportChanges');
    assert.equal(await page.locator('#includeInvalid').count(),1);await page.locator('#includeInvalid').check();await count(3);
    await page.locator('#includeInvalid').uncheck();await count(2);
    await page.locator('#dialogMenu').selectOption('계측기 통합 대장');await count(2);
    await page.locator('[data-detail-row]').first().click();assert.match(await page.locator('#dialogBody').innerText(),/관리자 계정의 고객사 지원 기록/);assert.match(await page.locator('#dialogBody').innerText(),/원본 전/);assert.match(await page.locator('#dialogBody').innerText(),/원본 후/);
    await page.locator('[data-dialog-back]').click();assert.equal(await page.locator('#dialogKind').inputValue(),'supportChanges');
    await page.locator('#dialogKind').selectOption('customerChanges');await count(2);assert(!(await page.locator('.change-log-table').innerText()).includes('예시 운영자'));await close();
    await card('고객사 관리자 접속').click();await count(2);assert.equal(await page.locator('#dialogKind').inputValue(),'supportAccess');await close();
    if(process.env.CWIZ_DOMAIN_QA==='1')await page.screenshot({path:path.join(process.env.TEMP,'cwiz-domain-support.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.setViewportSize({width:1500,height:1100});await page.locator('#tab-security').click();await value('로그인 시도',3);await value('로그인 성공',2);await value('로그인 실패',1);
    await card('로그인 실패').click();await count(1);assert(!(await page.locator('#dialogBody').innerText()).includes('예시 운영자'));await close();
    await page.locator('#periodStart').fill('2026-10-21');await page.locator('#periodEnd').fill('2026-10-21');await page.locator('#queryBtn').click();await page.locator('#tab-summary').click();await value('고객 변경이력',1);
    await page.locator('#criteriaBtn').click();assert.match(await page.locator('#dialogBody').innerText(),/@kic21\.co\.kr/);await close();
    assert.deepEqual(errors,[]);
    console.log('PASS: schema-1 cache reclassification, exact domain, customer KPI/account/company/trend/modal/security exclusion, separate support changes/access, operator shortcut without admin file, invalid-date scope, original before/after, period filter, mobile layout and criteria. Synthetic records only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
