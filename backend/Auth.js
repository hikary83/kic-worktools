/* 로그인 (v3.1.0, 2026-11-13). 업무 서버 주소는 공개(docs/js/config.js)라 요청마다 누가 보냈는지 서버에서 확인합니다.
 * 스크립트 속성 (값은 사람만 넣고 봅니다. 원문 비밀번호·토큰·키는 어디에도 저장하지 않습니다):
 *   AUTH_USERS      계정 { 아이디: { name, role: admin|user, salt, rounds, hash, mustChange, createdAt } }
 *   AUTH_SESSIONS   세션 { sha256(토큰): { id, at, used, keep } }
 *   AUTH_TOOL_KEYS  도구 키 { 이름: sha256(키) } — CS팀·블로그팀·개발팀 Claude 세션의 서버 호출용
 *   AUTH_REQUIRED   'Y' 이면 잠금. 없으면 「확인 보류」: 토큰 없는 요청도 통과(배포 순서·되돌리기 스위치)
 * 참고: 컨텐츠 매니저 D:\Codex\shopping-shorts backend/Auth.js (계정 1개) → 사람별 계정으로 넓힘. */
const AUTH_PROPS = { users: 'AUTH_USERS', sessions: 'AUTH_SESSIONS', tools: 'AUTH_TOOL_KEYS', required: 'AUTH_REQUIRED' };
const AUTH_KEEP_DAYS = 90;      // 「로그인 유지」: 마지막 사용부터 90일
const AUTH_SHORT_DAYS = 1;      // 유지 안 함: 로그인부터 1일(브라우저를 닫으면 그 전에 끝남)
const AUTH_TOUCH_MS = 864e5;    // 마지막 사용 시각은 하루에 한 번만 씁니다
const AUTH_SESSION_MAX = 20;
const AUTH_FAIL_LIMIT = 5;
const AUTH_LOCK_SECONDS = 3600;
// ponytail: 솔트 + SHA-256 반복. Apps Script 에 PBKDF2·bcrypt 가 없어 직접 반복합니다.
// 횟수는 계정마다 저장하므로 나중에 바꿔도 기존 비밀번호는 그대로 맞습니다. 첫 관리자 만들 때 걸린 시간을 알림에 보여 줍니다.
// 2026-11-13 운영 실측: 2,000번 = 서버 1.1~2.7초(목표 1초 초과) → 500번(사람 결정). 저장값이 새면 오래 못 버티는 건 둘 다 같고,
// 실제 방어는 편집 권한자만 저장값을 봄 · 5회 잠금 · 비밀번호 길이입니다.
const AUTH_HASH_ROUNDS = 500;
const AUTH_TOOL_NAMES = ['CS팀', '블로그팀', '개발팀']; // 설정 창 발급 버튼은 이 목록을 따라 그려집니다(11-13 개발팀 추가)
const AUTH_ADMIN_ACTIONS = ['listUsers', 'addUser', 'deleteUser', 'resetUserPassword', 'issueToolKey'];
const AUTH_ACCOUNT_ACTIONS = ['logout', 'changePassword'].concat(AUTH_ADMIN_ACTIONS);

function authUserError_(message) { const error = new Error(message); error.userSafe = true; return error; }
function authError_(message) { const error = authUserError_(message || '로그인이 필요합니다.'); error.auth = true; return error; }

function authHex_(bytes) { return bytes.map(function(b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function authSha_(text) { return authHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)); }
function authPasswordHash_(password, salt, rounds) {
  let digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password, Utilities.Charset.UTF_8);
  for (let i = 1; i < rounds; i++) digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digest);
  return authHex_(digest);
}
function authRandom_(length) { let text = ''; while (text.length < length) text += Utilities.getUuid().replace(/-/g, ''); return text.slice(0, length); }

function authRead_(name) { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(name) || '{}') || {}; } catch (_) { return {}; } }
function authWrite_(name, value) { PropertiesService.getScriptProperties().setProperty(name, JSON.stringify(value)); }
function authRequired_() { return PropertiesService.getScriptProperties().getProperty(AUTH_PROPS.required) === 'Y'; }
function authWithLock_(work) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw authUserError_('다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
  try { return work(); } finally { lock.releaseLock(); }
}

function authSessionAlive_(session, now) {
  return !!session && (session.keep ? now - session.used <= AUTH_KEEP_DAYS * 864e5 : now - session.at <= AUTH_SHORT_DAYS * 864e5);
}
function authLiveSessions_(sessions) {
  const now = Date.now();
  const keys = Object.keys(sessions).filter(function(key) { return authSessionAlive_(sessions[key], now); })
    .sort(function(a, b) { return sessions[b].used - sessions[a].used; }).slice(0, AUTH_SESSION_MAX);
  const live = {}; keys.forEach(function(key) { live[key] = sessions[key]; }); return live;
}
function authDropSessionsOf_(id, keepKey) {
  const sessions = authRead_(AUTH_PROPS.sessions);
  Object.keys(sessions).forEach(function(key) { if (sessions[key].id === id && key !== keepKey) delete sessions[key]; });
  authWrite_(AUTH_PROPS.sessions, authLiveSessions_(sessions));
}

