# Jira 통합 일정 Apps Script

이 디렉터리는 기존 KIC 업무 API와 **완전히 별도인 Apps Script 프로젝트**로 배포합니다. Jira Issue는 조회만 하며 프로젝트 조회 범위 설정만 별도로 저장합니다. 현재는 기능 검증을 위해 로그인 없는 공개 테스트 모드로 운영하며, `JIRA_TIMELINE_WEB_ENABLED` 속성으로 즉시 조회를 차단할 수 있습니다.

## 필요한 Script Properties

| 속성 | 값 |
|---|---|
| `JIRA_BASE_URL` | `https://kic-itsd.atlassian.net` |
| `JIRA_ACCOUNT_EMAIL` | Jira 조회 계정 이메일 |
| `JIRA_API_TOKEN` | Jira API Token |
| `JIRA_TIMELINE_WEB_ENABLED` | `true` |
| `JIRA_START_DATE_FIELD_ID` | 선택값. 비워두면 자동 탐색 |
| `JIRA_TIMELINE_PROJECTS` | 선택값. 프로젝트 설정 모달에서 JSON으로 자동 저장하며, 없으면 기본 5개 프로젝트 사용 |
> 공개 테스트 모드에서는 웹앱 URL을 아는 누구나 Jira 일정 데이터를 조회할 수 있습니다. 운영 전에는 전체 업무 도구에 공통 서버 인증을 적용해야 합니다.

배포 후 발급된 `/exec` URL을 `docs/js/config.js`의 `JIRA_TIMELINE_API_URL`에 입력합니다. 이 공개 프로젝트에는 Jira 조회 외 다른 업무 API를 추가하지 않습니다.

## 일정 제외 운영 기준

Jira 기본 `레이블` 필드에 `일정제외`를 추가한 Issue는 API 응답의 `labels`에 포함됩니다. 프런트 화면에서는 해당 Issue를 타임라인과 일반 미지정 건수에서 제외하고, `일정 미지정 업무` 표의 일정 구분 필터를 `전체` 또는 `일정 제외만`으로 바꾸면 확인할 수 있습니다. 레이블을 제거하면 다음 조회부터 다시 일반 일정 대상으로 돌아옵니다.

## 프로젝트 설정 운영 기준

화면 우측 상단의 `프로젝트 설정`에서 조회 계정이 접근할 수 있는 Jira 프로젝트를 드롭다운으로 선택하고 화면 표시명·사용 여부·표시 순서를 관리합니다. 저장 시 Apps Script의 `JIRA_TIMELINE_PROJECTS`에 공통 설정이 기록되고 Jira 프로젝트 유효성을 확인한 뒤 캐시를 초기화합니다. 사용하지 않는 프로젝트는 삭제보다 `사용`을 해제하는 방식을 권장합니다. 현재 테스트 버전에는 별도 관리자 인증을 적용하지 않았습니다.
