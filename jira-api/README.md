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

## 헬프데스크 싱크용 조회 (v2.8.0 · 2026-10-01, 서버 v14 배포 완료)

`getHelpdeskJiraSyncIssues`는 업무 API에서 전달한 Jira 번호와 이슈번호를 조회합니다. Jira 번호 직접 조회에는 완료 티켓과 사용 해제된 프로젝트도 포함하며, 미연결 건의 후보 검색은 `사용` 설정된 프로젝트를 대상으로 합니다. 후보는 제목·본문·레이블의 정확한 `IT-YYMMDD-NNN` 참조로만 연결하고 제목 유사도는 사용하지 않습니다. 댓글·첨부·커스텀 필드만의 참조는 자동 연결 대상이 아닙니다.

이 API는 Jira 데이터를 변경하지 않습니다. 승인한 변경안을 헬프데스크 시트에 저장하는 작업은 별도 업무 API의 `applyJiraSync`에서 수행합니다. 웹앱 배포 ID나 Jira 테넌트가 바뀌면 `backend/JiraSync.js`의 조회 URL/테넌트도 함께 수정해야 합니다. [전체 운영 및 배포 기준](../HELPDESK_JIRA_SYNC.md)을 참고하세요.

## 일정 제외 운영 기준

Jira 기본 `레이블` 필드에 `일정제외`를 추가한 Issue는 API 응답의 `labels`에 포함됩니다. 프런트 화면에서는 해당 Issue를 타임라인과 일반 미지정 건수에서 제외하고, `일정 미지정 업무` 표의 일정 구분 필터를 `전체` 또는 `일정 제외만`으로 바꾸면 확인할 수 있습니다. 레이블을 제거하면 다음 조회부터 다시 일반 일정 대상으로 돌아옵니다.

## 프로젝트 설정 운영 기준

화면 우측 상단의 `프로젝트 설정`에서 조회 계정이 접근할 수 있는 Jira 프로젝트를 드롭다운으로 선택하고 화면 표시명·사용 여부·표시 순서를 관리합니다. 저장 시 Apps Script의 `JIRA_TIMELINE_PROJECTS`에 공통 설정이 기록되고 Jira 프로젝트 유효성을 확인한 뒤 캐시를 초기화합니다. 사용하지 않는 프로젝트는 삭제보다 `사용`을 해제하는 방식을 권장합니다. 현재 테스트 버전에는 별도 관리자 인증을 적용하지 않았습니다.
