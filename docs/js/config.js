const CONFIG = {
  // 배포된 Google Apps Script 웹앱 URL을 이곳에 입력하세요.
  // 예: "https://script.google.com/macros/s/AKfycb.../exec"
  API_URL: "https://script.google.com/macros/s/AKfycbwTt3i7gNR3Zfrs5W7-KJr6136Oz5V_HSP8-nfNO0q4rL0iVVbPQKFH5mD64k9XrclOpQ/exec",

  // 추후 비밀번호 로그인이 필요할 경우 true로 변경하고 비밀번호를 설정하세요.
  USE_PASSWORD_PROTECTION: false,
  PASSWORD: "kic21_password"
};

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

    if (!response.ok) {
      throw new Error(`HTTP Error Status: ${response.status}`);
    }

    const rawText = await response.text();
    const result = JSON.parse(rawText);
    if (!result.success) {
      throw new Error(result.error || "API execution failed");
    }

    return result.data;
  } catch (error) {
    console.error("GAS API Call failed:", error);
    throw error;
  }
}
