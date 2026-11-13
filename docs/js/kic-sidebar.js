/**
 * KIC 업무 도구 공통 틀
 * - 위 막대(☰ · 로고 · 가운데/오른쪽 자리) · 왼쪽 메뉴 · 휴대폰 아래 탭을 한 곳에서 그립니다.
 * - data-active-page 속성으로 현재 메뉴를 표시합니다.
 * - 하위 경로 페이지는 data-base-path="../"처럼 기준 경로를 지정할 수 있습니다.
 * - 화면은 #kic-top-center(검색 등) · #kic-top-right(상태 등)에 자기 것을 넣어 씁니다.
 */
(function initKicSidebarModule() {
  'use strict';

  const APP_VERSION = 'v3.1.0';
  const SETTINGS_URL = 'https://script.google.com/u/0/home/projects/1jErMgSPLT27-zC16HWZpaxDa2CIfd69qEOkjujlvVylKa4TusD8sOu8O/edit';
  const MENU_ITEMS = [
    { id: 'helpdesk', title: 'IT 헬프데스크', short: '헬프데스크', icon: 'fa-headset', href: 'index.html', tab: true },
    { id: 'reply', title: 'IT 헬프데스크 답변', short: '답변', icon: 'fa-comment-dots', href: 'reply.html', tab: true },
    { id: 'jira-timeline', title: 'IT전략실 통합 일정', short: '통합 일정', icon: 'fa-calendar-days', href: 'jira-timeline.html', tab: true },
    { id: 'notice', title: '공지사항 생성', icon: 'fa-bullhorn', href: 'notice.html' },
    { id: 'delay', title: '교정 지연 안내', icon: 'fa-hourglass-half', href: 'delay.html' },
    { id: 'print', title: '필증 출력 확인', icon: 'fa-tag', href: 'print.html' },
    { id: 'marketer', title: '블로그 마케터', icon: 'fa-pen-nib', href: 'marketer.html' },
    { id: 'dashboard', title: 'CWIZ 이용 분석', icon: 'fa-chart-column', href: 'dashboard/', target: '_blank' }
  ];

  function escapeAttr(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function resolveHref(basePath, href) {
    if (!basePath || /^(?:[a-z]+:|#)/i.test(href)) return href;
    return basePath.replace(/\/?$/, '/') + href.replace(/^\.\//, '');
  }

  function linkAttrs(item, activePage, basePath) {
    const targetAttrs = item.target ? ` target="${item.target}" rel="noopener noreferrer"` : '';
    const currentAttr = item.id === activePage ? ' aria-current="page"' : '';
    return `href="${resolveHref(basePath, item.href)}"${targetAttrs}${currentAttr}`;
  }

  function renderMenuItem(item, activePage, basePath) {
    const isActive = item.id === activePage;
    return `<a class="kic-lnb-link${isActive ? ' kic-active' : ''}" data-title="${escapeAttr(item.title)}" ${linkAttrs(item, activePage, basePath)}>` +
      `<span class="kic-lnb-ico"><i class="fas ${item.icon}" aria-hidden="true"></i></span>` +
      `<span class="kic-lnb-text">${item.title}</span>` +
      (item.target ? '<span class="kic-lnb-ext" aria-label="새 창">↗</span>' : '') +
      `</a>`;
  }

  function renderTab(item, activePage, basePath) {
    const isActive = item.id === activePage;
    return `<a class="kic-tab${isActive ? ' kic-active' : ''}" ${linkAttrs(item, activePage, basePath)}>` +
      `<i class="fas ${item.icon}" aria-hidden="true"></i><span>${item.short || item.title}</span></a>`;
  }

  function renderTopBar(activePage, basePath) {
    const home = MENU_ITEMS[0];
    const top = document.createElement('header');
    top.className = 'kic-top';
    top.innerHTML = `
      <button class="kic-burger" type="button" onclick="KicLnb.toggle()" title="메뉴 접기/펼치기" aria-label="메뉴 접기/펼치기"><i aria-hidden="true"></i></button>
      <a class="kic-brand" href="${resolveHref(basePath, home.href)}" title="${escapeAttr(home.title)}">
        <img class="kic-brand-mark" src="${resolveHref(basePath, 'favicon.svg')}?v=${APP_VERSION.slice(1)}" alt="" width="26" height="26">
        <span class="kic-brand-name">KIC 업무 도구</span>
        <span class="kic-ver">${APP_VERSION}</span>
      </a>
      <div class="kic-top-center" id="kic-top-center"></div>
      <div class="kic-top-right" id="kic-top-right"></div>`;
    return top;
  }

  function renderTabBar(activePage, basePath) {
    const tabs = MENU_ITEMS.filter(item => item.tab);
    const onTab = tabs.some(item => item.id === activePage);
    const bar = document.createElement('nav');
    bar.className = 'kic-tabbar';
    bar.setAttribute('aria-label', '자주 쓰는 메뉴');
    bar.innerHTML = tabs.map(item => renderTab(item, activePage, basePath)).join('') +
      `<button class="kic-tab${onTab ? '' : ' kic-active'}" type="button" onclick="KicLnb.toggle()" aria-label="전체 메뉴"><i class="fas fa-bars" aria-hidden="true"></i><span>전체 메뉴</span></button>`;
    return bar;
  }

  function render(sidebar) {
    if (!sidebar) return;

    const activePage = sidebar.dataset.activePage || '';
    const basePath = sidebar.dataset.basePath || '';
    sidebar.classList.add('kic-lnb');
    sidebar.innerHTML = `
      <nav class="kic-lnb-nav" aria-label="KIC 업무 도구 메뉴">
        ${MENU_ITEMS.map(item => renderMenuItem(item, activePage, basePath)).join('')}
      </nav>
      <div class="kic-lnb-bottom">
        <button class="kic-lnb-link kic-theme-switch" type="button" onclick="KicTheme.toggle()" title="테마 전환" data-title="테마 전환">
          <span class="kic-lnb-ico"><i class="fas fa-circle-half-stroke" aria-hidden="true"></i></span><span class="kic-lnb-text">라이트</span>
        </button>
        <a class="kic-lnb-link" data-title="시스템 설정" target="_blank" rel="noopener noreferrer" href="${SETTINGS_URL}">
          <span class="kic-lnb-ico"><i class="fas fa-gear" aria-hidden="true"></i></span><span class="kic-lnb-text">시스템 설정</span>
        </a>
        <button class="kic-lnb-link" type="button" onclick="KicAuth.logout()" title="로그아웃" data-title="로그아웃">
          <span class="kic-lnb-ico"><i class="fas fa-right-from-bracket" aria-hidden="true"></i></span><span class="kic-lnb-text">로그아웃${readSession() ? ' · ' + escapeAttr(readSession().name || '') : ''}</span>
        </button>
      </div>`;

    // 위 막대 · 아래 탭 · 서랍 뒷판은 한 화면에 한 번만 붙입니다.
    if (!document.querySelector('.kic-top')) {
      document.body.prepend(renderTopBar(activePage, basePath));
      const backdrop = document.createElement('div');
      backdrop.className = 'kic-lnb-backdrop';
      backdrop.addEventListener('click', () => window.KicLnb && window.KicLnb.close());
      sidebar.after(backdrop);
      document.body.appendChild(renderTabBar(activePage, basePath));
    }
    if (window.KicTheme) window.KicTheme.updateSwitchUi();
  }

  // ── v3.1.0 로그인 (7개 메뉴 공통). 서버가 요청마다 다시 확인하므로 이 화면은 입구 역할입니다.
  // 토큰은 이 브라우저에만: 「로그인 유지」면 localStorage(90일), 아니면 sessionStorage(탭을 닫으면 끝, 서버도 1일).
  const AUTH_KEY = 'kic-session';
  let loginBox = null, pendingPassword = '';

  function readSession() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || sessionStorage.getItem(AUTH_KEY) || 'null'); } catch (_) { return null; }
  }
  function keepSession(session, keep) {
    try {
      localStorage.removeItem(AUTH_KEY); sessionStorage.removeItem(AUTH_KEY);
      if (session) (keep ? localStorage : sessionStorage).setItem(AUTH_KEY, JSON.stringify(session));
    } catch (_) { /* 저장이 막힌 브라우저(사생활 보호 창 등)는 로그인이 유지되지 않을 뿐입니다. */ }
  }

  function renderLogin() {
    const box = document.createElement('div');
    box.className = 'kic-login';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'kic-login-title');
    // 로고는 위 막대에 이미 그린 계기판 그림(favicon.svg)을 그대로 씁니다(하위 경로 페이지도 주소가 맞음).
    const mark = document.querySelector('.kic-brand-mark');
    const logo = mark ? mark.getAttribute('src') : 'favicon.svg';
    box.innerHTML = `
      <form class="kic-login-card">
        <div class="kic-login-head">
          <img src="${escapeAttr(logo)}" alt="" width="52" height="52">
          <h1 id="kic-login-title">KIC 업무 도구</h1>
        </div>
        <p class="kic-login-msg" role="alert" hidden></p>
        <div data-step="login">
          <label>아이디<input name="id" autocomplete="username" autocapitalize="off" spellcheck="false"></label>
          <label>비밀번호<input name="password" type="password" autocomplete="current-password"></label>
          <label class="kic-login-keep"><input name="keep" type="checkbox"> 로그인 유지 (90일)</label>
        </div>
        <div data-step="change" hidden>
          <p class="kic-login-note">처음 받은 비밀번호를 바꿔 주세요. 8자 이상입니다.</p>
          <label>지금 비밀번호<input name="current" type="password" autocomplete="current-password"></label>
          <label>새 비밀번호<input name="next" type="password" autocomplete="new-password" minlength="8"></label>
          <label>새 비밀번호 확인<input name="confirm" type="password" autocomplete="new-password" minlength="8"></label>
        </div>
        <button class="kic-btn primary" type="submit">로그인</button>
      </form>`;
    box.querySelector('form').addEventListener('submit', submitLogin);
    return box;
  }

  function showLogin(step, message) {
    if (!loginBox) {
      loginBox = renderLogin();
      document.body.appendChild(loginBox);
      // 뒤 화면은 클릭·탭 이동이 되지 않게 막습니다. 로그인하면 새로고침합니다.
      Array.from(document.body.children).forEach(el => { if (el !== loginBox) el.inert = true; });
      document.body.classList.add('kic-locked');
    }
    const change = step === 'change';
    loginBox.querySelector('[data-step="login"]').hidden = change;
    loginBox.querySelector('[data-step="change"]').hidden = !change;
    loginBox.querySelectorAll('[data-step] input:not([type="checkbox"])').forEach(input => { input.required = !input.closest('[data-step]').hidden; });
    loginBox.querySelector('button[type="submit"]').textContent = change ? '비밀번호 바꾸기' : '로그인';
    const msg = loginBox.querySelector('.kic-login-msg');
    msg.hidden = !message;
    msg.textContent = message || '';
    if (change && pendingPassword) loginBox.querySelector('[name="current"]').value = pendingPassword;
    const empty = Array.from(loginBox.querySelectorAll('input:not([type="checkbox"])')).find(input => input.required && !input.value);
    setTimeout(() => (empty || loginBox.querySelector('button[type="submit"]')).focus(), 0);
  }

  async function submitLogin(event) {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button[type="submit"]'), msg = form.querySelector('.kic-login-msg');
    const value = name => form.elements[name].value;
    const changing = !form.querySelector('[data-step="change"]').hidden;
    button.disabled = true;
    msg.hidden = true;
    try {
      if (typeof window.callGASApi !== 'function') throw new Error('서버 설정(js/config.js)을 불러오지 못했습니다.');
      if (changing) {
        if (value('next') !== value('confirm')) throw new Error('새 비밀번호 두 칸이 서로 다릅니다.');
        await window.callGASApi('changePassword', { current: value('current'), next: value('next') });
        const session = readSession();
        session.mustChange = false;
        keepSession(session, session.keep);
      } else {
        const result = await window.callGASApi('login', { id: value('id').trim(), password: value('password'), keep: form.elements.keep.checked });
        keepSession(result, result.keep);
        if (result.mustChange) { pendingPassword = value('password'); showLogin('change'); return; }
      }
      location.reload();
    } catch (error) {
      msg.hidden = false;
      msg.textContent = String(error && error.message || error).replace(/^(?:Error:\s*)+/, '');
    } finally {
      button.disabled = false;
    }
  }

  window.KicAuth = {
    token: () => (readSession() || {}).token || '',
    user: () => readSession(),
    // 서버가 거절했거나 로그인 전에 요청하려 할 때 config.js 가 부릅니다.
    rejected(code, message) {
      if (code === 'AUTH_PASSWORD_CHANGE') return showLogin('change', message);
      const ended = !!readSession();
      if (!ended && loginBox) return; // 이미 로그인 화면이면 앞선 안내를 지우지 않습니다
      keepSession(null);
      showLogin('login', ended ? '로그인이 끝났습니다. 다시 로그인해 주세요.' : '');
    },
    async logout() {
      const all = confirm('다른 기기·브라우저의 로그인도 함께 끝낼까요?\n\n확인: 모든 기기에서 로그아웃\n취소: 이 기기만 로그아웃');
      try { if (typeof window.callGASApi === 'function') await window.callGASApi('logout', { all }); } catch (_) { /* 서버가 안 받아도 이 기기에서는 끝냅니다. */ }
      keepSession(null);
      location.reload();
    }
  };

  function init() {
    document.querySelectorAll('[data-kic-sidebar]').forEach(render);
    const session = readSession();
    if (!session || !session.token) showLogin('login');
    else if (session.mustChange) showLogin('change');
  }

  window.KicSidebar = {
    version: APP_VERSION,
    items: MENU_ITEMS.slice(),
    init: init,
    render: render
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
