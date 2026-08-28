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