function authSetPassword_(user, password) {
  if (typeof password !== 'string' || password.length < 8) throw authUserError_('비밀번호는 8자 이상으로 정해 주세요.');
  user.salt = authRandom_(32);
  user.rounds = AUTH_HASH_ROUNDS;
  user.hash = authPasswordHash_(password, user.salt, user.rounds);
}
function authNewUser_(users, id, name, role, password) {
  id = String(id || '').trim().toLowerCase(); name = String(name || '').trim();
  if (!/^[a-z0-9._-]{3,30}$/.test(id)) throw authUserError_('아이디는 영문 소문자·숫자·. _ - 로 3~30자입니다.');
  if (!name || name.length > 20) throw authUserError_('이름을 20자 안으로 넣어 주세요.');
  if (users[id]) throw authUserError_('이미 있는 아이디입니다.');
  const user = { name: name, role: role === 'admin' ? 'admin' : 'user', mustChange: true, createdAt: new Date().toISOString() };
  authSetPassword_(user, password);
  users[id] = user;
  return id;
}

function authLogin_(input) {
  const id = String(input.id || '').trim().toLowerCase(), password = typeof input.password === 'string' ? input.password : '';
  const cache = CacheService.getScriptCache(), failKey = 'AUTH_FAIL_' + authSha_(id).slice(0, 40);
  const fails = Number(cache.get(failKey) || 0);
  const locked = '비밀번호를 ' + AUTH_FAIL_LIMIT + '번 틀려서 1시간 동안 이 아이디의 로그인을 막았습니다.';
  if (fails >= AUTH_FAIL_LIMIT) throw authUserError_(locked);
  const user = authRead_(AUTH_PROPS.users)[id];
  // 없는 아이디도 같은 계산을 해서, 응답 시간으로 아이디가 있는지 드러나지 않게 합니다.
  const hash = authPasswordHash_(password, user ? user.salt : 'no-such-user', user ? user.rounds : AUTH_HASH_ROUNDS);
  if (!user || hash !== user.hash) {
    cache.put(failKey, String(fails + 1), AUTH_LOCK_SECONDS);
    throw authUserError_(fails + 1 >= AUTH_FAIL_LIMIT ? locked : '아이디나 비밀번호가 맞지 않습니다. (남은 기회 ' + (AUTH_FAIL_LIMIT - fails - 1) + '번)');
  }
  cache.remove(failKey);
  const token = authRandom_(64), keep = input.keep === true;
  authWithLock_(function() {
    const sessions = authRead_(AUTH_PROPS.sessions), now = Date.now();
    sessions[authSha_(token)] = { id: id, at: now, used: now, keep: keep };
    authWrite_(AUTH_PROPS.sessions, authLiveSessions_(sessions));
  });
  return { token: token, id: id, name: user.name, role: user.role, mustChange: !!user.mustChange, keep: keep };
}

// 요청마다 누가 보냈는지 정합니다. 돌려주는 label 이 작업 기록의 「작업자」가 됩니다.
function authorizeRequest_(action, token) {
  if (action === 'login') return { kind: 'login', label: '' };
  if (!token) {
    if (authRequired_() || AUTH_ACCOUNT_ACTIONS.indexOf(action) !== -1) throw authError_();
    return { kind: 'anonymous', label: '로그인 전' };
  }
  if (typeof token !== 'string' || token.length < 32 || token.length > 200) throw authError_();
  const key = authSha_(token), now = Date.now();
  const tools = authRead_(AUTH_PROPS.tools);
  const tool = Object.keys(tools).filter(function(name) { return tools[name] === key; })[0];
  if (tool) {
    if (AUTH_ACCOUNT_ACTIONS.indexOf(action) !== -1) throw authUserError_('도구 키로는 계정을 다룰 수 없습니다.');
    return { kind: 'tool', label: tool + '(도구)' };
  }
  const session = authRead_(AUTH_PROPS.sessions)[key];
  const user = session && authRead_(AUTH_PROPS.users)[session.id];
  if (!user || !authSessionAlive_(session, now)) throw authError_('로그인이 끝났습니다. 다시 로그인해 주세요.');
  if (user.mustChange && ['changePassword', 'logout'].indexOf(action) === -1) {
    const error = authUserError_('처음 받은 비밀번호를 먼저 바꿔 주세요.'); error.mustChange = true; throw error;
  }
  if (AUTH_ADMIN_ACTIONS.indexOf(action) !== -1 && user.role !== 'admin') throw authUserError_('관리자만 할 수 있습니다.');
  if (now - session.used > AUTH_TOUCH_MS) {
    // 하루 한 번 마지막 사용 시각만 고칩니다. 잠금을 못 잡으면 다음 요청으로 미룹니다(로그인과 엇갈려 새 세션을 지우지 않게).
    const lock = LockService.getScriptLock();
    if (lock.tryLock(2000)) {
      try {
        const fresh = authRead_(AUTH_PROPS.sessions);
        if (fresh[key]) { fresh[key].used = now; authWrite_(AUTH_PROPS.sessions, authLiveSessions_(fresh)); }
      } finally { lock.releaseLock(); }
    }
  }
  return { kind: 'session', id: session.id, label: user.name, role: user.role, key: key };
}

