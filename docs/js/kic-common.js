/**
 * KIC 업무 도구 공통 스크립트 모듈 (kic-common.js)
 * - 테마 관리자 (KicTheme): 라이트 / 다크 실시간 전환 및 영구 기억
 * - 공통 토스트 (showToast)
 * - 모달 ESC / 백드롭 닫기 (KicModal)
 * - 사이드바 LNB 관리자 (KicLnb)
 */

// 1. 테마 조기 초기화 (FOUC 깜빡임 방지용 - 기본값 다크 모드)
(function initEarlyTheme() {
  try {
    const saved = localStorage.getItem('kic_theme');
    // 사용자가 명시적으로 'light'를 선택하지 않은 모든 경우 다크 모드 기본 적용
    if (saved === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {
    console.warn('Early theme init error:', e);
  }
})();

// 2. 테마 관리자 (KicTheme)
const KicTheme = {
  get: function() {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  },
  set: function(theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('kic_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('kic_theme', 'light');
    }
    this.updateSwitchUi();
    window.dispatchEvent(new CustomEvent('kic-theme-changed', { detail: { theme } }));
  },
  toggle: function() {
    const next = this.get() === 'dark' ? 'light' : 'dark';
    this.set(next);
    showToast(next === 'dark' ? '🌙 다크 모드로 전환되었습니다.' : '☀️ 라이트 모드로 전환되었습니다.', 'info');
    return next;
  },
  updateSwitchUi: function() {
    const isDark = this.get() === 'dark';
    const switchBtns = document.querySelectorAll('.kic-theme-switch');
    switchBtns.forEach(btn => {
      btn.innerHTML = isDark
        ? `<span class="kic-lnb-ico"><i class="fas fa-circle-half-stroke" aria-hidden="true"></i></span><span class="kic-lnb-text">라이트</span>`
        : `<span class="kic-lnb-ico"><i class="fas fa-circle-half-stroke" aria-hidden="true"></i></span><span class="kic-lnb-text">다크</span>`;
      btn.setAttribute('title', isDark ? '라이트 모드로 전환' : '다크 모드로 전환');
      btn.dataset.title = isDark ? '라이트 모드로 전환' : '다크 모드로 전환';
    });
  },
  init: function() {
    this.updateSwitchUi();
    // OS 테마 변경 감지
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (!localStorage.getItem('kic_theme')) {
          this.set(e.matches ? 'dark' : 'light');
        }
      });
    }
  }
};

// 3. 공통 토스트 (showToast): 아래 가운데에 잠깐 떴다가 사라집니다. 색 점으로 성공·오류·안내를 구분합니다.
let toastTimer = null;
function showToast(message, type = 'info', duration = 2800) {
  let toast = document.getElementById('kic-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'kic-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }

  if (toastTimer) clearTimeout(toastTimer);
  const typeClass = type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : 'toast-info';
  toast.className = typeClass;
  toast.textContent = message;
  toast.style.opacity = '1';

  toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 200);
  }, duration);
}

// 4. 공통 모달 관리자 (KicModal)
const KicModal = {
  init: function() {
    // 키보드 ESC 키로 모달 닫기
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (window.KicLnb) window.KicLnb.close();
        this.closeAll();
      }
    });

    // 백드롭(어두운 배경) 클릭 시 닫기
    document.addEventListener('click', e => {
      if (e.target && (e.target.classList.contains('kic-modal-backdrop') || e.target.classList.contains('modal-backdrop-closeable'))) {
        this.closeAll();
      }
    });
  },
  closeAll: function() {
    // 헬프데스크 모달
    if (typeof closeAddModal === 'function') closeAddModal();
    if (typeof closeEditModal === 'function') closeEditModal();
    if (typeof closeSettingsModal === 'function') closeSettingsModal();
    
    // 블로그 마케터 모달
    if (typeof closePlanAddModal === 'function') closePlanAddModal();
    if (typeof closePlanEditModal === 'function') closePlanEditModal();
    if (typeof closeCategorySettings === 'function') closeCategorySettings();
    if (typeof closeGuideModal === 'function') closeGuideModal();

    // 일반 .kic-modal-backdrop 또는 [data-modal] 닫기
    const activeModals = document.querySelectorAll('.kic-modal-backdrop:not(.hidden), [data-modal-open="true"]');
    activeModals.forEach(m => { if (m.dataset.modalSaving !== 'true') m.classList.add('hidden'); });
  }
};

// 5. 공통 사이드바(메뉴) 관리자 (KicLnb)
// 넓은 화면의 ☰ = 72px 아이콘 줄로 접기(기억함). 휴대폰(860px 이하)의 ☰ = 서랍 열고 닫기.
const KicLnb = {
  mobileQuery: window.matchMedia ? window.matchMedia('(max-width: 860px)') : null,
  isMobile: function() {
    return Boolean(this.mobileQuery && this.mobileQuery.matches);
  },
  init: function() {
    try {
      if (localStorage.getItem('kic_lnb_collapsed') === 'true') document.body.classList.add('kic-lnb-collapsed');
    } catch (e) { /* 저장소를 못 쓰면 펼친 상태로 둡니다 */ }
    if (this.mobileQuery && this.mobileQuery.addEventListener) {
      this.mobileQuery.addEventListener('change', () => this.close());
    }
  },
  toggle: function() {
    if (this.isMobile()) {
      document.body.classList.toggle('kic-lnb-open');
      return;
    }
    const isCollapsed = document.body.classList.toggle('kic-lnb-collapsed');
    try { localStorage.setItem('kic_lnb_collapsed', isCollapsed ? 'true' : 'false'); } catch (e) { /* 기억만 못 함 */ }
  },
  close: function() {
    document.body.classList.remove('kic-lnb-open');
  }
};

window.KicTheme = KicTheme;
window.KicLnb = KicLnb;

// DOM 로드 시 공통 초기화
document.addEventListener('DOMContentLoaded', () => {
  KicTheme.init();
  KicModal.init();
  KicLnb.init();
});
