// 합성 데이터로 실제 모달 JS/CSS를 검증합니다. 운영 API에는 연결하지 않습니다.
// node tests/helpdesk-jira-sync.ui.cjs <playwright 모듈 경로> [스크린샷 디렉터리]
// node tests/helpdesk-jira-sync.ui.cjs <playwright 모듈 경로> --preview: 예시 데이터 확인용 로컬 서버
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { chromium } = require(process.argv[2] || 'playwright');
const previewOnly = process.argv.includes('--preview');
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
  { id: 'IT-261001-004', title: '<img src=x onerror="alert(1)"> 악성 제목도 텍스트로만 표시', status: '완료', sourceLink: 'javascript:alert(1)', jiraLink: origin + 'ITM-104?atlOrigin=tracking', candidates: [candidate('ITM-104', [{ field: 'jiraLink', label: 'Jira 링크', from: origin + 'ITM-104?atlOrigin=tracking', to: origin + 'ITM-104' }])] },
  { id: 'IT-261001-005', title: '연결과 상태가 같은 업무', status: '완료', jiraLink: origin + 'ITM-105', candidates: [candidate('ITM-105', [])] }
];
const fixture = { token: '00000000-0000-0000-0000-000000000001', expiresAt: Date.now() + 600000, rows, warnings: [], exclusionSupported: true };
const excluded = new Set(); // 브라우저가 아닌 모의 서버에 저장해 여러 사용자/재접속을 검증합니다.
const issueDetails = Object.fromEntries(rows.map(row => [row.id, { ...row, sourceType: 'helpdesk', date: '2026-10-01 09:00', branch: '서울본사',
  requester: '테스트 요청자', menu: '테스트 메뉴', dev: '기존 담당자', details: '원본 상세 내용 보존', actionContent: '원본 처리 내용 보존', remark: '원본 비고 보존', jiraLinkedFlag: '' }]));
let supportsExclusion = true;
const mainSource = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
const editorStart = mainSource.indexOf('  <div id="editModal"');
const editorMarkup = mainSource.slice(editorStart, mainSource.indexOf('\n  <script>', editorStart));
const editorFunctions = mainSource.slice(mainSource.indexOf('    let helpdeskEditContext'), mainSource.indexOf('    // [v16.11] 현황 업데이트'))
  + mainSource.slice(mainSource.indexOf('    function submitEditForm()'), mainSource.indexOf('    // [v16.10.1]'))
  + mainSource.slice(mainSource.indexOf('    function closeAllActiveModals()'), mainSource.indexOf('  </script>', mainSource.indexOf('    function closeAllActiveModals()')));