// 로그아웃·비밀번호 변경·관리자 계정 관리. 결과의 임시 비밀번호·도구 키는 이 응답에서 한 번만 보여 줍니다.
function authAccountAction_(action, data, who) {
  if (action === 'listUsers') {
    const users = authRead_(AUTH_PROPS.users), tools = authRead_(AUTH_PROPS.tools);
    return {
      users: Object.keys(users).sort().map(function(id) { return { id: id, name: users[id].name, role: users[id].role, mustChange: !!users[id].mustChange }; }),
      tools: AUTH_TOOL_NAMES.map(function(name) { return { name: name, issued: !!tools[name] }; })
    };
  }
  return authWithLock_(function() {
    const users = authRead_(AUTH_PROPS.users), id = String(data.id || '').trim().toLowerCase();
    if (action === 'logout') {
      const sessions = authRead_(AUTH_PROPS.sessions);
      Object.keys(sessions).forEach(function(key) { if (key === who.key || (data.all === true && sessions[key].id === who.id)) delete sessions[key]; });
      authWrite_(AUTH_PROPS.sessions, sessions);
      return { loggedOut: true, all: data.all === true };
    }
    if (action === 'changePassword') {
      const user = users[who.id];
      if (authPasswordHash_(String(data.current || ''), user.salt, user.rounds) !== user.hash) throw authUserError_('지금 비밀번호가 맞지 않습니다.');
      if (data.next === data.current) throw authUserError_('새 비밀번호는 지금 것과 달라야 합니다.');
      authSetPassword_(user, data.next);
      user.mustChange = false;
      authWrite_(AUTH_PROPS.users, users);
      authDropSessionsOf_(who.id, who.key); // 다른 기기 로그인은 끝냅니다
      return { changed: true };
    }
    if (action === 'addUser') {
      const temp = authRandom_(12);
      const newId = authNewUser_(users, data.id, data.name, data.role, temp);
      authWrite_(AUTH_PROPS.users, users);
      return { id: newId, tempPassword: temp };
    }
    if (action === 'issueToolKey') {
      const name = String(data.name || '');
      if (AUTH_TOOL_NAMES.indexOf(name) === -1) throw authUserError_('도구 이름은 ' + AUTH_TOOL_NAMES.join('·') + ' 중 하나입니다.');
      const key = authRandom_(64), tools = authRead_(AUTH_PROPS.tools);
      tools[name] = authSha_(key); // 다시 발급하면 옛 키는 바로 쓸 수 없습니다
      authWrite_(AUTH_PROPS.tools, tools);
      return { name: name, key: key };
    }
    if (!users[id]) throw authUserError_('없는 아이디입니다.');
    if (id === who.id) throw authUserError_('지금 로그인한 계정은 여기서 지우거나 비밀번호를 새로 받을 수 없습니다.');
    if (action === 'deleteUser') {
      delete users[id];
      authWrite_(AUTH_PROPS.users, users);
      authDropSessionsOf_(id);
      return { deleted: id };
    }
    // resetUserPassword
    const temp = authRandom_(12);
    authSetPassword_(users[id], temp);
    users[id].mustChange = true;
    authWrite_(AUTH_PROPS.users, users);
    authDropSessionsOf_(id);
    return { id: id, tempPassword: temp };
  });
}

