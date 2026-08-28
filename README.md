# 🛠️ KIC 업무 도구 (KIC Worktools)

> **코리아인스트루먼트(주) IT · CMS 전사 업무 자동화 및 헬프데스크 통합 플랫폼**  
> **공식 서비스 URL**: <https://hikary83.github.io/kic-worktools/>  
> **현재 버전**: `v2.4.0` (2026-08-28 기준)

---

## 📌 프로젝트 소개 및 주요 도구

| 도구명 | 파일 경로 | 버전 | 설명 |
|---|---|:---:|---|
| **📈 IT 헬프데스크** | [`docs/index.html`](docs/index.html) | `v2.2.0` | 전사 IT 이슈 접수, 상태별 칸반 보드 및 처리 현황 관리 |
| **💬 IT 헬프데스크 답변** | [`docs/reply.html`](docs/reply.html) | `v2.1.0` | AI 기반 헬프데스크 맞춤형 표준 답변 자동 생성 |
| **📢 공지사항 생성** | [`docs/notice.html`](docs/notice.html) | `v2.0.0` | 사내 전산 시스템 점검 및 업데이트 공지 템플릿 생성 |
| **⏳ 교정 지연 안내** | [`docs/delay.html`](docs/delay.html) | `v2.0.0` | 표준기 교정 지연 및 납기 조정 고객 안내문 생성 |
| **🏷️ 필증 출력 확인** | [`docs/print.html`](docs/print.html) | `v1.2.0` | CMS kpo_idx 기반 API 응답 확인, 인앱 모달 뷰어 및 교정필증/접수표찰 카드 분석 |
| **✍️ 블로그 마케터** | [`docs/marketer.html`](docs/marketer.html) | `v2.1.0` | AI 교정 기술 블로그 포스팅 초안 및 키워드 생성기 |
| **📊 CWIZ 주간 대시보드** | [`docs/dashboard/`](docs/dashboard/index.html) | `v2.3.0` | 주간 엑셀 5종 기반 기업 지표 분석, GitHub 원클릭 Save/배포 및 캐시 시스템 |

---

## 🏷️ 버전 관리 규칙 (Versioning Policy)

본 프로젝트는 **시맨틱 버저닝 (Semantic Versioning: `MAJOR.MINOR.PATCH`)** 원칙을 따릅니다:

* **MAJOR (`vX.0.0`)**: 대규모 아키텍처 개편, 전체 디자인 시스템 전면 리뉴얼, 호환되지 않는 API 변경
* **MINOR (`v0.X.0`)**: 신규 도구 추가, 기존 도구의 주요 신기능(예: 인앱 모달, 원클릭 커밋 엔진 등) 탑재
* **PATCH (`v0.0.X`)**: 버그 픽스, 다크모드 색상 보정, 문구/스타일 개선, 성능 최적화

---

## 📋 버전 변경 이력 (Release Changelog)

### `v2.4.0` (2026-08-28)
* **필증 출력 확인 (`print.html` v1.2.0)**:
  * 🪟 **인앱 모달 뷰어 도입**: 브라우저 팝업 차단 없이 안전하게 CMS API 응답을 확인할 수 있는 일체형 모달 구현
  * 🌓 **다크/라이트 테마 자동 동기화**: iframe 내부 캔버스의 다크/라이트 모드별 완벽한 폰트 및 배경 색상 최적화
  * 📋 **스마트 클립보드 자동 분석**: 클립보드에 복사된 API 응답 텍스트를 감지하여 교정필증/접수표찰 카드를 자동 생성
* **CWIZ 주간 대시보드 (`docs/dashboard/` v2.3.0)**:
  * 📤/💾 **Upload / Save 2단계 워크플로우**: 로컬 브라우저 즉시 검증 후 GitHub Contents API 원클릭 커밋/푸시 배포 엔진 탑재
  * 🔄 **업로드 패널 편의성 개선**: `Upload`/`Save` 후 패널 자동 닫힘 방지 및 `[ 🔄 파일 초기화 ]` 버튼 추가
  * ⚡ **하이브리드 로컬 캐시 매니저**: `localStorage` + `IndexedDB` 연동으로 브라우저 내 지표 및 슬롯 메타데이터 보관
  * 📝 **기술 문서 고도화**: 새로고침 시 데이터 유지 이슈 및 GitHub Pages CDN 딜레이 원인 분석 상세 문서화

