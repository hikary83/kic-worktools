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
        ? `<span class="kic-lnb-ico">☀️</span><span class="kic-lnb-text">라이트</span>`
        : `<span class="kic-lnb-ico">🌙</span><span class="kic-lnb-text">다크</span>`;
      btn.setAttribute('title', isDark ? '라이트 모드로 전환' : '다크 모드로 전환');
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

// 3. 공통 토스트 팝업 (showToast)
let toastTimer = null;
function showToast(message, type = 'info', duration = 2500) {
  let toast = document.getElementById('kic-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'kic-toast';
    toast.className = 'hidden';
    document.body.appendChild(toast);
  }

  if (toastTimer) clearTimeout(toastTimer);

  let icon = 'ℹ️';
  let typeClass = 'toast-info';
  if (type === 'success') {
    icon = '✅';
    typeClass = 'toast-success';
  } else if (type === 'error') {
    icon = '❌';
    typeClass = 'toast-error';
  }

  toast.className = `${typeClass} flex items-center gap-2.5 px-5 py-3.5 rounded-2xl shadow-2xl text-sm font-extrabold transition-all duration-300 transform translate-y-0 opacity-100 backdrop-blur-md`;
  toast.innerHTML = `<span class="text-base leading-none">${icon}</span><span>${message}</span>`;
  toast.classList.remove('hidden');

  toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-12px)';
    setTimeout(() => toast.classList.add('hidden'), 250);
  }, duration);
}

// 4. 공통 모달 관리자 (KicModal)
const KicModal = {
  init: function() {
    // 키보드 ESC 키로 모달 닫기
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' || e.key === 'Esc') {
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
    activeModals.forEach(m => m.classList.add('hidden'));
  }
};

// 5. 공통 사이드바 LNB 관리자 (KicLnb)
const KicLnb = {
  init: function() {
    const isCollapsed = localStorage.getItem('kic_lnb_collapsed') === 'true';
    if (isCollapsed) {
      document.body.classList.add('kic-lnb-collapsed');
    }
  },
  toggle: function() {
    const isCollapsed = document.body.classList.toggle('kic-lnb-collapsed');
    localStorage.setItem('kic_lnb_collapsed', isCollapsed ? 'true' : 'false');
  }
};

// DOM 로드 시 공통 초기화
document.addEventListener('DOMContentLoaded', () => {
  KicTheme.init();
  KicModal.init();
  KicLnb.init();
});
