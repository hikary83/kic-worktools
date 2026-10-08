const CONFIG = {
  // 배포된 Google Apps Script 웹앱 URL을 이곳에 입력하세요.
  // 예: "https://script.google.com/macros/s/AKfycb.../exec"
  API_URL: "https://script.google.com/macros/s/AKfycbyjbf1M5XTqdW203XQWUdwO1Y9qgu1rG_WqiWX0LVgJNEEldw4gMOf6_tGfXGxc6ABQnA/exec",

  // Jira 일정 전용 Apps Script 배포 URL입니다. 기존 업무 API와 분리해 사용합니다.
  JIRA_TIMELINE_API_URL: "https://script.google.com/macros/s/AKfycbxncJs9huZd1ENzETRxRyKO5ikexxscHptSYGE6LIXsWP1DFDEn1Zmodk0H7vE8EuDR/exec",

  // 추후 비밀번호 로그인이 필요할 경우 true로 변경하고 비밀번호를 설정하세요.
  USE_PASSWORD_PROTECTION: false,
  PASSWORD: "kic21_password"
};

// 화면에 표시하는 오류에는 인증 키/토큰을 남기지 않습니다. 요청 본문과 이미지는 기록하지 않습니다.
function cleanGASApiErrorDetail(value) {
  return String(value || '')
    .replace(/([?&](?:key|api_key|apikey|access_token|token)=)[^&\s]+/gi, '$1[숨김]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [숨김]')
    .replace(/(["']?(?:api[_ -]?key|access[_ -]?token)["']?\s*[=:]\s*["']?)[^"'\s,;}\]]+/gi, '$1[숨김]')
    .replace(/(["']?Authorization["']?\s*[:=]\s*["']?)(?:Basic\s+)?[^"'\r\n,;}]+/gi, '$1[숨김]')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, '[숨김]')
    .trim()
    .slice(0, 700);
}

function createGASApiError(message, code, httpStatus) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

// 진단 기록은 최대 40건/24시간 보관합니다. 본문·이미지·직원 이름·오류 원문은 저장하지 않습니다.
const GAS_DIAGNOSTIC_KEY = 'kic_api_diagnostics_v1';
const GAS_DIAGNOSTIC_ACTIONS = new Set(['getDashboardData', 'getDevelopers', 'saveDevelopers', 'getBlogPostPlans', 'analyzeCapture', 'generateReply', 'addIssue', 'updateIssue', 'updateStatus', 'updateHidden', 'previewJiraSync', 'lookupJiraSync', 'applyJiraSync', 'setJiraSyncExcluded', 'generateGeminiReport', 'generateBlogContent', 'generateBlogAssets', 'generateBlogMoreAssets', 'generateBlogImage', 'updateBlogPostStatus', 'updateBlogPostUrl', 'deleteBlogPostPlan', 'addBlogPostPlan', 'migrateBlogPostingSheet']);
const GAS_WRITE_ACTIONS = new Set(['addIssue', 'updateIssue', 'updateStatus', 'updateHidden', 'saveDevelopers', 'applyJiraSync', 'setJiraSyncExcluded', 'updateBlogPostStatus', 'updateBlogPostUrl', 'deleteBlogPostPlan', 'addBlogPostPlan', 'migrateBlogPostingSheet']);
let gasDiagnosticRecords = [];

function safeGASResponseAddress(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    // Google 응답의 일회성 키는 쿼리 문자열에 있습니다. 다른 주소는 경로도 보관하지 않습니다.
    const path = ['script.google.com', 'script.googleusercontent.com'].includes(url.hostname) && /^\/macros\/(?:echo|s\/[A-Za-z0-9_-]+\/(?:exec|dev))$/.test(url.pathname) ? url.pathname : '';
    return url.origin + path;
  } catch (_) { return ''; }
}

function safeGASDiagnosticToken(value) {
  return /^[A-Za-z0-9_.-]{1,80}$/.test(String(value || '')) ? String(value) : '';
}

function safeGASCaptureDiagnostic(value) {
  if (!value || value.task !== 'capture' || !Array.isArray(value.attempts)) return null;
  const codes = ['OK', 'AI_HTTP_ERROR', 'AI_INVALID_API_KEY', 'AI_AUTH_ERROR', 'AI_RESPONSE_TRUNCATED', 'AI_EMPTY_RESPONSE', 'AI_INVALID_API_RESPONSE', 'AI_INVALID_JSON', 'AI_REQUEST_ERROR', 'AI_TIMEOUT'];
  const apiStatuses = ['INVALID_ARGUMENT', 'RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'NOT_FOUND', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'INTERNAL', 'DEADLINE_EXCEEDED', 'UNKNOWN'];
  const time = n => Number.isFinite(n) && n >= 0 ? Math.min(n, 3600000) : null;
  const attempts = value.attempts.slice(0, 8).filter(item => item && typeof item.model === 'string' && /^gemini-\d+(?:\.\d+)?-(?:flash(?:-lite)?|pro)$/.test(item.model)).map(item => {
    const code = codes.includes(item.code) && (item.code !== 'OK' || item.outcome === 'success') ? item.code : 'AI_REQUEST_ERROR';
    const httpStatus = Number.isInteger(item.httpStatus) && item.httpStatus >= 100 && item.httpStatus <= 599 ? item.httpStatus : null;
    return { model: item.model, elapsedMs: time(item.elapsedMs), upstreamMs: time(item.upstreamMs), httpStatus,
      outcome: item.outcome === 'success' && code === 'OK' ? 'success' : 'failure', code,
      // 이유는 허용된 코드로 새로 작성합니다. 외부 오류 원문이나 임의 문자열은 저장하지 않습니다.
      reason: getGASCaptureFailureReason(code, httpStatus),
      apiStatus: apiStatuses.includes(item.apiStatus) ? item.apiStatus : '',
      finishReason: ['STOP', 'MAX_TOKENS'].includes(item.finishReason) ? item.finishReason : '' };
  });
  const selected = attempts.find(item => item.outcome === 'success');
  return { task: 'capture', selectedModel: selected ? selected.model : '', attemptCount: attempts.length,
    fallbackUsed: attempts.length > 1,
    totalElapsedMs: Math.min(attempts.reduce((total, item) => total + (item.elapsedMs || 0), 0), 3600000), attempts };
}

function getGASCaptureFailureReason(code, httpStatus) {
  if (code === 'AI_HTTP_ERROR') {
    if (httpStatus === 429) return '호출 한도 초과(HTTP 429)';
    if (httpStatus === 503) return '외부 API 일시 오류(HTTP 503)';
    return httpStatus ? '외부 API 오류(HTTP ' + httpStatus + ')' : '외부 API 오류';
  }
  return { OK: '완료', AI_INVALID_API_KEY: 'API 키 인증 실패', AI_AUTH_ERROR: '인증/접근 권한 오류',
    AI_RESPONSE_TRUNCATED: '출력 길이 제한으로 응답 잘림', AI_EMPTY_RESPONSE: '분석 응답 비어 있음',
    AI_INVALID_API_RESPONSE: '외부 API 응답 형식 오류', AI_INVALID_JSON: '분석 결과 JSON 해석 실패',
    AI_REQUEST_ERROR: '외부 API 호출/응답 처리 예외', AI_TIMEOUT: '외부 API 호출 시간초과' }[code] || '원인 미확인';
}

function safeGASServerDiagnostic(value) {
  if (!value || value.schema !== 1 || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0) return null;
  const safe = {
    requestId: /^kic-[a-z0-9-]{10,70}$/.test(value.requestId) ? value.requestId : '',
    method: ['POST', 'GET'].includes(value.method) ? value.method : '',
    elapsedMs: Math.min(value.elapsedMs, 3600000),
    stage: safeGASDiagnosticToken(value.stage),
    writeStarted: typeof value.writeStarted === 'boolean' ? value.writeStarted : null,
    stages: (Array.isArray(value.stages) ? value.stages : []).slice(0, 20).map(item => ({
      stage: safeGASDiagnosticToken(item && item.stage),
      elapsedMs: Number.isFinite(item && item.elapsedMs) ? Math.max(0, Math.min(item.elapsedMs, 3600000)) : 0
    }))
  };
  const ai = safeGASCaptureDiagnostic(value.ai);
  if (ai) safe.ai = ai;
  return safe;
}

function sanitizeGASDiagnostic(record) {
  if (!record || !/^kic-[a-z0-9-]{10,70}$/.test(record.requestId) || !Number.isFinite(Date.parse(record.startedAt))) return null;
  const number = value => Number.isFinite(value) ? Math.max(0, Math.min(value, 3600000)) : null;
  return {
    requestId: record.requestId, startedAt: new Date(record.startedAt).toISOString(),
    action: GAS_DIAGNOSTIC_ACTIONS.has(record.action) ? record.action : 'unknown',
    method: record.method === 'GET' ? 'GET' : 'POST',
    outcome: record.outcome === 'success' ? 'success' : 'failure',
    code: safeGASDiagnosticToken(record.code) || 'UNKNOWN',
    stage: safeGASDiagnosticToken(record.stage),
    httpStatus: Number.isInteger(record.httpStatus) && record.httpStatus >= 100 && record.httpStatus <= 599 ? record.httpStatus : null,
    elapsedMs: number(record.elapsedMs), responseWaitMs: number(record.responseWaitMs), bodyReadMs: number(record.bodyReadMs),
    requestChars: Number.isInteger(record.requestChars) ? Math.max(0, Math.min(record.requestChars, 20000000)) : null,
    responseChars: Number.isInteger(record.responseChars) ? Math.max(0, Math.min(record.responseChars, 20000000)) : null,
    redirected: record.redirected === true,
    responseAddress: safeGASResponseAddress(record.responseAddress),
    responseFormat: ['json', 'html', 'text', 'empty', 'unread'].includes(record.responseFormat) ? record.responseFormat : 'unread',
    server: safeGASServerDiagnostic(record.server && { ...record.server, schema: 1 })
  };
}

function getGASDiagnostics() {
  const cutoff = Date.now() - 86400000;
  return gasDiagnosticRecords.filter(item => Date.parse(item.startedAt) >= cutoff).slice(-40).map(item => JSON.parse(JSON.stringify(item)));
}

try {
  const saved = JSON.parse(localStorage.getItem(GAS_DIAGNOSTIC_KEY) || '[]');
  gasDiagnosticRecords = (Array.isArray(saved) ? saved : []).map(sanitizeGASDiagnostic).filter(Boolean);
  gasDiagnosticRecords = getGASDiagnostics();
} catch (_) { /* 저장 제한/손상된 기록은 API 요청에 영향을 주지 않습니다. */ }

async function copyGASDiagnostics() {
  const text = JSON.stringify({ version: 'v2.8.9', copiedAt: new Date().toISOString(), records: getGASDiagnostics() }, null, 2);
  await navigator.clipboard.writeText(text);
}

function showGASDiagnosticNotice(record) {
  if (typeof document === 'undefined' || !document.body) return;
  let panel = document.getElementById('kic-api-diagnostic-notice');
  if (!panel) {
    panel = document.createElement('aside');
    panel.id = 'kic-api-diagnostic-notice';
    panel.setAttribute('aria-label', '요청 진단 로그');
    panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:100000;box-sizing:border-box;max-width:min(430px,calc(100vw - 32px));padding:14px;border:1px solid #64748b;border-radius:12px;background:#1e293b;color:#fff;box-shadow:0 8px 28px #0005;font:13px/1.5 sans-serif;';
    panel.innerHTML = '<div data-summary role="status"></div><div data-note style="color:#cbd5e1;margin-top:4px"></div><div data-ai hidden style="white-space:pre-line;overflow-wrap:anywhere;color:#cbd5e1;margin-top:7px;font-size:12px"></div><div style="display:flex;gap:8px;margin-top:10px"><button type="button" data-copy style="padding:6px 12px;border:1px solid #94a3b8;border-radius:7px;cursor:pointer">진단 로그 복사</button><button type="button" data-close style="padding:6px 12px;border:1px solid #94a3b8;border-radius:7px;cursor:pointer">닫기</button></div>';
    panel.querySelector('[data-copy]').onclick = async function () {
      try { await copyGASDiagnostics(); this.textContent = '복사 완료'; }
      catch (_) { this.textContent = '복사 권한을 확인해 주세요'; }
    };
    panel.querySelector('[data-close]').onclick = () => { panel.hidden = true; };
    document.body.appendChild(panel);
  }
  const names = { addIssue: '신규 등록', updateIssue: '이슈 수정', analyzeCapture: '캡처 분석', generateReply: '답변 생성', getDashboardData: '목록 조회' };
  const failed = record.outcome === 'failure';
  panel.querySelector('[data-summary]').textContent = (names[record.action] || '서버 요청') + (failed ? ' 실패' : ' 지연 후 완료') + ' · ' + (record.httpStatus ? 'HTTP ' + record.httpStatus + ' · ' : '') + (record.elapsedMs / 1000).toFixed(1) + '초';
  panel.querySelector('[data-note]').textContent = failed && GAS_WRITE_ACTIONS.has(record.action) ? '응답 실패만으로 저장 여부를 단정할 수 없습니다. 목록을 확인한 뒤 다시 시도해 주세요.' : '로그를 복사해 보내주면 실패 단계와 지연 시간을 확인할 수 있어요.';
  const ai = record.action === 'analyzeCapture' ? safeGASCaptureDiagnostic(record.server && record.server.ai) : null;
  const aiInfo = panel.querySelector('[data-ai]');
  aiInfo.hidden = !ai;
  aiInfo.textContent = ai ? (ai.selectedModel ? '사용 모델: ' + ai.selectedModel : '분석 성공 모델 없음')
    + ' · ' + (ai.attemptCount === 0 ? '모델 호출 없음' : ai.fallbackUsed ? '모델 전환 ' + (ai.attemptCount - 1) + '회' : '모델 전환 없음')
    + '\n' + ai.attempts.map(item => item.model + ' · ' + (item.elapsedMs === null ? '시간 미확인' : (item.elapsedMs / 1000).toFixed(1) + '초') + ' · ' + item.reason).join('\n') : '';
  panel.querySelector('[data-copy]').textContent = '진단 로그 복사';
  panel.hidden = false;
}

function recordGASDiagnostic(record, notify = true) {
  // 진단 자체의 오류 때문에 성공한 저장을 실패로 표시하지 않습니다.
  try {
    const safe = sanitizeGASDiagnostic(record);
    if (!safe) return;
    gasDiagnosticRecords.push(safe);
    gasDiagnosticRecords = getGASDiagnostics();
    try { localStorage.setItem(GAS_DIAGNOSTIC_KEY, JSON.stringify(gasDiagnosticRecords)); } catch (_) {}
    if (safe.outcome === 'failure') console.warn('GAS API diagnostic:', safe);
    if (notify && (safe.outcome === 'failure' || safe.elapsedMs >= 10000)) showGASDiagnosticNotice(safe);
  } catch (_) {}
}

function getGASApiFailure(result, httpStatus) {
  const serverError = result && result.error;
  const detail = cleanGASApiErrorDetail(
    (typeof serverError === 'string' ? serverError : serverError && serverError.message) ||
    (result && result.message) || ''
  );
  const serverCode = (result && result.code) || (serverError && serverError.code);
  if (serverCode === 'ISSUE_LOCK_WAIT_FAILED') {
    return createGASApiError('다른 저장 작업을 기다리다가 등록 잠금 대기에서 실패했습니다. 목록에서 등록 여부를 먼저 확인해 주세요.', 'ISSUE_LOCK_WAIT_FAILED', httpStatus);
  }
  // これはタイムアウトの証拠ではありません。想定した機能の応答ではなかったことだけを伝えます。
  if (serverCode === 'API_INFO_RESPONSE' || /KIC API Server is running/i.test(detail)) {
    return createGASApiError('요청한 기능의 결과 대신 서버 안내 응답을 받았습니다. 정상 처리 여부를 확인하지 못했습니다. [API_INFO_RESPONSE]', 'API_INFO_RESPONSE', httpStatus);
  }

  let summary = '';
  let code = 'API_EXECUTION_ERROR';
  if (/\bHTTP\s*429\b|RESOURCE_EXHAUSTED/i.test(detail) || Number(serverCode) === 429) {
    summary = '외부 서비스 호출 한도 초과(429). 잠시 후 다시 시도하거나 사용량 한도를 확인해 주세요.';
    code = 'UPSTREAM_RATE_LIMIT';
  } else if (/\bHTTP\s*503\b/i.test(detail) || /\bUNAVAILABLE\b/.test(detail) || Number(serverCode) === 503) {
    summary = '외부 서비스 일시 오류(503). 잠시 후 다시 시도해 주세요.';
    code = 'UPSTREAM_UNAVAILABLE';
  } else if (/Gemini API 키|인증 오류|\bHTTP\s*(?:401|403)\b/i.test(detail) || [401, 403].includes(Number(serverCode))) {
    summary = '외부 서비스 인증 또는 접근 권한 오류입니다. 연결 설정을 확인해 주세요.';
    code = 'UPSTREAM_AUTH_ERROR';
  }
  if (detail || summary) {
    return createGASApiError(summary ? summary + (detail ? '\n상세: ' + detail : '') : detail, code, httpStatus);
  }
  return createGASApiError('서버가 성공 결과나 상세 오류를 보내지 않았습니다. 원인을 확인하지 못했습니다. [API_ERROR_NO_DETAILS]', 'API_ERROR_NO_DETAILS', httpStatus);
}

async function readGASApiResponse(response, diagnostic) {
  const bodyStartedAt = Date.now();
  if (diagnostic) diagnostic.stage = 'response_body';
  const rawText = await response.text();
  if (diagnostic) {
    diagnostic.bodyReadMs = Date.now() - bodyStartedAt;
    diagnostic.responseChars = rawText.length;
    diagnostic.stage = 'response_parse';
    diagnostic.responseFormat = !rawText.trim() ? 'empty' : /^\s*</.test(rawText) ? 'html' : 'text';
  }
  let result;
  try {
    result = JSON.parse(rawText);
    if (diagnostic) {
      diagnostic.responseFormat = 'json';
      diagnostic.server = safeGASServerDiagnostic(result && result.diagnostics);
    }
  } catch (error) {
    if (response.ok) {
      throw createGASApiError('서버에서 JSON 대신 빈 응답 또는 다른 형식의 응답을 받았습니다. [API_INVALID_RESPONSE]', 'API_INVALID_RESPONSE', response.status);
    }
  }
  if (!response.ok) {
    const detail = cleanGASApiErrorDetail(result && (typeof result.error === 'string' ? result.error : result.error && result.error.message) || result && result.message);
    throw createGASApiError('요청 서버 통신 오류(HTTP ' + response.status + ').' + (detail ? '\n상세: ' + detail : ''), 'API_HTTP_ERROR', response.status);
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw createGASApiError('서버 응답 구조가 올바르지 않습니다. [API_INVALID_RESPONSE]', 'API_INVALID_RESPONSE', response.status);
  }
  if (diagnostic) diagnostic.stage = 'server_result';
  if (result.success !== true) throw getGASApiFailure(result, response.status);
  if (diagnostic && diagnostic.action === 'getDashboardData') {
    const server = diagnostic.server;
    if (server && (server.requestId !== diagnostic.requestId || server.method !== diagnostic.method)) {
      throw createGASApiError('목록 조회와 다른 요청의 응답을 받았습니다. [API_REQUEST_MISMATCH]', 'API_REQUEST_MISMATCH', response.status);
    }
    const data = result.data;
    if (!data || !Array.isArray(data.pendingCurrent) || !Array.isArray(data.completedCurrent)) {
      throw createGASApiError('목록 데이터가 없는 응답을 받았습니다. [API_INVALID_RESPONSE]', 'API_INVALID_RESPONSE', response.status);
    }
  }
  return result.data;
}

const GAS_DASHBOARD_READ_TIMEOUT_MS = 20000;

function isDashboardReadRetryable(error) {
  return ['API_READ_TIMEOUT', 'API_NETWORK_ERROR', 'API_INFO_RESPONSE', 'API_INVALID_RESPONSE', 'API_REQUEST_MISMATCH'].includes(error.code)
    || (error.code === 'API_HTTP_ERROR' && ([404, 408, 429].includes(error.httpStatus) || error.httpStatus >= 500));
}

async function performGASRequest(action, data, method, requestId, policy = {}) {
  const started = Date.now();
  const diagnostic = { requestId, action, method, startedAt: new Date(started).toISOString(), stage: 'request_send', responseFormat: 'unread' };
  let timeout;
  try {
    const url = new URL(CONFIG.API_URL);
    if (method === 'GET') {
      url.searchParams.set('action', action);
      url.searchParams.set('requestId', requestId);
      if (action === 'getDashboardData') {
        ['startDate', 'endDate'].forEach(key => {
          if (typeof data[key] === 'string') url.searchParams.set(key, data[key]);
        });
      }
    }
    const options = method === 'GET' ? { method: 'GET' } : {
      method: 'POST', mode: 'cors', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, data, requestId })
    };
    const controller = policy.timeoutMs ? new AbortController() : null;
    if (controller) {
      options.signal = controller.signal;
      options.cache = 'no-store';
    }
    diagnostic.requestChars = options.body ? options.body.length : 0;
    const request = (async () => {
      const response = await fetch(url.href, options);
      Object.assign(diagnostic, { responseWaitMs: Date.now() - started, httpStatus: response.status, redirected: response.redirected, responseAddress: response.url, stage: 'response_headers' });
      return readGASApiResponse(response, diagnostic);
    })();
    // 목록 조회만 대기를 제한합니다. 브라우저 중단이 서버 작업 중단을 보장하지는 않습니다.
    const result = controller ? await Promise.race([request, new Promise((_, reject) => {
      timeout = setTimeout(() => {
        reject(createGASApiError('목록 조회 응답을 20초 동안 받지 못했습니다. [API_READ_TIMEOUT]', 'API_READ_TIMEOUT', diagnostic.httpStatus));
        controller.abort();
      }, policy.timeoutMs);
    })]) : await request;
    recordGASDiagnostic({ ...diagnostic, elapsedMs: Date.now() - started, outcome: 'success', code: 'OK', stage: 'complete' }, policy.notify !== false);
    return result;
  } catch (error) {
    if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
      error = createGASApiError('네트워크 연결 또는 브라우저 접근 정책 때문에 서버 응답을 받지 못했습니다. [API_NETWORK_ERROR]', 'API_NETWORK_ERROR', diagnostic.httpStatus);
    }
    const failure = { ...diagnostic, elapsedMs: Date.now() - started, outcome: 'failure', code: error.code || 'UNKNOWN' };
    recordGASDiagnostic(failure, policy.notify !== false);
    error.diagnostics = sanitizeGASDiagnostic(failure);
    // 원래 상세 메시지는 유지하고, 복사 가능한 진단은 별도로 제공합니다.
    error.requestId = requestId;
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

// API 요청을 처리하는 공통 비동기 함수
async function callGASApi(action, data = {}, options = {}) {
  if (!CONFIG.API_URL) {
    alert("구글 Apps Script 웹앱 URL(API_URL)이 설정되지 않았습니다. js/config.js 파일에서 설정해 주세요.");
    throw new Error("API_URL is missing");
  }

  // 비밀번호 인증 옵션이 켜져 있을 때 검증 (비밀번호 미일치 시 요청 차단)
  if (CONFIG.USE_PASSWORD_PROTECTION) {
    const savedPassword = localStorage.getItem("kic_access_password");
    if (savedPassword !== CONFIG.PASSWORD) {
      const input = prompt("사내 업무도구 접근을 위해 패스코드를 입력해 주세요:");
      if (input === CONFIG.PASSWORD) {
        localStorage.setItem("kic_access_password", input);
      } else {
        alert("올바르지 않은 패스코드입니다.");
        throw new Error("Unauthorized access");
      }
    }
  }

  // CORS 프리플라이트를 피하기 위해 text/plain 타입의 POST Simple Request로 전송합니다.
  const requestId = 'kic-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14));

  if (action === 'getDashboardData') {
    // GET으로 조회 조건을 명시하고, 일시 오류에 한해서만 POST로 한 번 재조회합니다.
    try {
      return await performGASRequest(action, data, 'GET', requestId, { timeoutMs: GAS_DASHBOARD_READ_TIMEOUT_MS, notify: false });
    } catch (error) {
      if (!isDashboardReadRetryable(error)) {
        try { showGASDiagnosticNotice(error.diagnostics); } catch (_) {}
        throw error;
      }
      try { if (typeof options.onRetry === 'function') options.onRetry(error); } catch (_) {}
      return performGASRequest(action, data, 'POST', requestId, { timeoutMs: GAS_DASHBOARD_READ_TIMEOUT_MS });
    }
  }
  
  try {
    return await performGASRequest(action, data, 'POST', requestId);
  } catch (error) {
    // GET 재시도는 doGet이 같은 결과를 주는 단순 조회만 합니다. 분석·저장·싱크는 재시도하지 않습니다.
    if (!['getDevelopers', 'getBlogPostPlans'].includes(action)) throw error;
    
    // 단순 조회 작업(getBlogPostPlans 등)의 경우 GET 쿼리스트링으로 안전하게 2차 시도
    try {
      return await performGASRequest(action, data, 'GET', requestId);
    } catch (fallbackError) {
      // 두 번의 조회 결과가 모두 진단 기록에 남습니다. 기존 최초 오류 반환 방식은 유지합니다.
    }
    throw error;
  }
}
