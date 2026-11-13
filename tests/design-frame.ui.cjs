// v3 디자인 틀 확인: 7개 메뉴를 합성 자료로 열어 위 막대·왼쪽 메뉴·접기·휴대폰 아래 탭·서랍을 검사하고
// 다크·라이트 × 넓은 화면·휴대폰 폭을 캡처합니다. 운영 API·Jira는 호출하지 않습니다(전부 가짜 응답·차단).
// 실행: NODE_PATH=<playwright 위치> node tests/design-frame.ui.cjs [캡처 폴더]
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../docs');
const outDir = process.argv[2] || path.join(process.env.TEMP || '.', 'kic-design');
fs.mkdirSync(outDir, { recursive: true });
const pages = ['index', 'reply', 'jira-timeline', 'notice', 'delay', 'print', 'marketer'];
const issue = (n, title, status, type, date) => ({ id: 'IT-261111-' + String(n).padStart(3, '0'), title, status, type, date, sourceType: 'helpdesk', sourceLabel: '헬프',
  branch: '서울본사', requester: '예시 요청자', dev: n % 2 ? '예시 담당자' : '', details: '합성 테스트 내용', system: 'CMS', priority: '보통', menu: '예시 메뉴', remark: '', actionContent: '', sourceLink: 'https://example.invalid/source', jiraLink: '' });
const items = [issue(9, '예시 접수 건 A', '접수대기', '단순 문의', '2026-11-11 10:20'), issue(8, '예시 접수 건 B', '접수대기', '오류', '2026-11-11 09:40'),
  issue(7, '예시 진행 건', '처리중', '기능 개선', '2026-11-11 09:10'), issue(6, '예시 예정 건', '예정', '오류', '2026-11-10 15:00'),
  issue(5, '예시 완료 건', '완료', '단순 문의', '2026-11-10 11:00'),
  // 이월 보드용: 이번 주 이전 날짜
  { ...issue(4, '예시 이월 접수 건', '접수대기', '데이터 수정', '2026-11-03 10:00'), id: 'IT-261103-004' },
  { ...issue(3, '예시 이월 예정 건', '예정', '기능 개선', '2026-11-03 09:00'), id: 'IT-261103-003' },
  { ...issue(2, '예시 이월 처리중 건', '처리중', '오류', '2026-11-02 14:00'), id: 'IT-261102-002' },
  { ...issue(1, '예시 불가 건', '반려', '기능 개선', '2026-11-02 09:00'), id: 'IT-261102-001' }];
const dashboard = { pendingCurrent: items.filter(x => x.status !== '완료'), completedCurrent: items.filter(x => x.status === '완료'), quarterRequestItems: [], developers: [{ name: '예시 담당자', email: 'dev@example.invalid' }] };

