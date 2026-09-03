/**
 * KIC 업무 도구 공통 사이드바
 * - 메뉴/설정/버전 정보를 한 곳에서 관리합니다.
 * - data-active-page 속성으로 현재 메뉴를 표시합니다.
 * - 하위 경로 페이지는 data-base-path="../"처럼 기준 경로를 지정할 수 있습니다.
 */
(function initKicSidebarModule() {
  'use strict';

  const APP_VERSION = 'v2.6.0';
  const SETTINGS_URL = 'https://script.google.com/u/0/home/projects/1jErMgSPLT27-zC16HWZpaxDa2CIfd69qEOkjujlvVylKa4TusD8sOu8O/edit';
  const JIRA_TIMELINE_URL = 'https://script.google.com/macros/s/AKfycbyjbf1M5XTqdW203XQWUdwO1Y9qgu1rG_WqiWX0LVgJNEEldw4gMOf6_tGfXGxc6ABQnA/exec?page=jiraTimeline';
  const MENU_ITEMS = [
    { id: 'helpdesk', title: 'IT 헬프데스크', icon: '📈', href: 'index.html' },
    { id: 'reply', title: 'IT 헬프데스크 답변', icon: '💬', href: 'reply.html' },
    { id: 'notice', title: '공지사항 생성', icon: '📢', href: 'notice.html' },
    { id: 'delay', title: '교정 지연 안내', icon: '⏳', href: 'delay.html' },
    { id: 'print', title: '필증 출력 확인', icon: '🏷️', href: 'print.html' },
    { id: 'marketer', title: '블로그 마케터', icon: '✍️', href: 'marketer.html' },
    { id: 'jira-timeline', title: 'IT전략실 통합 일정', icon: '🗓️', href: JIRA_TIMELINE_URL, target: '_top' },
    {
      id: 'dashboard',
      title: 'CWIZ 2.0 대시보드',
      icon: '📊',
      href: 'dashboard/',
      target: '_blank'
    }
  ];

  function resolveHref(basePath, href) {
    if (!basePath || /^(?:[a-z]+:|#)/i.test(href)) return href;
    return basePath.replace(/\/?$/, '/') + href.replace(/^\.\//, '');
  }

  function renderMenuItem(item, activePage, basePath) {
    const isActive = item.id === activePage;
    const targetAttrs = item.target
      ? ` target="${item.target}" rel="noopener noreferrer"`
      : '';
    const currentAttr = isActive ? ' aria-current="page"' : '';

    return `<a class="kic-lnb-link${isActive ? ' kic-active' : ''}" data-title="${item.title}" href="${resolveHref(basePath, item.href)}"${targetAttrs}${currentAttr}>` +
      `<span class="kic-lnb-ico">${item.icon}</span>` +
      `<span class="kic-lnb-text">${item.title}</span>` +
      `</a>`;
  }

  function render(sidebar) {
    if (!sidebar) return;

    const activePage = sidebar.dataset.activePage || '';
    const basePath = sidebar.dataset.basePath || '';
    sidebar.classList.add('kic-lnb');
    sidebar.innerHTML = `
      <div class="kic-lnb-brand">
        <div class="kic-lnb-logo">▣</div>
        <div class="kic-lnb-brand-text">
          <div class="kic-lnb-title">KIC 업무 도구</div>
          <div class="kic-lnb-sub">IT · CMS Helper</div>
        </div>
        <button class="kic-lnb-toggle" type="button" onclick="KicLnb.toggle()" title="메뉴 접기/펼치기" aria-label="메뉴 접기/펼치기">☰</button>
      </div>
      <nav class="kic-lnb-nav" aria-label="KIC 업무 도구 메뉴">
        ${MENU_ITEMS.map(item => renderMenuItem(item, activePage, basePath)).join('')}
      </nav>
      <div class="kic-lnb-bottom">
        <button class="kic-theme-switch" type="button" onclick="KicTheme.toggle()" title="테마 전환">
          <span class="kic-lnb-ico">☀️</span><span class="kic-lnb-text">라이트</span>
        </button>
        <a class="kic-lnb-link" data-title="시스템 설정" target="_blank" rel="noopener noreferrer" href="${SETTINGS_URL}">
          <span class="kic-lnb-ico">⚙️</span><span class="kic-lnb-text">설정(${APP_VERSION})</span>
        </a>
      </div>`;
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