// 시트 메뉴 「👤 첫 관리자 만들기」. 계정이 하나도 없을 때만 동작합니다. 입력값은 바로 해시로 바꿔 저장합니다.
function createFirstAdmin() {
  const ui = SpreadsheetApp.getUi();
  const ask = function(step, text) {
    const response = ui.prompt('첫 관리자 만들기 (' + step + '/3)', text, ui.ButtonSet.OK_CANCEL);
    return response.getSelectedButton() === ui.Button.OK ? response.getResponseText() : null;
  };
  if (Object.keys(authRead_(AUTH_PROPS.users)).length) return ui.alert('이미 계정이 있습니다. 계정은 헬프데스크 설정 창에서 관리자가 관리합니다.');
  const id = ask(1, '로그인 아이디 (영문 소문자·숫자·. _ - 3~30자)'); if (id === null) return;
  const name = ask(2, '이름 (작업 기록의 작업자로 남습니다)'); if (name === null) return;
  const password = ask(3, '임시 비밀번호 (8자 이상)\n입력 글자가 가려지지 않으니 혼자 있을 때 넣어 주세요. 첫 로그인 때 바꿉니다.'); if (password === null) return;
  try {
    let hashMs = 0;
    authWithLock_(function() {
      const users = authRead_(AUTH_PROPS.users);
      if (Object.keys(users).length) throw authUserError_('이미 계정이 있습니다.');
      const started = Date.now();
      authNewUser_(users, id, name, 'admin', password);
      hashMs = Date.now() - started;
      authWrite_(AUTH_PROPS.users, users);
    });
    ui.alert('관리자 「' + id.trim().toLowerCase() + '」를 만들었습니다.\n비밀번호 처리 시간 ' + hashMs + 'ms (1,000ms 안쪽이면 정상입니다).');
  } catch (error) {
    ui.alert(error.message);
  }
}

// 시트 메뉴 「🔒 로그인 잠금 켜기 / 🔓 끄기」. 스크립트 속성이 50개를 넘으면 편집기 화면이 읽기 전용이 되어
// AUTH_REQUIRED 를 손으로 넣거나 지울 수 없습니다(11-13 확인). 그래서 메뉴로 켜고 끕니다.
function lockLogin() { authSetLock_(true); }
function unlockLogin() { authSetLock_(false); }
function authSetLock_(on) {
  const ui = SpreadsheetApp.getUi();
  const now = '\n(지금: ' + (authRequired_() ? '잠금 켜짐' : '잠금 꺼짐') + ')';
  const question = on ? '로그인 잠금을 켤까요?\n로그인이나 도구 키가 없는 요청은 모두 거절됩니다.' : '로그인 잠금을 끌까요?\n로그인 없이도 요청을 받게 됩니다(되돌리기).';
  if (ui.alert('로그인 잠금', question + now, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const props = PropertiesService.getScriptProperties();
  if (on) props.setProperty(AUTH_PROPS.required, 'Y'); else props.deleteProperty(AUTH_PROPS.required);
  ui.alert(on ? '로그인 잠금을 켰습니다.' : '로그인 잠금을 껐습니다. 로그인 없이도 요청을 받습니다.');
}

// 작업 기록: 쓰기가 성공할 때마다 「작업 기록」 시트에 한 줄. 이슈 시트 열은 건드리지 않습니다.
const WORK_LOG_SHEET_NAME = '작업 기록';
const WORK_LOG_ACTIONS = {
  addIssue: '등록', insertIssue: '중간 등록', updateIssue: '수정', updateStatus: '상태 변경', updateHidden: '숨김',
  saveDevelopers: '담당자 설정', applyJiraSync: 'Jira 싱크 적용', setJiraSyncExcluded: 'Jira 싱크 제외', setCaptureConfirmed: '누락 점검 확인',
  addBlogPostPlan: '블로그 일정 추가', updateBlogPostStatus: '블로그 상태', updateBlogPostUrl: '블로그 주소', deleteBlogPostPlan: '블로그 일정 삭제',
  migrateBlogPostingSheet: '블로그 시트 이전', addUser: '계정 추가', deleteUser: '계정 삭제', resetUserPassword: '임시 비밀번호 발급',
  issueToolKey: '도구 키 발급', changePassword: '비밀번호 변경'
};
function appendWorkLog_(who, action, data, result) {
  const label = WORK_LOG_ACTIONS[action];
  if (!label) return;
  try {
    data = data || {}; result = result || {};
    // 비밀번호·키·본문은 남기지 않습니다. 대상과 상태값만 남깁니다.
    const target = data.id || result.id || data.name || (data.row ? data.row + '행' : '');
    const detail = data.status || (data.hiddenYn !== undefined ? (data.hiddenYn === 'Y' ? '숨김' : '숨김 해제') : '') ||
      (action === 'addIssue' || action === 'insertIssue' ? String(data.title || '').slice(0, 60) : '');
    const spreadsheet = getSpreadsheet();
    let sheet = spreadsheet.getSheetByName(WORK_LOG_SHEET_NAME);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(WORK_LOG_SHEET_NAME);
      sheet.appendRow(['일시', '작업자', '작업', '대상', '내용']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'), who.label, label, String(target), String(detail)]);
  } catch (error) {
    // 작업은 이미 저장됐습니다. 기록 실패로 저장 결과를 실패로 바꾸지 않습니다.
    console.log('work log failed: ' + action);
  }
}
