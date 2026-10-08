// 공통 진단 UI/클립보드/저장 안내 검증. 모든 외부 요청은 합성 응답으로 대체합니다.
// node tests/gas-api-diagnostics.ui.cjs <playwright 모듈 경로> [스크린샷 디렉터리]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const screenshotDir = process.argv[3];
const source = fs.readFileSync(path.join(root, 'docs/js/config.js'));
async function main() {
  const server = http.createServer((req,res) => {
    res.setHeader('Content-Type', req.url === '/config.js' ? 'application/javascript' : 'text/html; charset=utf-8');
    res.end(req.url === '/config.js' ? source : '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#212121;color:#fff;font-family:sans-serif"><h1>헬프데스크 진단 UI 테스트</h1><script src="/config.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({channel:'msedge',headless:true});
    const context = await browser.newContext({viewport:{width:1180,height:800},permissions:['clipboard-read','clipboard-write']});
    let apiCalls=0;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if(url.origin === origin) return route.continue();
      if(url.hostname === 'script.google.com') {
        apiCalls++;
        return route.fulfill({status:302,headers:{'Access-Control-Allow-Origin':'*',Location:'https://script.googleusercontent.com/macros/echo?user_content_key=secret-onetime&lib=secret-lib'}});
      }
      if(url.hostname === 'script.googleusercontent.com') return route.fulfill({status:404,contentType:'text/html',headers:{'Access-Control-Allow-Origin':'*'},body:'<html>private-server-page secret-token</html>'});
      return route.abort();
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);
    const failure = await page.evaluate(async()=>{
      try {await callGASApi('addIssue',{title:'private-title',requester:'private-staff',images:['secret-image']});}
      catch(e){return {code:e.code,diagnostics:e.diagnostics};}
    });
    assert.equal(failure.code,'API_HTTP_ERROR');assert.equal(apiCalls,1);
    assert.equal(failure.diagnostics.responseAddress,'https://script.googleusercontent.com/macros/echo');
    assert.equal(failure.diagnostics.redirected,true);
    const panel=page.locator('#kic-api-diagnostic-notice');
    await panel.waitFor({state:'visible'});
    assert.match(await panel.innerText(),/신규 등록 실패.*HTTP 404/);
    assert.match(await panel.innerText(),/목록을 확인한 뒤/);
    await panel.getByRole('button',{name:'진단 로그 복사',exact:true}).click();
    const copied = await page.evaluate(()=>navigator.clipboard.readText());
    assert.equal(JSON.parse(copied).records.length,1);
    assert.doesNotMatch(copied,/private-title|private-staff|secret-image|secret-token|secret-onetime|secret-lib|user_content_key/);
    console.log('PASS 실제 404 리다이렉트·저장 확인 안내·안전한 로그 복사');
    if(screenshotDir) {fs.mkdirSync(screenshotDir,{recursive:true});await page.screenshot({path:path.join(screenshotDir,'diagnostic-desktop.png')});}
    await page.setViewportSize({width:375,height:740});
    const box=await panel.boundingBox();
    assert.ok(box.x>=15 && box.x+box.width<=360 && box.y+box.height<=740);
    if(screenshotDir) await page.screenshot({path:path.join(screenshotDir,'diagnostic-mobile.png')});
    console.log('PASS 모바일에서 안내·복사 버튼이 화면 안에 표시된다');
    await panel.getByRole('button',{name:'닫기',exact:true}).click();
    assert.equal(await panel.isVisible(),false);
    await page.reload();
    assert.equal(await page.evaluate(()=>getGASDiagnostics().length),1);
    console.log('PASS 닫기와 새로고침 후 기록 보존');
    await page.evaluate(async()=>{
      // 합성 11초 완료: 실제 지연/운영 저장 없이 긴 성공 경로만 검증합니다.
      const originalNow=Date.now;let now=originalNow();Date.now=()=>now;
      window.fetch=async()=>{now+=11000;return {status:200,ok:true,text:async()=>JSON.stringify({success:true,data:{id:'test'}})};};
      try {const result=await callGASApi('updateIssue',{});if(result.id!=='test')throw Error('changed result');}
      finally {Date.now=originalNow;}
    });
    assert.match(await panel.innerText(),/이슈 수정 지연 후 완료/);
    assert.doesNotMatch(await panel.innerText(),/목록을 확인한 뒤/);
    assert.deepEqual(errors,[]);
    console.log('PASS 느린 성공도 진단 가능하며 기존 성공 결과를 유지한다');
    await page.evaluate(async()=>{
      const originalNow=Date.now;let now=originalNow();Date.now=()=>now;
      window.fetch=async(url,options)=>{
        now+=16000;const request=JSON.parse(options.body);
        return {status:200,ok:true,text:async()=>JSON.stringify({success:true,data:{success:true,data:{title:'secret-title'}},
          diagnostics:{schema:1,requestId:request.requestId,method:'POST',elapsedMs:14000,stage:'capture_normalize',stages:[],
            ai:{task:'capture',attempts:[
              {model:'gemini-3.5-flash-lite',elapsedMs:3000,upstreamMs:2990,httpStatus:503,outcome:'failure',code:'AI_HTTP_ERROR',apiStatus:'UNAVAILABLE',reason:'secret-error'},
              {model:'gemini-2.5-flash-lite',elapsedMs:11000,upstreamMs:10980,httpStatus:200,outcome:'success',code:'OK',finishReason:'STOP'}]}}})};
      };
      try {const result=await callGASApi('analyzeCapture',{images:['secret-image']});if(result.data.title!=='secret-title')throw Error('changed result');}
      finally {Date.now=originalNow;}
    });
    assert.match(await panel.innerText(),/캡처 분석 지연 후 완료/);
    assert.match(await panel.innerText(),/사용 모델: gemini-2.5-flash-lite.*모델 전환 1회/);
    assert.match(await panel.innerText(),/gemini-3.5-flash-lite.*3.0초.*외부 API 일시 오류/);
    const captureBox=await panel.boundingBox();assert.ok(captureBox.x>=15&&captureBox.x+captureBox.width<=360&&captureBox.y+captureBox.height<=740);
    await panel.getByRole('button',{name:'진단 로그 복사',exact:true}).click();
    const captureLog=JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()));
    assert.equal(captureLog.version,'v2.8.9');assert.equal(captureLog.records.at(-1).server.ai.attemptCount,2);
    assert.equal(captureLog.records.at(-1).server.ai.fallbackUsed,true);assert.equal(captureLog.records.at(-1).server.ai.attempts[1].upstreamMs,10980);
    assert.doesNotMatch(JSON.stringify(captureLog),/secret-title|secret-error|secret-image/);
    await page.reload();assert.equal(await page.evaluate(()=>getGASDiagnostics().at(-1).server.ai.attemptCount),2);
    console.log('PASS 캡처 모델별 시간·전환 이유·모바일 안내·안전한 복사·재접속 기록 유지');
    await page.evaluate(async()=>{
      window.fetch=async()=>({status:200,ok:true,text:async()=>JSON.stringify({success:false,error:'test failure'})});
      try {await callGASApi('updateIssue',{});}catch(_){}
    });
    assert.equal(await page.locator('[data-ai]').isVisible(),false);
    assert.match(await panel.innerText(),/이슈 수정 실패/);assert.doesNotMatch(await panel.innerText(),/gemini|모델 전환/);
    assert.deepEqual(errors,[]);console.log('PASS 다른 기능의 실패 안내에 이전 캡처 모델 정보가 남지 않는다');
    await context.close();
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
