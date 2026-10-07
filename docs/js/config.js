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

function getGASApiFailure(result, httpStatus) {
  const serverError = result && result.error;
  const detail = cleanGASApiErrorDetail(
    (typeof serverError === 'string' ? serverError : serverError && serverError.message) ||
    (result && result.message) || ''
  );
  const serverCode = (result && result.code) || (serverError && serverError.code);
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

async function readGASApiResponse(response) {
  const rawText = await response.text();
  let result;
  try { result = JSON.parse(rawText); } catch (error) {
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
  if (result.success !== true) throw getGASApiFailure(result, response.status);
  return result.data;
}

// API 요청을 처리하는 공통 비동기 함수
async function callGASApi(action, data = {}) {
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
  const payload = { action: action, data: data };
  
  try {
    const response = await fetch(CONFIG.API_URL, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "text/plain"
      },
      body: JSON.stringify(payload)
    });

    return await readGASApiResponse(response);
  } catch (error) {
    if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
      error = createGASApiError('네트워크 연결 또는 브라우저 접근 정책 때문에 서버 응답을 받지 못했습니다. [API_NETWORK_ERROR]', 'API_NETWORK_ERROR');
    }
    console.warn('GAS API request failed:', { action, code: error.code || 'UNKNOWN', httpStatus: error.httpStatus });
    // GET 재시도는 doGet이 같은 결과를 주는 단순 조회만 합니다. 분석·저장·싱크는 재시도하지 않습니다.
    if (!['getDashboardData', 'getDevelopers', 'getBlogPostPlans'].includes(action)) throw error;
    console.warn("POST call failed, trying GET fallback for:", action, error);
    
    // 단순 조회 작업(getBlogPostPlans 등)의 경우 GET 쿼리스트링으로 안전하게 2차 시도
    try {
      const getUrl = `${CONFIG.API_URL}?action=${encodeURIComponent(action)}`;
      const getResponse = await fetch(getUrl, { method: "GET" });
      return await readGASApiResponse(getResponse);
    } catch (fallbackError) {
      console.error("GET Fallback also failed:", fallbackError);
    }

    console.error("GAS API Call completely failed:", error);
    throw error;
  }
}