(async () => {
  const server = http.createServer((req, res) => {
    const target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname));
    if (!target.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
    try {
      const type = target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.json') ? 'application/json' : target.endsWith('.png') ? 'image/png' : target.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';
      res.setHeader('Content-Type', type); res.end(fs.readFileSync(target));
    } catch (_) { res.writeHead(404); res.end(); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const allowed = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const report = [], errors = [];
  try {
    for (const theme of ['dark', 'light']) for (const [label, viewport] of [['wide', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      const context = await browser.newContext({ viewport });
      await context.addInitScript(t => { try { localStorage.setItem('kic_theme', t); localStorage.removeItem('kic_lnb_collapsed'); } catch (_) {} }, theme);
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === origin || allowed.includes(url.hostname)) return route.continue();
        if (url.hostname === 'script.google.com') {
          const body = route.request().method() === 'POST' ? JSON.parse(route.request().postData() || '{}') : {};
          const action = body.action || url.searchParams.get('action');
          const data = action === 'getDashboardData' ? dashboard : {};
          return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ success: true, data }) });
        }
        return route.abort();
      });
      for (const name of pages) {
        const page = await context.newPage();
        page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
        await page.goto(`${origin}/${name}.html`, { waitUntil: 'load' });
        await page.waitForTimeout(name === 'index' ? 1800 : 900);
        const frame = await page.evaluate(() => {
          const box = s => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display }; };
          return { top: box('.kic-top'), side: box('.kic-lnb'), tab: box('.kic-tabbar'), main: box('.kic-tool-offset'), padLeft: getComputedStyle(document.querySelector('.kic-tool-offset')).paddingLeft,
            tops: document.querySelectorAll('.kic-top').length, tabs: document.querySelectorAll('.kic-tabbar .kic-tab').length, active: document.querySelector('.kic-lnb-link.kic-active')?.dataset.title || '',
            dark: document.documentElement.classList.contains('dark'), scroll: document.documentElement.scrollWidth, bodyBg: getComputedStyle(document.body).backgroundColor };
        });
        assert.equal(frame.tops, 1, name + ' 위 막대 1개');
        assert.equal(frame.top.h, 56, name + ' 위 막대 56px');
        assert.equal(frame.top.w, viewport.width, name + ' 위 막대 전체 폭');
        assert.equal(frame.dark, theme === 'dark', name + ' 테마');
        assert.ok(frame.active, name + ' 현재 메뉴 표시');
        if (label === 'wide') {
          assert.equal(frame.side.w, 232, name + ' 메뉴 232px'); assert.equal(frame.side.y, 56); assert.equal(frame.padLeft, '232px'); assert.equal(frame.tab.display, 'none');
          await page.screenshot({ path: path.join(outDir, `${name}-${theme}-wide.png`) });
          await page.locator('.kic-burger').click(); await page.waitForTimeout(300);
          const mini = await page.evaluate(() => ({ w: Math.round(document.querySelector('.kic-lnb').getBoundingClientRect().width), pad: getComputedStyle(document.querySelector('.kic-tool-offset')).paddingLeft, saved: localStorage.getItem('kic_lnb_collapsed') }));
          assert.deepEqual(mini, { w: 72, pad: '72px', saved: 'true' }, name + ' 접기');
          if (name === 'index') await page.screenshot({ path: path.join(outDir, `${name}-${theme}-wide-collapsed.png`) });
          await page.locator('.kic-burger').click(); await page.waitForTimeout(250);
        } else {
          assert.equal(frame.tab.display, 'grid', name + ' 아래 탭'); assert.equal(frame.tabs, 4); assert.ok(frame.side.x + frame.side.w <= 0, name + ' 서랍 닫힘');
          assert.equal(frame.padLeft, '0px');
          await page.screenshot({ path: path.join(outDir, `${name}-${theme}-phone.png`) });
          await page.locator('.kic-tabbar button.kic-tab').click(); await page.waitForTimeout(350);
          const open = await page.evaluate(() => Math.round(document.querySelector('.kic-lnb').getBoundingClientRect().x));
          assert.equal(open, 0, name + ' 서랍 열림');
          if (name === 'index') await page.screenshot({ path: path.join(outDir, `${name}-${theme}-phone-drawer.png`) });
          await page.locator('.kic-lnb-backdrop').click({ position: { x: 370, y: 400 } }); await page.waitForTimeout(300);
          assert.ok(await page.evaluate(() => !document.body.classList.contains('kic-lnb-open')), name + ' 서랍 닫기');
        }
        report.push(`${theme}/${label} ${name}: scrollWidth=${frame.scroll} bodyBg=${frame.bodyBg}`);
        await page.close();
      }
      await context.close();
    }
    // 좁은 휴대폰(360px): 위 막대 검색칸이 자기 자리 밖으로 넘쳐 로고·상태 표시를 덮지 않고, 아래 탭은 60px (v3.0.3)
    {
      const context = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === origin || allowed.includes(url.hostname)) return route.continue();
        if (url.hostname === 'script.google.com') return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ success: true, data: dashboard }) });
        return route.abort();
      });
      const page = await context.newPage();
      await page.goto(`${origin}/index.html`); await page.waitForTimeout(1500);
      const bar = await page.evaluate(() => {
        const r = s => document.querySelector(s).getBoundingClientRect();
        return { logo: r('.kic-brand-mark').right, slotL: r('#kic-top-center').left, slotR: r('#kic-top-center').right, searchL: r('#hd-search').left, searchR: r('#hd-search').right,
          status: r('#kic-top-right').left, inSlot: !!document.querySelector('#kic-top-center #hd-search'), tabH: r('.kic-tabbar').height };
      });
      assert.ok(bar.inSlot, '검색칸이 위 막대 가운데로 옮겨짐');
      assert.ok(bar.searchL >= bar.slotL && bar.searchR <= bar.slotR, `검색칸이 자리 안에 있음 ${JSON.stringify(bar)}`);
      assert.ok(bar.searchL > bar.logo && bar.searchR < bar.status, `검색칸이 로고·상태 표시와 겹치지 않음 ${JSON.stringify(bar)}`);
      assert.equal(bar.tabH, 60, '아래 탭 60px');
      await page.screenshot({ path: path.join(outDir, 'index-phone-360.png') });
      await context.close();
    }
    // 헬프데스크 안쪽: 탭 · 창 캡처 (다크·라이트 넓은 화면). 저장 버튼은 누르지 않는다.
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await context.addInitScript(t => { try { localStorage.setItem('kic_theme', t); } catch (_) {} }, theme);
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === origin || allowed.includes(url.hostname)) return route.continue();
        if (url.hostname === 'script.google.com') return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ success: true, data: dashboard }) });
        return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(`index(${theme}) parts: ${e.message}`));
      await page.goto(`${origin}/index.html`); await page.waitForTimeout(1800);
      const shot = name => page.screenshot({ path: path.join(outDir, `index-${theme}-${name}.png`) });
      await page.evaluate(() => { toggleSection('done-current-container', 'btn-toggle-done'); toggleSection('pending-past-container', 'btn-toggle-past'); });
      await page.evaluate(() => window.scrollTo(0, 700)); await page.waitForTimeout(200); await shot('sections');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => switchTab('stats')); await page.waitForTimeout(600); await shot('tab-stats');
      await page.evaluate(() => switchTab('ai')); await page.waitForTimeout(200); await shot('tab-ai');
      await page.evaluate(() => switchTab('pending'));
      for (const [name, open, close] of [['add', 'openAddModal()', 'closeAddModal()'], ['edit', "openEditById('IT-261111-007')", 'closeEditModal()'], ['settings', 'openSettingsModal()', 'closeSettingsModal()']]) {
        await page.evaluate(open); await page.waitForTimeout(450); await shot('modal-' + name);
        await page.evaluate(close); await page.waitForTimeout(450);
      }
      await page.getByRole('button', { name: '목록 캡처 누락 점검', exact: true }).click(); await page.waitForTimeout(300); await shot('dialog-missing');
      await page.keyboard.press('Escape');
      await page.evaluate(() => showToast('저장 완료: IT-261111-010')); await page.waitForTimeout(100); await shot('toast');
      await context.close();
    }
    console.log(report.join('\n'));
    if (errors.length) console.log('PAGE ERRORS\n' + errors.join('\n'));
    console.log('PASS 위 막대 56px·메뉴 232/72px·접기 기억·휴대폰 아래 탭 4개·서랍 열고 닫기 (7개 메뉴 × 다크/라이트 × 넓은/휴대폰). 캡처: ' + outDir);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
