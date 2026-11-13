/**
 * KIC 업무 도구 공통 틀
 * - 위 막대(☰ · 로고 · 가운데/오른쪽 자리) · 왼쪽 메뉴 · 휴대폰 아래 탭을 한 곳에서 그립니다.
 * - data-active-page 속성으로 현재 메뉴를 표시합니다.
 * - 하위 경로 페이지는 data-base-path="../"처럼 기준 경로를 지정할 수 있습니다.
 * - 화면은 #kic-top-center(검색 등) · #kic-top-right(상태 등)에 자기 것을 넣어 씁니다.
 */
(function initKicSidebarModule() {
  'use strict';

  const APP_VERSION = 'v3.0.4';
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

  function init() {
    document.querySelectorAll('[data-kic-sidebar]').forEach(render);
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