### `v2.3.0` (2026-08-27)
* **CWIZ 주간 대시보드 UI 고도화**:
  * 이슈 카드 원형 성 뱃지 제거 및 담당자 이름 단독 표시
  * 대시보드 KPI 카드 및 차트 정합성 개선

### `v2.2.0` (2026-08-26)
* **IT 헬프데스크 및 공지 도구 전면 테마 통일**:
  * Pretendard 폰트 및 Tailwind CSS 기반의 KIC 전용 테마 적용

### `v2.1.0` (2026-08-25)
* **전역 공통 모듈 (`kic-common.js`, `kic-theme.css`) 구축**:
  * 라이트 / 다크 테마 실시간 전환 및 `localStorage` 영구 기억
  * 모달 ESC / 백드롭 닫기 및 사이드바 LNB 반응형 축소/확장 지원

---

## 💻 로컬 개발 및 배포 가이드

### 1) Git 커밋 및 GitHub Pages 배포
```powershell
# 변경 사항 확인
git status

# 커밋 및 푸시
git add .
git commit -m "feat: release version v2.4.0"
git push origin main
```

### 2) 배포 확인
* 배포 후 1~2분 뒤 <https://hikary83.github.io/kic-worktools/> 에서 반영 확인.

---

## 🤖 다른 AI 어시스턴트가 작업을 이어받을 때 (AI Handover Guide)

> **[필독]** 이 저장소에서 새로운 작업이나 수정을 진행하는 모든 AI 모델은 아래 원칙과 아키텍처를 반드시 준수해야 합니다.

### 1. 회사명 및 도메인 표기 절대 원칙
* 회사의 공식 국문 명칭은 **`코리아인스트루먼트(주)`** 입니다. (구 명칭이나 유사 명칭을 절대 사용하지 마십시오.)
* 사내 시스템 명칭: **`CMS`**, **`CWIZ Enterprise`**, **`KIC 업무 도구`**.

### 2. 기술 스택 및 아키텍처 구조
* **프론트엔드**: 빌드 도구(Webpack/Vite 등)가 없는 **순수 정적 웹(Pure Vanilla JS + HTML5 + CSS3)** 구조입니다.
  * 스타일링: Tailwind CSS CDN (`<script src="https://cdn.tailwindcss.com"></script>`) + `docs/css/kic-theme.css`
  * 폰트: `Pretendard Variable` (CDN)
  * 아이콘: `FontAwesome 6.0` (CDN)
  * 공통 모듈: `docs/js/kic-common.js` (테마 토글, 토스트, LNB, 모달)
* **백엔드/API 연동**:
  * `docs/js/config.js`에 설정된 Google Apps Script(GAS) 웹앱 엔드포인트를 통해 스프레드시트 DB 및 Jira/Gemini AI와 통신합니다.
* **배포 환경**: GitHub Pages (`main` 브랜치 `/docs` 디렉토리 기반 호스팅).

### 3. 기능별 핵심 주의사항
1. **필증 출력 확인 (`print.html`)**:
   * `cms.kic21.co.kr`은 CORS 헤더를 내려주지 않으므로 브라우저 직접 `fetch`가 차단됩니다.
   * `iframe` 내부 DOM 텍스트 역시 브라우저 SOP(동일 출처 정책)로 인해 자바스크립트가 직접 읽을 수 없으므로, 다크모드 반전 필터(`invert(0.88)`) 및 클립보드 복사 안내 워크플로우를 유지하십시오.
2. **CWIZ 주간 대시보드 (`docs/dashboard/`)**:
   * 자세한 인수인계 문서는 [`docs/dashboard/README.md`](docs/dashboard/README.md)에 380줄 이상으로 완벽하게 정리되어 있으니 작업 전 필독하십시오.
   * 원본 Excel 5개(`이용신청`, `고객사현황`, `고객사계측기현황`, `데이터변경이력`, `보안접속이력`)의 컬럼 스키마와 집계 정책(`compute()`)을 임의로 변경하거나 하드코딩하지 마십시오.
   * 새로고침 시 데이터 유실 방지를 위한 `localStorage` + `IndexedDB` 하이브리드 캐시 복원 로직을 반드시 보존하십시오.
3. **버전 관리 및 Changelog 동기화**:
   * 작업을 완료한 후에는 반드시 이 `README.md`의 버전 번호(Semantic Versioning)와 **Changelog** 섹션을 갱신하고 푸시하십시오.

