# Jira 통합 일정 조회 전용 Apps Script

이 디렉터리는 기존 KIC 업무 API와 **완전히 별도인 Apps Script 프로젝트**로 배포하는 읽기 전용 소스입니다. 기존 등록·수정 API에는 영향을 주지 않으며, 공개 프로젝트에는 이 폴더의 제한된 `doGet`/`doPost`만 포함합니다. 실제 Jira 데이터는 Google ID Token의 `aud`, `iss`, `exp`, `email_verified`, `hd` 값을 모두 검증하고 `@kic21.co.kr` 계정일 때만 반환합니다.

## 필요한 Script Properties

| 속성 | 값 |
|---|---|
| `JIRA_BASE_URL` | `https://kic-itsd.atlassian.net` |
| `JIRA_ACCOUNT_EMAIL` | Jira 조회 계정 이메일 |
| `JIRA_API_TOKEN` | Jira API Token |
| `JIRA_TIMELINE_WEB_ENABLED` | `true` |
| `JIRA_START_DATE_FIELD_ID` | 선택값. 비워두면 자동 탐색 |

코드에 포함된 OAuth 클라이언트 ID는 공개 식별값이며 비밀번호가 아닙니다. OAuth 클라이언트의 **승인된 JavaScript 원본**에는 `https://hikary83.github.io`를 등록합니다. 팝업 로그인 방식이므로 리디렉션 URI는 사용하지 않습니다.

배포 후 발급된 `/exec` URL을 `docs/js/config.js`의 `JIRA_TIMELINE_API_URL`에 입력합니다. 이 공개 프로젝트에는 Jira 조회 외 다른 업무 API를 추가하지 않습니다.
