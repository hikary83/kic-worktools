// 합성 데이터로 실제 모달 JS/CSS를 검증합니다. 운영 API에는 연결하지 않습니다.
// node tests/helpdesk-jira-sync.ui.cjs <playwright 모듈 경로> [스크린샷 디렉터리]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://kic-itsd.atlassian.net/browse/';
function candidate(key, changes) { return { key, title: '테스트용 Jira 업무', status: '완료', url: origin + key, changes }; }
const changes = [
  { field: 'jiraLink', label: 'Jira 링크', from: '미등록', to: origin + 'ITM-100' },
  { field: 'jiraLinked', label: 'Jira 연동', from: '미표시', to: '연동됨' },
  { field: 'status', label: '상태', from: '접수대기', to: '완료', note: '처리일시는 Jira 해결일로 반영합니다.' }
];
const rows = [
  { id: 'IT-261001-001', title: '모니터 추가 요청', status: '접수대기', sourceLink: 'https://example.test/board?post=123&section=it', jiraLink: '', candidates: [candidate('ITM-100', changes)] },
  { id: 'IT-261001-002', title: 'Jira 연결이 빠진 업무', status: '처리중', jiraLink: '', candidates: [] },
  { id: 'IT-261001-003', title: '연결 후보가 여러 개인 업무', status: '처리중', jiraLink: '', candidates: [candidate('ITM-101', changes), candidate('ITM-102', changes)] },
  { id: 'IT-261001-004', title: '<img src=x onerror="alert(1)"> 악성 제목도 텍스트로만 표시', status: '완료', sourceLink: 'javascript:alert(1)', jiraLink: origin + 'ITM-104', candidates: [candidate('ITM-104', [])] }
];
const fixture = { token: '00000000-0000-0000-0000-000000000001', expiresAt: Date.now() + 600000, rows, warnings: [] };
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/css/helpdesk-jira-sync.css"><style>body {font-family:Arial,sans-serif;background:#212121;} * {box-sizing:border-box;} button,input,select {font:inherit;}</style>
  <button onclick="openHelpdeskJiraSync()" title="Jira 싱크 확인">싱크</button><script>
  window.calls=[]; window.reloadCount=0;
  const fixture=${JSON.stringify(fixture).replace(/</g, '\\u003c')};
  window.callGASApi=async function(action,data) {window.calls.push({action,data});
    if(action==='previewJiraSync') return JSON.parse(JSON.stringify(fixture));
    if(action==='lookupJiraSync') {const row=JSON.parse(JSON.stringify(fixture.rows.find(row=>row.id===data.id)));
      row.candidates=[{key:data.issueKey,title:'직접 조회한 Jira 업무',status:'진행 중',url:'${origin}'+data.issueKey,changes:[{field:'jiraLink',label:'Jira 링크',from:'미등록',to:'${origin}'+data.issueKey}]}];return row;}
    if(action==='applyJiraSync') return {applied:data.selections,skipped:[]};throw Error('Unexpected action');};
  window.loadData=function(){window.reloadCount++;};</script><script src="/js/helpdesk-jira-sync.js"></script></html>`;

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html); return; }
    const files = { '/js/helpdesk-jira-sync.js': 'docs/js/helpdesk-jira-sync.js', '/css/helpdesk-jira-sync.css': 'docs/css/helpdesk-jira-sync.css' };
    const file = files[req.url];
    if (!file) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css;charset=utf-8' : 'text/javascript;charset=utf-8');
    res.end(fs.readFileSync(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.getByTitle('Jira 싱크 확인').click();
    await page.locator('[data-sync-row]').waitFor();
    assert.equal(await page.locator('[data-sync-row]').count(), 1);
    assert.equal(await page.locator('[data-sync-field]:checked').count(), 0);
    assert.equal(await page.locator('[data-sync-action="apply"]').isDisabled(), true);
    assert.equal(await page.evaluate(() => calls.some(call => call.action === 'applyJiraSync')), false);
    console.log('PASS open preview does not apply; changes default unchecked');
    const source = page.getByRole('link', { name: 'IT-261001-001 원문 보기' });
    assert.equal(await source.getAttribute('href'), 'https://example.test/board?post=123&section=it');
    assert.equal(await source.getAttribute('target'), '_blank');
    assert.equal(await source.getAttribute('rel'), 'noopener noreferrer');
    console.log('PASS source link next to issue number opens original URL in new tab');

    await page.locator('[data-sync-field="status"]').check();
    assert.equal(await page.locator('[data-sync-field="jiraLink"]').isChecked(), true);
    assert.equal(await page.locator('[data-sync-field="jiraLinked"]').isChecked(), false);
    await page.locator('[data-sync-field="jiraLink"]').uncheck();
    assert.equal(await page.locator('[data-sync-field]:checked').count(), 0);
    console.log('PASS new link dependency; deselect link clears dependent changes');

    await page.locator('[data-sync-filter="all"]').click();
    assert.equal(await page.locator('[data-sync-row]').count(), 4);
    assert.equal(await page.locator('.hd-sync img').count(), 0);
    assert.equal(await page.locator('[data-sync-row="IT-261001-004"] .hd-sync-source').count(), 0);
    assert.equal(await page.locator('[data-sync-row="IT-261001-002"] .hd-sync-source').count(), 0);
    assert.equal(await page.locator('[data-sync-candidate]').inputValue(), '');
    console.log('PASS all rows, escaped content, ambiguous candidates have blank initial value');
    if (process.argv[3]) {
      await page.screenshot({ path: path.join(process.argv[3], 'helpdesk-jira-sync-light.png') });
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await page.screenshot({ path: path.join(process.argv[3], 'helpdesk-jira-sync-dark.png') });
    }
    await page.locator('[data-sync-candidate]').selectOption('ITM-102');
    assert.equal(await page.locator('[data-sync-row="IT-261001-003"] [data-sync-field]:checked').count(), 0);
    await page.locator('[data-sync-all]').check();
    assert.equal(await page.locator('[data-sync-field]:checked').count(), 6);
    await page.locator('[data-sync-action="apply"]').click();
    await page.getByText('2개 이슈 반영 · 0개 확인 필요').waitFor();
    const selections = await page.evaluate(() => calls.find(call => call.action === 'applyJiraSync').data.selections);
    assert.equal(selections.length, 2);
    assert.deepEqual(selections.map(row => row.id), ['IT-261001-001', 'IT-261001-003']);
    assert.equal(await page.evaluate(() => reloadCount), 1);
    console.log('PASS final apply sends checked fields only and reloads dashboard');

    await page.getByRole('button', { name: '변경안 다시 조회' }).click();
    await page.locator('[data-sync-filter="unlinked"]').click();
    await page.locator('[data-sync-key]').fill('ITM-999');
    await page.locator('[data-sync-key]').press('Enter');
    await page.getByText('직접 조회한 Jira 업무').waitFor();
    assert.equal(await page.locator('[data-sync-field]:checked').count(), 0);
    console.log('PASS manual lookup adds candidate only, without apply');

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.hd-sync-dialog').evaluate(element => element.getBoundingClientRect().width <= 390), true);
    if (process.argv[3]) await page.screenshot({ path: path.join(process.argv[3], 'helpdesk-jira-sync-mobile.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.hd-sync').isHidden(), true);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    assert.deepEqual(errors, []);
    console.log('PASS mobile layout, keyboard close and no JS errors');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
