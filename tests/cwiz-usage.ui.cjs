/* Read-only real-file integration check. No workbook is copied to the repository.
 * Usage: node tests/cwiz-usage.ui.cjs http://127.0.0.1:PORT DESKTOP_DIR OUTPUT_DIR
 * Set NODE_PATH to your installed Playwright directory if needed.
 */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const [base,desktop,out]=process.argv.slice(2);
if(!base||!desktop||!out)throw new Error('A loopback server, source directory and temporary output directory are required.');
const origin=new URL(base).origin;
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('Only a local preview can be tested.');
const names=['관리자활동이력_2026-10-21.xlsx','대리로그인이력_2026-10-21.xlsx','시스템오류이력_2026-10-21.xlsx','보안접속이력_2026-10-21.xlsx','데이터변경이력_2026-10-21.xlsx','보안접속이력_2026-10-21 (1).xlsx'];
const files=names.map(name=>path.join(desktop,name));
for(const file of files)assert(fs.existsSync(file),'Source workbook unavailable.');
const passed=[];
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1500,height:1100},locale:'ko-KR'});
  const errors=[],external=[];
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push('blocked');return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  const upload=async selected=>{if(!await page.locator('#uploadDetails').isVisible())await page.locator('#toggleUpload').click();await page.locator('#logFiles').setInputFiles(selected);await page.locator('#applyBtn').click();};
  // Real names are shown in the app. Avoid writing personal data to QA images by default.
  const capture=async name=>{if(process.env.CWIZ_SCREENSHOTS==='1')await page.screenshot({path:path.join(out,name),fullPage:true});};
  const close=()=>page.locator('#dialogClose').click();
  const card=label=>page.locator('.kpi').filter({has:page.locator('.kpi-label',{hasText:new RegExp('^'+label+'$')})});
  const cardValue=async(label,expected)=>assert.equal((await card(label).locator('.kpi-value').innerText()).replace(/[^0-9]/g,''),String(expected),label);
  const rowsCount=async(expected)=>assert.match(await page.locator('#dialogBody > .small-caption').first().innerText(),new RegExp(expected.toLocaleString('ko-KR')+'행'));
  const tab=id=>page.locator('#tab-'+id).click();
  try{
    await page.goto(origin+'/dashboard/');
    await page.waitForSelector('html[data-app-ready="true"]');
    assert.equal(await page.locator('#anonymousMode').count(),0,'Anonymity option should be removed.');
    assert.equal(await page.locator('.source-chip.ready').count(),0);
    await upload(files);
    await page.waitForFunction(()=>document.querySelector('#statusNote').classList.contains('success'),{},{timeout:60000});
    for(const [kind,count] of Object.entries({customerChanges:3306,customerAccess:510,adminChanges:13664,adminAccess:1691,proxy:188,errors:46}))assert.match(await page.locator(`[data-source-kind="${kind}"] b`).innerText(),new RegExp(count.toLocaleString('ko-KR')));
    assert.equal(await page.locator('#periodStart').inputValue(),'2026-08-10');
    assert.equal(await page.locator('#periodEnd').inputValue(),'2026-10-21');
    await cardValue('로그인 고객사',41);await cardValue('데이터 작업 고객사',16);await cardValue('작업 계정',25);await cardValue('고객 변경이력',3306);await cardValue('대리 접속',188);
    passed.push('실제 6종 XLSX 컬럼 판별·행 수·고객/관리자 분리');
    await card('로그인 고객사').click();await rowsCount(299);await close();
    const returning=Number((await card('재방문 고객사').locator('.kpi-value').innerText()).replace(/\D/g,''));
    await card('재방문 고객사').click();assert.equal(await page.locator('[data-filter="customerScope"]').inputValue(),'returning');assert.match(await page.locator('.page-count').first().innerText(),new RegExp('검색 '+returning+'개사'));
    await page.locator('[data-filter="customerScope"]').selectOption('all');await page.locator('[data-filter="customerLimit"]').selectOption('all');
    assert.equal(await page.locator('.panel').first().locator('tbody tr').count(),41);
    assert(await page.locator('.cell-button[data-company]').evaluateAll(elements=>elements.every(el=>el.textContent.trim().replace(/\s+/g,' ').toLocaleLowerCase('ko-KR')===el.dataset.company)),'Company labels should show the original names.');
    const companyCount=page.locator('.log-count[data-company]').first(),companyTotal=Number((await companyCount.innerText()).replace(/\D/g,''));
    await companyCount.focus();await page.keyboard.press('Enter');await rowsCount(companyTotal);
    assert(await page.locator('.change-log-table').isVisible(),'Change records should be shown directly.');
    assert((await page.locator('.change-log-table th').allTextContents()).includes('변경 전'));
    assert((await page.locator('.change-log-table th').allTextContents()).includes('변경 후'));
    const scopedCompany=await page.locator('#analysisView .cell-button[data-company]').first().innerText();
    assert(await page.locator('.change-log-table tbody tr td:nth-child(2) > span.change-value').evaluateAll((elements,expected)=>elements.every(el=>el.textContent===expected),scopedCompany),'Company count must stay scoped to the selected company.');
    const menu=await page.locator('#dialogMenu option').nth(1).getAttribute('value');await page.locator('#dialogMenu').selectOption(menu);
    assert(await page.locator('.change-menu').evaluateAll((elements,expected)=>elements.every(el=>el.textContent===expected),menu),'Menu filter should remain scoped.');
    const selectedType=await page.locator('.change-log-table .pill').first().innerText();await page.locator('#dialogType').selectOption(selectedType);
    assert(await page.locator('.change-log-table .pill').evaluateAll((elements,expected)=>elements.every(el=>el.textContent===expected),selectedType),'Type filter should apply.');
    const modalHeight=(await page.locator('#detailDialog').boundingBox()).height;
    await page.locator('[data-detail-row]').first().click();await page.locator('[data-dialog-back]').click();assert.equal((await page.locator('#detailDialog').boundingBox()).height,modalHeight);
    assert.equal(await page.locator('#dialogMenu').inputValue(),menu);assert.equal(await page.locator('#dialogType').inputValue(),selectedType);await close();
    const accountCount=page.locator('.log-count[data-account]').first(),accountTotal=Number((await accountCount.innerText()).replace(/\D/g,''));
    await accountCount.click();await rowsCount(accountTotal);await page.locator('#dialogLimit').selectOption('all');assert.equal(await page.locator('.change-log-table tbody tr').count(),accountTotal);await close();
    passed.push('고객사·계정 로그 숫자 클릭·전후 값·메뉴/유형 필터·키보드·목록 복귀');
    await page.locator('[data-company]').first().click();assert.match(await page.locator('#dialogBody').innerText(),/실제 작업자를 확정하지 않습니다/);
    await page.locator('[data-detail-row]').first().click();const detail=await page.locator('#dialogBody').innerText();assert(detail.includes('작업 주체 미확인'),'Attribution guard should remain.');assert(!detail.includes('원문 값 숨김'),'Original field values should be visible.');await page.locator('[data-dialog-back]').click();await close();
    passed.push('KPI 상세 조건·재방문 필터·10/20/전체·실명 및 원문 상세');
    await tab('support');await cardValue('관리자 활동',13664);await cardValue('계측기 매핑 로그',13054);await card('계측기 매핑 로그').click();await rowsCount(13054);await close();
    assert((await page.locator('[data-filter="operatorBranch"] option').allTextContents()).some(text=>text==='서울본사'));
    for(const button of [page.locator('.log-count[data-operator]:not([data-field])').first(),page.locator('.log-count[data-operator][data-field="menu"]').first()]){
      const count=Number((await button.innerText()).replace(/\D/g,''));await button.click();await rowsCount(count);assert(await page.locator('.change-log-table').isVisible());await close();
    }
    passed.push('관리자 활동·매핑 상세·공통 직원 JSON 지사 연결');
    await tab('security');await cardValue('로그인 시도',503);await cardValue('로그인 성공',299);await cardValue('로그인 실패',204);
    await card('로그인 성공').click();await rowsCount(299);await close();await card('로그인 실패').click();await rowsCount(204);await close();
    await page.locator('[data-filter="securityScope"]').selectOption('adminAccess');await cardValue('로그인 성공',1411);await cardValue('로그인 실패',184);
    await page.locator('button[data-open="errors"]').click();await rowsCount(46);assert.match(await page.locator('#dialogBody').innerText(),/상태 정보 없음/);await close();
    passed.push('로그아웃 제외·접속 대상 분리·오류 빈 상태 보존');
    await tab('summary');await page.locator('#periodStart').fill('2026-10-21');await page.locator('#periodEnd').fill('2026-10-21');await page.locator('#queryBtn').click();await cardValue('고객 변경이력',2);
    await page.locator('[data-preset="all"]').click();
    await upload([{name:names[0],mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:fs.readFileSync(files[0])},{name:'copy.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:fs.readFileSync(files[0])}]);
    await page.waitForFunction(()=>document.querySelector('#statusNote').classList.contains('error'));
    await cardValue('고객 변경이력',3306);assert.match(await page.locator('#statusNote').innerText(),/既存|기존 분석 데이터/);
    passed.push('기간 마지막 날·중복 유형 업로드 실패 시 기존 분석 보존');
    await page.evaluate(()=>localStorage.setItem('cwiz_legacy_test','keep'));
    await page.reload();await page.waitForFunction(()=>document.querySelector('#statusNote').textContent.includes('복원'));
    await cardValue('고객 변경이력',3306);assert.equal(await page.locator('#rememberData').count(),0);
    await page.locator('#toggleUpload').click();assert(await page.locator('#saveBtn').isEnabled(),'Restored source Excel files should remain eligible for Save.');await page.locator('#toggleUpload').click();
    await capture('cwiz-usage-summary.png');
    if(process.env.CWIZ_SUMMARY_QA==='1')await page.screenshot({path:path.join(out,'cwiz-classic-summary.png'),fullPage:true});
    await tab('customers');await capture('cwiz-usage-customers.png');
    await tab('support');await capture('cwiz-usage-support.png');
    await tab('security');await capture('cwiz-usage-security.png');
    await tab('summary');
    if(process.env.CWIZ_PRINT_QA==='1'){
      await page.emulateMedia({media:'print'});await page.pdf({path:path.join(out,'cwiz-usage-print-qa.pdf'),preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});
    }
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile document overflows.');
    await capture('cwiz-usage-mobile.png');
    if(process.env.CWIZ_SUMMARY_QA==='1')await page.screenshot({path:path.join(out,'cwiz-classic-mobile.png'),fullPage:true});
    await card('고객 변경이력').click();const box=await page.locator('#detailDialog').boundingBox();assert(box.width<390);await page.keyboard.press('Escape');assert(!(await page.locator('#detailDialog').evaluate(el=>el.open)));
    passed.push('자동 브라우저 보관·원본 및 Save 상태 복원·이전 디자인·모바일 배치');
    await page.setViewportSize({width:1500,height:1100});
    await page.locator('#resetBtn').click();await page.waitForFunction(()=>!document.querySelector('.source-chip.ready'));
    assert.equal(await page.evaluate(()=>localStorage.getItem('cwiz_legacy_test')),'keep');
    await upload([files[3]]);await page.waitForFunction(()=>document.querySelector('#statusNote').classList.contains('success'));
    assert.match(await card('고객 변경이력').innerText(),/미제공/);await tab('customers');assert.match(await page.locator('tbody').first().innerText(),/미제공/);
    await page.goto(origin+'/dashboard/?tab=weekly&week=2026-08-31');await page.waitForURL('**/legacy.html?tab=weekly&week=2026-08-31');
    passed.push('부분 파일의 미제공 표시·기존 캐시 보존·주간 링크 호환');
    assert.deepEqual(errors,[],'Browser errors');assert.deepEqual(external,[],'External request attempted');
    console.log(JSON.stringify({passed,groups:passed.length,browserErrors:errors.length,externalRequests:external.length,screenshotsEnabled:process.env.CWIZ_SCREENSHOTS==='1'},null,2));
  }catch(error){console.error('UI check failed:',error.message);await capture('cwiz-usage-ui-failure.png');process.exitCode=1;}
  finally{await browser.close();}
})();
