# Jira 통합 일정 조회 전용 Apps Script

이 디렉터리는 기존 KIC 업무 API와 **완전히 별도인 Apps Script 프로젝트**로 배포하는 읽기 전용 소스입니다. 기존 등록·수정 API에는 영향을 주지 않으며, 공개 프로젝트에는 이 폴더의 제한된 `doGet`/`doPost`만 포함합니다. 현재는 기능 검증을 위해 로그인 없는 공개 테스트 모드로 운영하며, `JIRA_TIMELINE_WEB_ENABLED` 속성으로 즉시 조회를 차단할 수 있습니다.

## 필요한 Script Properties

| 속성 | 값 |
|---|---|
| `JIRA_BASE_URL` | `https://kic-itsd.atlassian.net` |
| `JIRA_ACCOUNT_EMAIL` | Jira 조회 계정 이메일 |
| `JIRA_API_TOKEN` | Jira API Token |
| `JIRA_TIMELINE_WEB_ENABLED` | `true` |
| `JIRA_START_DATE_FIELD_ID` | 선택값. 비워두면 자동 탐색 |
> 공개 테스트 모드에서는 웹앱 URL을 아는 누구나 Jira 일정 데이터를 조회할 수 있습니다. 운영 전에는 전체 업무 도구에 공통 서버 인증을 적용해야 합니다.

배포 후 발급된 `/exec` URL을 `docs/js/config.js`의 `JIRA_TIMELINE_API_URL`에 입력합니다. 이 공개 프로젝트에는 Jira 조회 외 다른 업무 API를 추가하지 않습니다.

## 일정 제외 운영 기준

Jira 기본 `레이블` 필드에 `일정제외`를 추가한 Issue는 API 응답의 `labels`에 포함됩니다. 프런트 화면에서는 해당 Issue를 타임라인과 일반 미지정 업무에서 빼고, 상단 노출 토글로 확인할 수 있는 별도의 `일정 제외 업무` 목록으로 분리합니다. 레이블을 제거하면 다음 조회부터 다시 일반 일정 대상으로 돌아옵니다.