const commonSource = fs.readFileSync(path.join(root, 'docs/js/kic-common.js'), 'utf8');
const commonModal = commonSource.slice(commonSource.indexOf('const KicModal ='), commonSource.indexOf('// 5. 공통 사이드바'));
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/css/helpdesk-jira-sync.css"><style>body {font-family:Arial,sans-serif;background:#212121;} * {box-sizing:border-box;} button,input,select {font:inherit;}
    .hidden {display:none!important;} #editModal {position:fixed;inset:0;z-index:100;background:#0009;display:flex;align-items:center;justify-content:center;padding:16px;}
    #editModalContent {background:#fff;color:#0f172a;border-radius:16px;width:500px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;}
    #editModalContent>div {padding:16px;} #editModalContent>div:nth-child(2) {overflow:auto;min-height:0;} #editModalContent input:not([type=hidden]),#editModalContent textarea {max-width:100%;}
    .fas {font-style:normal;display:inline-block;} .fa-times:before {content:'×';} .fa-sync-alt:before {content:'⟳';}
    .fa-external-link-alt:before {content:'↗';} .fa-undo:before {content:'↶';} .fa-ban:before {content:'⊘';}
    .fa-pen:before {content:'✎';}
    .fa-redo-alt:before {content:'↻';} .fa-check-circle:before {content:'✓';} .fa-exclamation-circle:before {content:'!';} .fa-spinner:before {content:'⌛';}</style>
  <button onclick="openHelpdeskJiraSync()" title="Jira 싱크 확인">싱크</button><script>
  window.calls=[]; window.reloadCount=0;window.allIssuesMap={};window.toasts=[];window.localUpdates=[];
  window.callGASApi=async function(action,data) {window.calls.push({action,data});
    if(action==='setJiraSyncExcluded' && window.failExclusion) throw Error('테스트 저장 실패');
    if(action==='setJiraSyncExcluded' && window.holdExclusion) await new Promise(resolve=>window.releaseExclusion=resolve);
    if(action==='previewJiraSync' && window.holdPreview) await new Promise(resolve=>window.releasePreview=resolve);
    if(action==='previewJiraSync' && window.failPreview) throw Error('테스트 조회 실패');
    if(action==='getDashboardData' && window.failDashboard) throw Error('테스트 상세 조회 실패');
    if(action==='updateIssue' && window.holdUpdate) await new Promise(resolve=>window.releaseUpdate=resolve);
    if(action==='updateIssue' && window.failUpdate) throw Error('테스트 이슈 저장 실패');
    const response=await fetch('/api',{method:'POST',body:JSON.stringify({action,data})});
    const result=await response.json();if(!result.success) throw Error(result.error);return result.data;};
  window.loadData=function(){window.reloadCount++;};
  window.runServerFunction=(name,data)=>window.callGASApi('updateIssue',data);
  window.showToast=(message,type)=>window.toasts.push({message,type});
  window.applyLocalIssueUpdate=item=>{window.allIssuesMap[item.id]=item;window.localUpdates.push(item);};
  window.escapeHtml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  window.isJiraLinked=item=>item.jiraLinkedFlag==='Y';window.resetEditAiReply=()=>{};
  window.getLocalDateString=()=> '2026-10-01';window.closeAddModal=()=>{};window.closeSettingsModal=()=>{};
  window.setButtonSaving=(button,saving)=>{if(button)button.disabled=saving;};
  </script>${editorMarkup}<script>${editorFunctions}${commonModal}KicModal.init();</script><script src="/js/helpdesk-jira-sync.js"></script></html>`;

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url === '/api') {
      let body = ''; req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const { action, data } = JSON.parse(body);
        let result;
        if (action === 'previewJiraSync') result = { ...fixture, exclusionSupported: supportsExclusion,
          rows: rows.map(row => ({ ...row, excluded: excluded.has(row.id) })) };
        else if (action === 'getDashboardData') result = { pendingCurrent: Object.values(issueDetails).filter(row => row.status !== '완료'),
          completedCurrent: Object.values(issueDetails).filter(row => row.status === '완료'), developers: ['테스트 담당자'] };
        else if (action === 'updateIssue') {
          Object.assign(issueDetails[data.id], data);
          const row = rows.find(row => row.id === data.id);
          Object.assign(row, { title: data.title, status: data.status, sourceLink: data.sourceLink, jiraLink: data.jiraLink });
          row.candidates = row.candidates.map(issue => ({ ...issue, changes: issue.changes.map(change => ({ ...change,
            from: change.field === 'status' ? data.status : change.field === 'jiraLink' ? data.jiraLink || '미등록' : change.from })).filter(change => change.from !== change.to) }));
          result = { id: data.id };
        }
        else if (action === 'setJiraSyncExcluded') {
          if (data.excluded) excluded.add(data.id); else excluded.delete(data.id);
          result = { id: data.id, excluded: data.excluded };
        } else if (action === 'lookupJiraSync') {
          result = { ...rows.find(row => row.id === data.id), excluded: excluded.has(data.id), candidates: [
            { key: data.issueKey, title: '직접 조회한 Jira 업무', status: '진행 중', url: origin + data.issueKey,
              changes: [{ field: 'jiraLink', label: 'Jira 링크', from: '미등록', to: origin + data.issueKey }] }
          ] };
        } else if (action === 'applyJiraSync') result = { applied: data.selections.filter(row => !excluded.has(row.id)), skipped: [] };
        else { res.writeHead(400); res.end(JSON.stringify({ success: false, error: 'Unexpected action' })); return; }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, data: result }));
      }); return;
    }
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html;charset=utf-8');
      res.end(previewOnly ? html.replace('</html>', '<script>document.documentElement.classList.add("dark");openHelpdeskJiraSync();</script></html>') : html); return;
    }
    const files = { '/js/helpdesk-jira-sync.js': 'docs/js/helpdesk-jira-sync.js', '/css/helpdesk-jira-sync.css': 'docs/css/helpdesk-jira-sync.css' };
    const file = files[req.url];
    if (!file) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css;charset=utf-8' : 'text/javascript;charset=utf-8');
    res.end(fs.readFileSync(path.join(root, file)));
  });
  if (previewOnly) fixture.warnings = ['로컬 동작 확인용 예시 데이터입니다. 제외·적용 버튼을 눌러도 실제 헬프데스크나 Jira는 변경되지 않습니다.'];
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(previewOnly ? 8767 : 0, '127.0.0.1', resolve);
  });
  if (previewOnly) { console.log('Local synthetic preview: http://127.0.0.1:' + server.address().port + '/'); return; }
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.getByTitle('Jira 싱크 확인').click();
    await page.locator('[data-sync-row]').first().waitFor();
    assert.equal(await page.locator('[data-sync-row]').count(), 2);
    assert.equal(await page.locator('[data-sync-field]:checked').count(), 0);
    assert.equal(await page.locator('[data-sync-action="apply"]').isDisabled(), true);
    assert.equal(await page.evaluate(() => calls.some(call => call.action === 'applyJiraSync')), false);
    console.log('PASS open preview does not apply; changes default unchecked');
    const source = page.getByRole('link', { name: 'IT-261001-001 원문 보기' });
    assert.equal(await source.getAttribute('href'), 'https://example.test/board?post=123&section=it');
    assert.equal(await source.getAttribute('target'), '_blank');
    assert.equal(await source.getAttribute('rel'), 'noopener noreferrer');
    console.log('PASS source link next to issue number opens original URL in new tab');
    const bounds = () => page.locator('.hd-sync-dialog').evaluate(element => {
      const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height };
    });
    const assertStateCentered = async () => {
      const position = await page.locator('.hd-sync-state-content').evaluate(content => {
        const state = content.parentElement, body = state.parentElement;
        const bodyRect = body.getBoundingClientRect(), stateRect = state.getBoundingClientRect(), contentRect = content.getBoundingClientRect();
        const bodyStyle = getComputedStyle(body), previous = state.previousElementSibling, next = state.nextElementSibling;
        const top = previous ? previous.getBoundingClientRect().bottom + parseFloat(getComputedStyle(previous).marginBottom) : bodyRect.top + parseFloat(bodyStyle.paddingTop);
        const bottom = next ? next.getBoundingClientRect().top - parseFloat(getComputedStyle(next).marginTop) : bodyRect.bottom - parseFloat(bodyStyle.paddingBottom);
        return { horizontalOffset: (contentRect.left + contentRect.right - stateRect.left - stateRect.right) / 2,
          verticalOffset: (contentRect.top + contentRect.bottom - top - bottom) / 2 };
      });
      assert.ok(Math.abs(position.horizontalOffset) <= 1, JSON.stringify(position));
      assert.ok(Math.abs(position.verticalOffset) <= 1, JSON.stringify(position));
    };
    const fullBounds = await bounds();
    for (const filter of ['all', 'changes', 'unlinked', 'review', 'matched']) {
      await page.locator(`[data-sync-filter="${filter}"]`).click();
      assert.deepEqual(await bounds(), fullBounds);
    }
    await page.locator('[data-sync-filter="changes"]').click();
    console.log('PASS fixed dialog bounds across all tabs, regardless of list length');

    await page.locator('[data-sync-field="status"]').check();
    assert.equal(await page.locator('[data-sync-row="IT-261001-001"] [data-sync-field="jiraLink"]').isChecked(), true);
    assert.equal(await page.locator('[data-sync-field="jiraLinked"]').isChecked(), false);
    await page.locator('[data-sync-row="IT-261001-001"] [data-sync-field="jiraLink"]').uncheck();
    assert.equal(await page.locator('[data-sync-field]:checked').count(), 0);
    console.log('PASS new link dependency; deselect link clears dependent changes');

    await page.locator('[data-sync-filter="all"]').click();
    assert.equal(await page.locator('[data-sync-row]').count(), 5);
    assert.equal(await page.locator('.hd-sync img').count(), 0);
    assert.equal(await page.locator('[data-sync-row="IT-261001-004"] .hd-sync-source').count(), 0);
    assert.equal(await page.locator('[data-sync-row="IT-261001-002"] .hd-sync-source').count(), 0);
    assert.equal(await page.locator('[data-sync-candidate]').inputValue(), '');
    console.log('PASS all rows, escaped content, ambiguous candidates have blank initial value');
    await page.locator('[data-sync-filter="matched"]').click();
    assert.equal(await page.locator('[data-sync-row]').count(), 1);
    assert.equal(await page.locator('[data-sync-row="IT-261001-005"]').isVisible(), true);
    assert.equal(await page.locator('[data-sync-action="apply"]').isDisabled(), true);
    await page.locator('[data-sync-filter="all"]').click();
    await page.locator('[data-sync-filter="changes"]').click();
    assert.equal(await page.locator('[data-sync-row="IT-261001-004"] [data-sync-field="jiraLink"]').isVisible(), true);
    console.log('PASS tracking-only URL cleanup is recommended again and remains unchecked');

    await page.locator('[data-sync-row="IT-261001-001"] [data-sync-field="status"]').check();
    await page.getByRole('button', { name: 'IT-261001-001 싱크 제외', exact: true }).click();
    await page.locator('[data-sync-row="IT-261001-001"]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-sync-action="apply"]').isDisabled(), true);
    assert.equal(await page.locator('[data-sync-filter="changes"] span').textContent(), '1');
    await page.locator('[data-sync-filter="unlinked"]').click();
    await page.getByRole('button', { name: 'IT-261001-002 싱크 제외', exact: true }).click();
    await page.getByText('해당하는 이슈가 없습니다.').waitFor();
    assert.deepEqual(await bounds(), fullBounds);
    await assertStateCentered();
    if (process.argv[3]) await page.screenshot({ path: path.join(process.argv[3], 'helpdesk-jira-sync-empty-centered.png') });
    assert.equal(await page.locator('[data-sync-filter="unlinked"] span').textContent(), '0');
    assert.equal(await page.locator('[data-sync-filter="all"] span').textContent(), '5');
    await page.locator('[data-sync-filter="all"]').click();
    assert.equal(await page.locator('.hd-sync-excluded-badge').count(), 2);
    assert.equal(await page.locator('[data-sync-row="IT-261001-001"] [data-sync-field="status"]').isDisabled(), true);
    assert.equal(await page.locator('[data-sync-row="IT-261001-001"] [data-sync-field]:checked').count(), 0);
    assert.equal(await page.locator('[data-sync-row="IT-261001-002"] .hd-sync-lookup').count(), 0);
    await page.locator('[data-sync-all]').check();
    assert.equal(await page.locator('[data-sync-field]:checked').count(), 1);
    assert.equal(await page.locator('[data-sync-row="IT-261001-001"] [data-sync-field]:checked').count(), 0);
    await page.locator('[data-sync-all]').uncheck();
    console.log('PASS exclusions disappear from active tabs/counts, remain in all, and cannot be selected');

    const teammate = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await teammate.goto('http://127.0.0.1:' + server.address().port);
    await teammate.getByTitle('Jira 싱크 확인').click();
    await teammate.locator('[data-sync-row]').first().waitFor();
    assert.equal(await teammate.locator('[data-sync-row="IT-261001-001"]').count(), 0);
    await teammate.locator('[data-sync-filter="all"]').click();
    assert.equal(await teammate.locator('.hd-sync-excluded-badge').count(), 2);
    await teammate.close();
    await page.reload();
    await page.getByTitle('Jira 싱크 확인').click(); await page.locator('[data-sync-row]').first().waitFor();
    await page.locator('[data-sync-filter="all"]').click();
    assert.equal(await page.locator('.hd-sync-excluded-badge').count(), 2);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    console.log('PASS server-owned exclusions persist across reloads and different browser sessions');
    if (process.argv[3]) {
      await page.screenshot({ path: path.join(process.argv[3], 'helpdesk-jira-sync-light.png') });
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await page.screenshot({ path: path.join(process.argv[3], 'helpdesk-jira-sync-dark.png') });
    }
    await page.getByRole('button', { name: 'IT-261001-001 싱크 제외 해제', exact: true }).click();
    await page.locator('[data-sync-row="IT-261001-001"] .hd-sync-excluded-badge').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'IT-261001-002 싱크 제외 해제', exact: true }).click();
    await page.locator('[data-sync-row="IT-261001-002"] .hd-sync-excluded-badge').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-sync-filter="changes"] span').textContent(), '2');
    assert.equal(await page.locator('[data-sync-filter="unlinked"] span').textContent(), '1');
    assert.equal(await page.locator('[data-sync-field]:checked').count(), 0);
    console.log('PASS restore from all brings back normal categories without restoring checked fields');

    await page.evaluate(() => { window.holdExclusion = true; });
    await page.getByRole('button', { name: 'IT-261001-002 싱크 제외', exact: true }).click();
    await page.getByText('팀 공통 싱크 제외 설정을 저장하고 있습니다…').waitFor();
    assert.equal(await page.locator('[data-sync-action="apply"]').isDisabled(), true);
    assert.equal(await page.locator('[data-sync-action="refresh"]').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.hd-sync').isVisible(), true);
    await page.evaluate(() => { window.holdExclusion = false; window.releaseExclusion(); });
    await page.locator('[data-sync-row="IT-261001-002"] .hd-sync-excluded-badge').waitFor();
    await page.getByRole('button', { name: 'IT-261001-002 싱크 제외 해제', exact: true }).click();
    await page.locator('[data-sync-row="IT-261001-002"] .hd-sync-excluded-badge').waitFor({ state: 'detached' });
    await page.locator('[data-sync-row="IT-261001-001"] [data-sync-field="status"]').check();
    await page.evaluate(() => { window.failExclusion = true; });
    await page.getByRole('button', { name: 'IT-261001-001 싱크 제외', exact: true }).click();
    await page.getByText(/테스트 저장 실패/).waitFor();
    assert.equal(await page.locator('[data-sync-row="IT-261001-001"] .hd-sync-excluded-badge').count(), 0);
    assert.equal(await page.locator('[data-sync-field]:checked').count(), 0);
    await page.evaluate(() => { window.failExclusion = false; });
    await page.locator('[data-sync-action="refresh"]').click(); await page.locator('[data-sync-row]').first().waitFor();
    await page.locator('[data-sync-filter="all"]').click();
    assert.equal(await page.locator('.hd-sync-excluded-badge').count(), 0);
    console.log('PASS exclusion saves block conflicting actions; failed saves do not falsely mark exclusions');

    supportsExclusion = false;
    await page.locator('[data-sync-action="refresh"]').click(); await page.locator('[data-sync-row]').first().waitFor();
    await page.getByText('팀 공통 싱크 제외 기능은 업무 API 재배포 후 사용할 수 있습니다.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'IT-261001-001 싱크 제외', exact: true }).isDisabled(), true);
    supportsExclusion = true;
    await page.locator('[data-sync-action="refresh"]').click(); await page.locator('[data-sync-row]').first().waitFor();
    await page.locator('[data-sync-filter="all"]').click();
    console.log('PASS old deployed API is detected instead of sending an unsupported exclusion action');

    await page.evaluate(() => { window.holdPreview = true; });
    await page.locator('[data-sync-action="refresh"]').click();
    assert.deepEqual(await bounds(), fullBounds);
    await assertStateCentered();
    await page.evaluate(() => { window.holdPreview = false; window.releasePreview(); });
    await page.locator('[data-sync-row]').first().waitFor();
    await page.evaluate(() => { window.failPreview = true; });
    await page.locator('[data-sync-action="refresh"]').click();
    await page.getByText('테스트 조회 실패').waitFor();
    assert.deepEqual(await bounds(), fullBounds);
    await assertStateCentered();
    await page.evaluate(() => { window.failPreview = false; });
    await page.getByRole('button', { name: '다시 조회', exact: true }).click(); await page.locator('[data-sync-row]').first().waitFor();
    await page.locator('[data-sync-filter="all"]').click();
    console.log('PASS fixed dialog size also holds during loading and error states');
    await page.locator('[data-sync-candidate]').selectOption('ITM-102');
    assert.equal(await page.locator('[data-sync-row="IT-261001-003"] [data-sync-field]:checked').count(), 0);
    await page.locator('[data-sync-all]').check();
    assert.equal(await page.locator('[data-sync-field]:checked').count(), 7);
    await page.locator('[data-sync-action="apply"]').click();
    await page.getByText('3개 이슈 반영 · 0개 확인 필요').waitFor();
    await assertStateCentered();
    const selections = await page.evaluate(() => calls.find(call => call.action === 'applyJiraSync').data.selections);
    assert.equal(selections.length, 3);
    assert.deepEqual(selections.map(row => row.id), ['IT-261001-001', 'IT-261001-003', 'IT-261001-004']);
    assert.deepEqual(await bounds(), fullBounds);
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
    const mobileBounds = await bounds();
    for (const filter of ['matched', 'review', 'unlinked', 'all']) {
      await page.locator(`[data-sync-filter="${filter}"]`).click();
      assert.deepEqual(await bounds(), mobileBounds);
      if (filter === 'unlinked') await assertStateCentered();
    }
    if (process.argv[3]) await page.screenshot({ path: path.join(process.argv[3], 'helpdesk-jira-sync-mobile.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.hd-sync').isHidden(), true);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    assert.deepEqual(errors, []);
    console.log('PASS mobile layout, keyboard close and no JS errors');

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByTitle('Jira 싱크 확인').click(); await page.locator('[data-sync-row]').first().waitFor();
    await page.locator('[data-sync-filter="all"]').click();
    assert.deepEqual(await page.locator('[data-sync-row="IT-261001-001"] .hd-sync-issue-heading').evaluate(element => [...element.children].map(child => child.tagName)), ['SPAN', 'BUTTON', 'A']);
    assert.equal(await page.locator('[data-sync-row="IT-261001-001"] .hd-sync-edit .fa-pen').count(), 1);
    if (process.argv[3]) await page.screenshot({ path: path.join(process.argv[3], 'helpdesk-jira-sync-edit-icons.png') });
    await page.locator('[data-sync-row="IT-261001-001"] [data-sync-field="status"]').check();
    await page.locator('[data-sync-row="IT-261001-004"] [data-sync-field="jiraLink"]').check();
    const scrollBeforeEdit = await page.locator('.hd-sync-body').evaluate(element => { element.scrollTop = 150; return element.scrollTop; });
    const previewCallsBeforeEdit = await page.evaluate(() => calls.filter(call => call.action === 'previewJiraSync').length);
    const editFirst = page.getByRole('button', { name: 'IT-261001-001 이슈 수정', exact: true });
    await editFirst.evaluate(button => button.click());
    await page.locator('#editModal:not(.hidden)').waitFor();
    assert.equal(await page.locator('.hd-sync').isHidden(), true);
    assert.equal(await page.locator('#edit-id').inputValue(), 'IT-261001-001');
    assert.equal(await page.locator('#edit-details').inputValue(), '원본 상세 내용 보존');
    assert.equal(await page.locator('#edit-action').inputValue(), '원본 처리 내용 보존');
    assert.equal(await page.locator('#edit-remark').inputValue(), '원본 비고 보존');
    assert.equal(await page.locator('#edit-dev').inputValue(), '기존 담당자');
    const fullRead = await page.evaluate(() => calls.find(call => call.action === 'getDashboardData').data);
    assert.deepEqual(fullRead, { startDate: '', endDate: '' });
    if (process.argv[3]) await page.screenshot({ path: path.join(process.argv[3], 'helpdesk-jira-sync-editor.png') });
    await page.locator('#editModal button').first().focus(); await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '저장하기');
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await page.locator('.hd-sync').waitFor();
    assert.equal(await page.locator('#editModal').isHidden(), true);
    assert.equal(await page.locator('[data-sync-filter="all"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.hd-sync-body').evaluate(element => element.scrollTop), scrollBeforeEdit);
    assert.equal(await page.locator('[data-sync-field]:checked').count(), 3);
    assert.equal(await page.evaluate(() => calls.filter(call => call.action === 'previewJiraSync').length), previewCallsBeforeEdit);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.syncAction), 'edit');
    console.log('PASS pen opens the real existing editor only; full detail load and cancel preserve tab, scroll, checks and focus');

    await editFirst.evaluate(button => button.click()); await page.locator('#editModal:not(.hidden)').waitFor();
    await page.keyboard.press('Escape'); await page.locator('.hd-sync').waitFor();
    assert.equal(await page.locator('[data-sync-field]:checked').count(), 3);
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
    console.log('PASS editor Escape returns to sync without closing sync or losing body scroll lock');

    await editFirst.evaluate(button => button.click()); await page.locator('#editModal:not(.hidden)').waitFor();
    await page.locator('#edit-title').fill('수정된 모니터 요청');
    await page.locator('#edit-status').selectOption('검토중');
    await page.evaluate(() => { window.holdUpdate = true; window.holdPreview = true; });
    await page.getByRole('button', { name: '저장하기', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '저장하기', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#editModal').isVisible(), true);
    assert.equal(await page.locator('.hd-sync').isHidden(), true);
    await page.evaluate(() => { window.holdUpdate = false; window.releaseUpdate(); });
    await page.locator('.hd-sync').waitFor();
    await page.locator('.hd-sync-body [role="status"]').waitFor();
    assert.equal(await page.locator('#editModal').isHidden(), true);
    assert.equal(await page.locator('[data-sync-action="apply"]').isDisabled(), true);
    await page.evaluate(() => { window.holdPreview = false; window.releasePreview(); });
    await page.locator('[data-sync-row]').first().waitFor();
    assert.equal(await page.locator('[data-sync-filter="all"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-sync-row="IT-261001-001"] [data-sync-field]:checked').count(), 0);
    assert.equal(await page.locator('[data-sync-row="IT-261001-004"] [data-sync-field="jiraLink"]').isChecked(), true);
    await page.locator('[data-sync-row="IT-261001-001"] .hd-sync-title').getByText('수정된 모니터 요청', { exact: true }).waitFor();
    const editorSave = await page.evaluate(() => calls.find(call => call.action === 'updateIssue').data);
    assert.equal(editorSave.details, '원본 상세 내용 보존'); assert.equal(editorSave.actionContent, '원본 처리 내용 보존');
    assert.equal(editorSave.remark, '원본 비고 보존'); assert.equal(editorSave.dev, '기존 담당자');
    assert.equal(editorSave.sourceLink, 'https://example.test/board?post=123&section=it'); assert.equal(editorSave.status, '검토중');
    console.log('PASS edit save waits for success, preserves original fields, rechecks sync, clears edited checks and keeps unchanged checks');

    await editFirst.evaluate(button => button.click()); await page.locator('#editModal:not(.hidden)').waitFor();
    await page.locator('#edit-title').fill('실패해도 남아 있어야 할 입력');
    await page.evaluate(() => { window.failUpdate = true; });
    await page.getByRole('button', { name: '저장하기', exact: true }).click();
    await page.waitForFunction(() => toasts.some(toast => toast.message.includes('테스트 이슈 저장 실패')));
    assert.equal(await page.locator('#editModal').isVisible(), true);
    assert.equal(await page.locator('#edit-title').inputValue(), '실패해도 남아 있어야 할 입력');
    assert.equal(await page.getByRole('button', { name: '저장하기', exact: true }).isDisabled(), false);
    await page.evaluate(() => { window.failUpdate = false; });
    await page.getByRole('button', { name: '취소', exact: true }).click(); await page.locator('.hd-sync').waitFor();
    console.log('PASS failed edit save keeps the editor and draft open for retry or cancel');

    await page.evaluate(() => { window.failDashboard = true; });
    await page.getByRole('button', { name: 'IT-261001-004 이슈 수정', exact: true }).evaluate(button => button.click());
    await page.getByText('테스트 상세 조회 실패', { exact: true }).waitFor();
    assert.equal(await page.locator('#editModal').isHidden(), true);
    assert.equal(await page.locator('.hd-sync').isVisible(), true);
    assert.equal(await page.locator('[data-sync-row="IT-261001-004"] [data-sync-field="jiraLink"]').isChecked(), true);
    await page.evaluate(() => { window.failDashboard = false; });
    await page.getByRole('button', { name: 'IT-261001-004 이슈 수정', exact: true }).evaluate(button => button.click());
    await page.locator('#editModal:not(.hidden)').waitFor();
    assert.equal(await page.locator('#edit-id').inputValue(), 'IT-261001-004');
    assert.equal(await page.locator('#edit-action').inputValue(), '원본 처리 내용 보존');
    await page.locator('#editModal').evaluate(element => element.click()); await page.locator('.hd-sync').waitFor();
    console.log('PASS out-of-period completed rows load full records; failed detail reads never open an empty editor; backdrop returns to sync');

    await page.getByRole('button', { name: 'IT-261001-002 싱크 제외', exact: true }).click();
    await page.locator('[data-sync-row="IT-261001-002"] .hd-sync-excluded-badge').waitFor();
    await page.getByRole('button', { name: 'IT-261001-002 이슈 수정', exact: true }).evaluate(button => button.click());
    await page.locator('#editModal:not(.hidden)').waitFor();
    await page.getByRole('button', { name: '취소', exact: true }).click(); await page.locator('.hd-sync').waitFor();
    assert.equal(await page.locator('[data-sync-row="IT-261001-002"] .hd-sync-excluded-badge').count(), 1);
    await page.getByRole('button', { name: 'IT-261001-002 싱크 제외 해제', exact: true }).click();
    await page.locator('[data-sync-row="IT-261001-002"] .hd-sync-excluded-badge').waitFor({ state: 'detached' });
    console.log('PASS sync exclusion does not block manual helpdesk editing or change exclusion on cancel');
    await page.keyboard.press('Escape');
    await page.evaluate(() => openEditById('IT-261001-001'));
    await page.locator('#editModal:not(.hidden)').waitFor();
    await page.getByRole('button', { name: '저장하기', exact: true }).click();
    await page.locator('#editModal').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.hd-sync').isHidden(), true);
    assert.deepEqual(errors, []);
    console.log('PASS main-page editing still works independently without reopening sync');
    const requests = [];
    const context = vm.createContext({ console: { warn() {}, error() {} },
      fetch: async (url, options) => { requests.push({ url, options }); throw Error('Test network failure'); } });
    vm.runInContext(fs.readFileSync(path.join(root, 'docs/js/config.js'), 'utf8'), context);
    for (const action of ['previewJiraSync', 'lookupJiraSync', 'applyJiraSync', 'setJiraSyncExcluded']) {
      await assert.rejects(context.callGASApi(action, { id: 'IT-261001-001', excluded: true }), /Test network failure/);
    }
    assert.equal(requests.length, 4); assert.ok(requests.every(request => request.options.method === 'POST'));
    console.log('PASS all sync actions, including exclusion, never retry a failed write with parameterless GET');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
