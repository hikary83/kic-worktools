// 통합 일정 화면(v3.2.0): 옛 일정 전용 서버 대신 업무 서버(CONFIG.API_URL)를 공통 호출로 부르는지 확인합니다.
// 서버 응답은 모두 가짜이며 운영 서버·Jira 는 부르지 않습니다.
// 실행: NODE_PATH=<playwright 위치> node tests/jira-timeline.ui.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.argv[2] || 'playwright');

const root = path.resolve(__dirname, '../docs');
const API_ID = 'AKfycbyjbf1M5XTqdW203XQWUdwO1Y9qgu1rG_WqiWX0LVgJNEEldw4gMOf6_tGfXGxc6ABQnA'; // 업무 서버
const OLD_ID = 'AKfycbxncJs9huZd1ENzETRxRyKO5ikexxscHptSYGE6LIXsWP1DFDEn1Zmodk0H7vE8EuDR'; // 옛 일정 서버
const projects = [['C21R', 'CMS'], ['CW2R', 'CWIZ 2.0'], ['CWIZ', 'CWIZ 1.0'], ['ITM', 'IT 업무'], ['WWWMR', '홈페이지']].map(([key, name]) => ({ key, name, enabled: true }));
const issue = (key, projectKey) => ({ id: key, key, summary: key + ' 예시 일감', projectKey, projectName: projectKey, status: '진행 중', statusCategory: 'In Progress',
  statusCategoryKey: 'indeterminate', assignee: '예시 담당', startDate: '2026-11-16', dueDate: '2026-11-28', issueType: '작업', priority: '', reporter: '', labels: [],
  updated: '2026-11-16T09:00:00+09:00', parentKey: '', parentSummary: '', url: 'https://kic-itsd.atlassian.net/browse/' + key });
const json = body => ({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

async function main() {
  const server = http.createServer((req, res) => {
    const target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname));
    if (!target.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
    try {
      res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8');
      res.end(fs.readFileSync(target));
    } catch (_) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    async function open(answer) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), requests = [], errors = [];
      await context.addInitScript(() => { try { localStorage.setItem('kic-session', JSON.stringify({ token: 't'.repeat(64), id: 'tester', name: '테스트', role: 'admin', keep: true })); } catch (_) {} });
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.hostname === 'script.google.com') {
          const body = JSON.parse(request.postData() || '{}');
          requests.push({ method: request.method(), path: url.pathname, action: body.action, token: body.token });
          return route.fulfill(json(answer(body.action)));
        }
        if (url.origin === origin) return route.continue();
        if (request.resourceType() === 'stylesheet') return route.fulfill({ contentType: 'text/css', body: '' });
        if (url.href.includes('tailwind')) return route.fulfill({ contentType: 'application/javascript', body: 'window.tailwind={};' });
        return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/jira-timeline.html');
      return { context, page, requests, errors };
    }

    const ok = await open(action => action === 'getJiraTimelineConfig'
      ? { success: true, data: { enabled: true, configured: true, projects, missingProperties: [] } }
      : { success: true, data: { enabled: true, configured: true, issues: [issue('C21R-1', 'C21R'), issue('ITM-2', 'ITM')],
        meta: { fetchedAt: '2026-11-16T12:00:00+09:00', projects, startDateFieldFound: true, total: 2 } } });
    await ok.page.waitForFunction(() => /Jira Issue 2건/.test(document.getElementById('jiraStatus').textContent));
    assert.deepEqual(ok.requests.map(r => r.action), ['getJiraTimelineConfig', 'getJiraTimelineIssues']);
    assert.ok(ok.requests.every(r => r.method === 'POST' && r.path === `/macros/s/${API_ID}/exec` && r.token === 't'.repeat(64)), '업무 서버로 POST + 로그인 토큰');
    assert.ok(ok.requests.every(r => !r.path.includes(OLD_ID)), '옛 일정 서버는 부르지 않음');
    assert.equal(await ok.page.locator('#setupGuide.is-visible').count(), 0);
    assert.deepEqual(ok.errors, []); await ok.context.close();
    console.log('PASS 업무 서버로 설정 확인·일정 조회(POST·토큰), 옛 일정 서버 호출 없음, 일정 2건 표시');

    const missing = await open(() => ({ success: true, data: { enabled: true, configured: false, projects, missingProperties: ['JIRA_ACCOUNT_EMAIL', 'JIRA_API_TOKEN'] } }));
    await missing.page.locator('#setupGuide.is-visible').waitFor();
    const guide = await missing.page.locator('#setupGuide').innerText();
    assert.match(guide, /JIRA_ACCOUNT_EMAIL[\s\S]*JIRA_API_TOKEN/); assert.doesNotMatch(guide, /WEB_ENABLED|JIRA_TIMELINE_API_URL/);
    assert.deepEqual(missing.requests.map(r => r.action), ['getJiraTimelineConfig'], '설정이 없으면 일정은 묻지 않음');
    await missing.context.close();
    console.log('PASS Jira 계정 설정이 없으면 빠진 속성만 안내(웹 조회 스위치·옛 주소 안내 없음)');

    const ended = await open(() => ({ success: false, code: 'AUTH_REQUIRED', auth: true, error: '로그인이 끝났습니다.' }));
    await ended.page.waitForFunction(() => /로그인이 끝났습니다/.test(document.querySelector('.kic-login-msg')?.textContent || ''));
    assert.equal(await ended.page.locator('#setupGuide.is-visible').count(), 0, '설정 안내 대신 로그인 화면');
    await ended.context.close();
    console.log('PASS 로그인이 끝났으면 로그인 화면');
    console.log('\n3 timeline browser tests passed. No live API or Jira calls.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
