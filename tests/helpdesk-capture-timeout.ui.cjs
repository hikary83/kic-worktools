// 실제 신규 등록 화면에서 지연 종료·이미지/입력 보존·수동 재시도를 검증합니다.
// 모든 외부 요청은 합성 응답이며 30초 타이머만 빠르게 진행합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '../docs');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=', 'base64');
const css = '<style>.hidden{display:none!important}.kic-lnb{display:none!important}#addModal{position:fixed;inset:0;z-index:100;background:#fff;overflow:auto}#addModalContent{max-width:760px;margin:auto}input,textarea,select,button{margin:5px}body{font-family:sans-serif}</style>';
async function main() {
  const server = http.createServer((req, res) => {
    const target = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
    if (!target.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
    try {
      let body = fs.readFileSync(target);
      if (target.endsWith('index.html')) body = body.toString().replace('</head>', css + '</head>');
      res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.json') ? 'application/json' : 'text/html;charset=utf-8');
      res.end(body);
    } catch (_) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({channel:'msedge', headless:true});
    async function fixture(holdStaff = false) {
      const context = await browser.newContext({viewport:{width:1280, height:1000}});
      const calls = [], errors = [];
      await context.addInitScript(() => {
        const nativeTimer = window.setTimeout;
        window.setTimeout = (fn, ms, ...args) => nativeTimer(fn, ms === 30000 ? 2500 : ms === 5000 ? 500 : ms, ...args);
      });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        const answer = data => route.fulfill({contentType:'application/json', headers:{'Access-Control-Allow-Origin':'*'}, body:JSON.stringify({success:true, data})});
        if (url.hostname === 'script.google.com') {
          const body = req.method() === 'POST' ? JSON.parse(req.postData()) : null;
          const action = body?.action || url.searchParams.get('action');
          calls.push({action, route});
          if (action === 'getDashboardData') return answer({pendingCurrent:[], completedCurrent:[], pendingPast:[], quarterRequestItems:[], developers:[]});
          if (action === 'analyzeCapture') {
            if (!holdStaff && calls.filter(x => x.action === action).length === 1) return; // 응답 없음
            return answer({data:{requester:'검증용 직원', branch:'서울본사', title:'재시도 분석 결과', details:'새 분석 본문', receiptTime:'13:00'}});
          }
          throw Error('Unexpected operation: ' + action);
        }
        if (url.pathname.endsWith('/data/staff-branch-map.json')) {
          if (holdStaff) return;
          return route.fulfill({contentType:'application/json', body:JSON.stringify({staff:{'검증용 직원':'서울본사'}})});
        }
        if (url.origin === origin) return route.continue();
        if (url.href.includes('tailwind')) return route.fulfill({contentType:'application/javascript', body:'window.tailwind={};'});
        if (url.href.includes('chart.js')) return route.fulfill({contentType:'application/javascript', body:'window.Chart=class {static defaults={font:{}};constructor(){}destroy(){}resize(){}update(){}};'});
        if (url.href.includes('marked')) return route.fulfill({contentType:'application/javascript', body:'window.marked={parse:x=>x};'});
        if (req.resourceType() === 'stylesheet') return route.fulfill({contentType:'text/css', body:''});
        return route.abort();
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/index.html');
      await page.waitForFunction(() => document.querySelector('#sync-indicator').innerText.includes('동기화 완료'));
      await page.getByRole('button', {name:'새 이슈 등록', exact:true}).click();
      return {context, page, calls, errors};
    }
    const f = await fixture(), {page} = f;
    await page.locator('#add-title').fill('직접 입력한 제목');
    await page.locator('#add-details').fill('직접 입력한 상세 내용');
    await page.locator('#add-branch').selectOption('부산지사');
    const attach = name => page.locator('#add-capture-input').setInputFiles({name, mimeType:'image/png', buffer:image});
    await attach('first.png');
    await page.waitForFunction(() => document.querySelector('#add-capture-analyze-btn').disabled);
    await attach('second.png'); // 분석 중 들어온 자동 분석 예약도 시간초과 때 해제해야 합니다.
    await page.waitForFunction(() => document.querySelector('#add-capture-status').innerText.includes('분석 지연:'));
    assert.equal(await page.locator('#add-title').inputValue(), '직접 입력한 제목');
    assert.equal(await page.locator('#add-details').inputValue(), '직접 입력한 상세 내용');
    assert.equal(await page.locator('#add-branch').inputValue(), '부산지사');
    assert.equal(await page.locator('#add-capture-thumbs img').count(), 2);
    const retry = page.getByRole('button', {name:'다시 분석', exact:true});
    assert.equal(await retry.isEnabled(), true);
    await page.waitForTimeout(600);
    assert.equal(f.calls.filter(x => x.action === 'analyzeCapture').length, 1);
    assert.match(await page.locator('#kic-api-diagnostic-notice').innerText(), /캡처 분석 응답 지연/);
    console.log('PASS 대기 종료·다시 분석 버튼·두 이미지와 입력 보존·자동 재호출 없음');
    await retry.click();
    await page.waitForFunction(() => document.querySelector('#add-capture-status').innerText.includes('자동 입력 완료'));
    assert.equal(await page.locator('#add-title').inputValue(), '재시도 분석 결과');
    assert.equal(await page.locator('#add-branch').inputValue(), '부산지사');
    assert.equal(await page.locator('#add-capture-thumbs img').count(), 2);
    assert.equal(f.calls.filter(x => x.action === 'analyzeCapture').length, 2);
    assert.equal(f.calls.some(x => ['addIssue','updateIssue','insertIssue'].includes(x.action)), false);
    assert.deepEqual(f.errors, []);
    console.log('PASS 동일 이미지 수동 재시도 성공·지사 선택 보존·실제 등록 미호출');
    await f.context.close();
    const slowMap = await fixture(true);
    await slowMap.page.locator('#add-capture-input').setInputFiles({name:'staff-delay.png', mimeType:'image/png', buffer:image});
    await slowMap.page.waitForFunction(() => document.querySelector('#add-capture-status').innerText.includes('자동 입력 완료'));
    assert.equal(await slowMap.page.locator('#add-capture-analyze-btn').isEnabled(), true);
    assert.equal(await slowMap.page.locator('#add-branch').inputValue(), '서울본사');
    assert.deepEqual(slowMap.errors, []);
    console.log('PASS 직원 기준표 응답이 없어도 분석 결과 입력과 버튼 복구');
    await slowMap.context.close();
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
