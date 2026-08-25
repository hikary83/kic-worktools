/* ==========================================
   ⚙️ 공통 환경 설정 (전역 변수)
   ========================================== */
const START_ROW = 3; 
const TIMEZONE = "Asia/Seoul";
const DATE_FORMAT_ID = "yyMMdd";
const NUMBER_FORMAT_DT = "yyyy-mm-dd hh:mm:ss";

// Gemini API 설정
const GEMINI_API_KEY_PROPERTY = "GEMINI_API_KEY";
const GEMINI_API_VERSION = "v1beta";
const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite"
];
const GEMINI_MAX_CONTINUATION_COUNT = 2;

// [업데이트] 담당 개발자 리스트 저장소 키
const DEV_LIST_PROPERTY = "DEV_LIST_DATA";

// [v15 성능 개선] 이슈 ID 일자별 마지막 순번 캐시 키
const ISSUE_SEQ_PROPERTY_PREFIX = "HELPDESK_ISSUE_SEQ_";

// [v16.8] 헬프데스크 답변은 수정 전 품질/구성을 복원하고 Flash 모델을 우선 사용합니다.
const GEMINI_REPLY_MODELS = [
  "gemini-2.5-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash-lite"
];

// [v16.10.2] 게시판 캡처 자동 이관은 최신 저지연 Lite 모델을 우선 사용합니다.
const GEMINI_CAPTURE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.5-flash"
];

// 원문/첨부 링크 저장 컬럼(P열), 지라 링크 저장 컬럼(Q열), 숨김 여부 저장 컬럼(R열), Jira 일감 연동 여부 저장 컬럼(S열)
const SOURCE_LINK_COLUMN = 16;
const SOURCE_LINK_HEADER = "원문/첨부 링크";
const JIRA_LINK_COLUMN = 17;
const JIRA_LINK_HEADER = "지라 링크";
const HIDDEN_FLAG_COLUMN = 18;
const HIDDEN_FLAG_HEADER = "숨김 여부";
const JIRA_LINKED_COLUMN = 19;
const JIRA_LINKED_HEADER = "Jira 일감 연동";

// 분기요청 시트 설정: 기존 이슈사항과 동일한 컬럼 구조(A~Q)를 사용합니다.
const QUARTER_REQUEST_SHEET_NAME = "분기요청";
const SOURCE_TYPE_HELPDESK = "helpdesk";
const SOURCE_TYPE_QUARTER = "quarter";

/* ==========================================
   👨‍💻 담당 개발자 관리 로직 (Property Service)
   ========================================== */
function getDevelopers() {
  const props = PropertiesService.getScriptProperties();
  const data = props.getProperty(DEV_LIST_PROPERTY);
  
  if (data) {
    return JSON.parse(data);
  } else {
    // 최초 실행 시 기존 하드코딩 데이터를 초기값으로 세팅
    const initialDevs = [
      {name: "이광희", email: "hikary@kic21.co.kr"},
      {name: "박진희", email: "asd615kr@kic21.co.kr"},
      {name: "고세종", email: "sjong@kic21.co.kr"},
      {name: "이가은", email: "kaeun0320@kic21.co.kr"},
      {name: "권순길", email: "sgkwon@kic21.co.kr"},
      {name: "안태민", email: "zlxl804@kic21.co.kr"}
    ];
    props.setProperty(DEV_LIST_PROPERTY, JSON.stringify(initialDevs));
    return initialDevs;
  }
}

function saveDevelopers(devList) {
  PropertiesService.getScriptProperties().setProperty(DEV_LIST_PROPERTY, JSON.stringify(devList));
  return true;
}

function ensureLinkColumns(sheet) {
  if (!sheet) return;
  if (sheet.getMaxColumns() < JIRA_LINKED_COLUMN) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), JIRA_LINKED_COLUMN - sheet.getMaxColumns());
  }

  const width = JIRA_LINKED_COLUMN - SOURCE_LINK_COLUMN + 1;
  const headerRange = sheet.getRange(2, SOURCE_LINK_COLUMN, 1, width);
  const headers = headerRange.getValues()[0];
  const expected = [SOURCE_LINK_HEADER, JIRA_LINK_HEADER, HIDDEN_FLAG_HEADER, JIRA_LINKED_HEADER];
  let changed = false;

  for (let i = 0; i < expected.length; i++) {
    if (!headers[i]) {
      headers[i] = expected[i];
      changed = true;
    }
  }

  if (changed) headerRange.setValues([headers]);
}

/*
 * [핵심 해결 포인트] 진짜 데이터가 있는 시트 탭을 자동 탐지합니다.
 */
function getMainSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targetNames = ["이슈사항", "시트1", "데이터"];
  for (let name of targetNames) {
    let sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() >= 3) return sheet;
  }
  const sheets = ss.getSheets();
  for (let sheet of sheets) {
    if (sheet.getLastRow() >= 3 && sheet.getRange("B2").getValue() === "지사") return sheet;
  }
  return sheets[0];
}

function getQuarterRequestSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(QUARTER_REQUEST_SHEET_NAME);
}

function normalizeIssueStatus(status) {
  return status ? status.toString().trim() : "접수대기";
}

function isHiddenFlagValue(value) {
  const normalized = value === null || value === undefined ? "" : value.toString().trim().toUpperCase();
  return normalized === "Y" || normalized === "TRUE" || normalized === "숨김" || normalized === "1";
}

function isJiraLinkedFlagValue(value) {
  const normalized = value === null || value === undefined ? "" : value.toString().trim().toUpperCase();
  return normalized === "Y" || normalized === "TRUE" || normalized === "연동" || normalized === "완료" || normalized === "등록완료" || normalized === "1";
}

function buildDashboardIssueObject(row, sourceType) {
  const receiptDateRaw = row[2];
  const receiptDate = receiptDateRaw instanceof Date ? receiptDateRaw : new Date(receiptDateRaw || new Date());
  const status = normalizeIssueStatus(row[11]);
  const sourceLabel = sourceType === SOURCE_TYPE_QUARTER ? "분기" : "헬프";

  return {
    id: row[0].toString().trim(),
    sourceType: sourceType || SOURCE_TYPE_HELPDESK,
    sourceLabel: sourceLabel,
    date: Utilities.formatDate(receiptDate, TIMEZONE, "yyyy-MM-dd HH:mm"),
    branch: row[1] || '-',
    requester: sanitizeString(row[3]),
    system: row[4] || '-',
    type: row[5] || '-',
    priority: row[6] || '보통',
    menu: sanitizeString(row[7]),
    title: sanitizeString(row[8]),
    details: sanitizeString(row[9]),
    dev: row[10] || '',
    status: status,
    actionContent: sanitizeString(row[13]),
    remark: sanitizeString(row[14]),
    sourceLink: sanitizeString(row[15]),
    jiraLink: sanitizeString(row[16]),
    hiddenFlag: isHiddenFlagValue(row[17]) ? "Y" : "",
    isHidden: isHiddenFlagValue(row[17]),
    jiraLinkedFlag: isJiraLinkedFlagValue(row[18]) ? "Y" : "",
    jiraLinked: isJiraLinkedFlagValue(row[18]) ? "Y" : ""
  };
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 KIC 헬프데스크')
    .addItem('📝 최상단에 새 이슈 입력칸 만들기', 'insertNewIssueRow')
    .addSeparator()
    .addItem('🔐 Gemini API 키 설정', 'setGeminiApiKey')
    .addItem('🧪 Gemini 연결 테스트', 'testGeminiConnection')
    .addToUi();
}

function insertNewIssueRow() {
  const sheet = getMainSheet();
  sheet.insertRowBefore(3); 
  sheet.getRange(3, 2).activate(); 
}

function handleEdit(e) {
  if (!e) return;
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== getMainSheet().getName()) return;

  const range = e.range;
  const editedColumn = range.getColumn();
  const editedRow = range.getRow();
  const newValue = e.value;
  
  const COL_ID = 1, COL_BRANCH = 2, COL_RECEIPT_DT = 3, COL_DEV = 11, COL_STATUS = 12;

  if (editedRow < START_ROW) return;

  if (editedColumn === COL_BRANCH) {
    const receiptCell = sheet.getRange(editedRow, COL_RECEIPT_DT);
    if (newValue && !receiptCell.getValue()) generateIdAndDate(sheet, editedRow);
  }

  if (editedColumn === COL_DEV && newValue) {
    // sendAssignmentEmail(sheet, editedRow, newValue); // 이메일 발송 임시 비활성화
    // [v15] 담당자 변경은 접수일시 순서에 영향을 주지 않으므로 전체 정렬을 수행하지 않습니다.
  }

  if (editedColumn === COL_STATUS) {
    handleStatusChange(sheet, editedRow, newValue);
  }
}

function getMaxIssueSequenceForPrefix(sheet, prefix) {
  const lastRow = sheet.getLastRow();
  if (lastRow < START_ROW) return 0;

  const idValues = sheet.getRange(START_ROW, 1, lastRow - START_ROW + 1, 1).getDisplayValues();
  let maxSeq = 0;
  idValues.forEach(function(row) {
    const idVal = (row[0] || '').toString().trim();
    if (idVal.indexOf(prefix) !== 0) return;
    const seqNum = parseInt(idVal.substring(prefix.length), 10);
    if (!isNaN(seqNum) && seqNum > maxSeq) maxSeq = seqNum;
  });
  return maxSeq;
}

function reserveIssueIdentity(sheet, dateStr) {
  const safeDateStr = (dateStr || Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd')).toString().trim();
  const baseDate = new Date(safeDateStr + 'T09:00:00+09:00');
  if (isNaN(baseDate.getTime())) throw new Error('접수 일자가 올바르지 않습니다.');

  const dateKey = Utilities.formatDate(baseDate, TIMEZONE, DATE_FORMAT_ID);
  const prefix = 'IT-' + dateKey + '-';
  const propertyKey = ISSUE_SEQ_PROPERTY_PREFIX + dateKey;
  const props = PropertiesService.getScriptProperties();

  let maxSeq = parseInt(props.getProperty(propertyKey), 10);
  if (isNaN(maxSeq)) {
    // 날짜별 최초 등록 시에만 A열을 한 번 확인합니다. 이후에는 속성 캐시를 사용합니다.
    maxSeq = getMaxIssueSequenceForPrefix(sheet, prefix);
  } else {
    // 시트에서 수동 등록한 건이 캐시보다 앞서간 경우 중복 후보만 빠르게 확인합니다.
    const candidateId = prefix + (maxSeq + 1).toString().padStart(3, '0');
    const lastRow = sheet.getLastRow();
    if (lastRow >= START_ROW) {
      const found = sheet.getRange(START_ROW, 1, lastRow - START_ROW + 1, 1)
        .createTextFinder(candidateId)
        .matchEntireCell(true)
        .findNext();
      if (found) maxSeq = getMaxIssueSequenceForPrefix(sheet, prefix);
    }
  }

  const nextSeq = maxSeq + 1;
  props.setProperty(propertyKey, String(nextSeq));

  return {
    id: prefix + nextSeq.toString().padStart(3, '0'),
    date: new Date(baseDate.getTime() + (nextSeq - 1) * 10 * 60000)
  };
}

function findIssueRowById(sheet, issueId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < START_ROW) return -1;

  const found = sheet.getRange(START_ROW, 1, lastRow - START_ROW + 1, 1)
    .createTextFinder(String(issueId || '').trim())
    .matchEntireCell(true)
    .findNext();
  return found ? found.getRow() : -1;
}

function findInsertRowForIssueDate(sheet, targetDate) {
  const lastRow = sheet.getLastRow();
  if (lastRow < START_ROW) return START_ROW;

  const topDate = sheet.getRange(START_ROW, 3).getValue();
  if (!(topDate instanceof Date) || targetDate >= topDate) return START_ROW;

  // 과거 일자 이관 시에만 C열 하나를 읽어서 알맞은 위치에 바로 삽입합니다.
  const dates = sheet.getRange(START_ROW, 3, lastRow - START_ROW + 1, 1).getValues();
  for (let i = 0; i < dates.length; i++) {
    const current = dates[i][0];
    if (!(current instanceof Date) || current < targetDate) return START_ROW + i;
  }
  return lastRow + 1;
}

function insertIssueRowAt(sheet, rowIndex) {
  const lastRow = sheet.getLastRow();
  if (lastRow < START_ROW) {
    if (sheet.getMaxRows() < START_ROW) sheet.insertRowsAfter(sheet.getMaxRows(), START_ROW - sheet.getMaxRows());
    return;
  }
  if (rowIndex > lastRow) sheet.insertRowAfter(lastRow);
  else sheet.insertRowBefore(rowIndex);
}

function generateIdAndDate(sheet, rowIdx) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const now = new Date();
    const dateStr = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
    const identity = reserveIssueIdentity(sheet, dateStr);
    sheet.getRange(rowIdx, 1).setValue(identity.id);
    sheet.getRange(rowIdx, 3).setValue(identity.date).setNumberFormat(NUMBER_FORMAT_DT);
  } finally {
    lock.releaseLock();
  }
}

function handleStatusChange(sheet, rowIdx, statusValue) {
  const doneDateCell = sheet.getRange(rowIdx, 13);
  if (statusValue === "완료" || statusValue === "반려") {
    if (!doneDateCell.getValue()) doneDateCell.setValue(new Date()).setNumberFormat(NUMBER_FORMAT_DT);
  } else if (statusValue !== undefined) {
    doneDateCell.clearContent();
  }
}

function onSelectionChange(e) {
  if (!e) return;
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== getMainSheet().getName()) return;
  const row = e.range.getRow();
  if (row >= 3) sheet.getRange("p1").setValue(row);
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    let result = { success: false, error: 'Invalid action' };
    
    if (action === 'getDashboardData') {
      const startDate = e.parameter.startDate;
      const endDate = e.parameter.endDate;
      const data = getDashboardData(startDate, endDate);
      return ContentService.createTextOutput(JSON.stringify({ success: true, data: data }))
        .setMimeType(ContentService.MimeType.TEXT);
    }
    
    if (action === 'getDevelopers') {
      const devs = getDevelopers();
      return ContentService.createTextOutput(JSON.stringify({ success: true, data: devs }))
        .setMimeType(ContentService.MimeType.TEXT);
    }

    return ContentService.createTextOutput(JSON.stringify({ 
      success: false, 
      message: 'KIC API Server is running. Please use GitHub Pages frontend to access UI.' 
    })).setMimeType(ContentService.MimeType.TEXT);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

function doPost(e) {
  try {
    let rawData = '';
    if (e.postData && e.postData.contents) {
      rawData = e.postData.contents;
    } else {
      throw new Error('No post data received.');
    }
    
    const payload = JSON.parse(rawData);
    const action = payload.action;
    const data = payload.data || {};
    let result = { success: false, error: 'Invalid post action' };

    if (action === 'getDashboardData') {
      const stats = getDashboardData(data.startDate, data.endDate);
      result = { success: true, data: stats };
    } else if (action === 'addIssue') {
      const stats = addIssueFromDashboard(data);
      result = { success: true, data: stats };
    } else if (action === 'updateIssue') {
      const stats = updateIssueFromDashboard(data);
      result = { success: true, data: stats };
    } else if (action === 'updateStatus') {
      const stats = updateIssueStatusFromDashboard(data.id, data.status, data.sourceType);
      result = { success: true, data: stats };
    } else if (action === 'updateHidden') {
      const stats = updateIssueHiddenFromDashboard(data.id, data.hiddenYn, data.sourceType);
      result = { success: true, data: stats };
    } else if (action === 'saveDevelopers') {
      const stats = saveDevelopers(data.devList);
      result = { success: true, data: stats };
    } else if (action === 'generateReply') {
      const stats = generateHelpdeskReply(data);
      result = { success: true, data: stats };
    } else if (action === 'analyzeCapture') {
      const stats = analyzeHelpdeskCapture(data);
      result = { success: true, data: stats };
    } else if (action === 'getDevelopers') {
      const devs = getDevelopers();
      result = { success: true, data: devs };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.TEXT);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

/* ==========================================
   🤖 이메일 발송 및 Gemini AI
   ========================================== */
function sendAssignmentEmail(sheet, rowIdx, devName) {
  // 이메일 발송 기능 임시 비활성화 (추후 필요 시 주석 해제하여 사용)
  /*
  const devList = getDevelopers();
  const devObj = devList.find(d => d.name === devName);
  if (!devObj || !devObj.email) return; // 등록된 이메일이 없으면 패스 (기능 보존)

  const issueId = sheet.getRange(rowIdx, 1).getValue();
  const branch = sheet.getRange(rowIdx, 2).getValue();
  const subject = sheet.getRange(rowIdx, 9).getValue() || "(제목 없음)";
  const dashboardUrl = "https://script.google.com/macros/s/AKfycbxnXmjvl7o_WWILVEju-3ZNXclg3SezPQ38cGVKD-gMGFPNe7dciqmqy2Ve4twDSPUXPg/exec";
  
  const mailSubject = `[IT헬프데스크 ${issueId}건]이 배정되었습니다.`;
  const mailHtmlBody = `담당자님, 새로운 IT 지원 이슈가 배정되었습니다.<br><br>` +
                       `- 이슈번호: <b>${issueId}</b><br>` +
                       `- 지사: <b>${branch}</b><br>` +
                       `- 제목: <b>${subject}</b><br><br>` +
                       `<a href="${dashboardUrl}" target="_blank" style="color: #1a73e8; text-decoration: underline; font-weight: bold;">대시보드에서 처리하기</a>`;
  try { MailApp.sendEmail({to: devObj.email, subject: mailSubject, htmlBody: mailHtmlBody}); } catch (err) {}
  */
}

function setGeminiApiKey() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('Gemini API 키 설정', 'Google AI Studio에서 발급받은 Gemini API 키를 입력하세요.\n입력한 키는 스크립트 속성에 저장되며 HTML에는 노출되지 않습니다.', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const key = response.getResponseText().trim();
  if (!key) return ui.alert('API 키가 비어 있습니다.');
  PropertiesService.getScriptProperties().setProperty(GEMINI_API_KEY_PROPERTY, key);
  ui.alert('Gemini API 키가 저장되었습니다.');
}

function testGeminiConnection() {
  try {
    const text = generateGeminiReport('한 문장으로 "Gemini 연결 테스트 성공"이라고 답하세요.');
    SpreadsheetApp.getUi().alert('연결 성공:\n\n' + text);
  } catch (error) {
    SpreadsheetApp.getUi().alert('연결 실패:\n\n' + error.message);
  }
}

function generateGeminiReport(prompt) {
  if (!prompt) throw new Error('AI 리포트 프롬프트가 비어 있습니다.');
  return callGeminiFromServer([{ role: 'user', parts: [{ text: prompt }] }]);
}

function chatWithGemini(contents) {
  if (!contents || !Array.isArray(contents) || contents.length === 0) throw new Error('AI 채팅 기록이 비어 있습니다.');
  return callGeminiFromServer(contents);
}

function generateHelpdeskReply(payload) {
  payload = payload || {};
  const requestText = (payload.requestText || '').toString().trim();
  const draftAnswer = (payload.draftAnswer || '').toString().trim();
  const images = Array.isArray(payload.images) ? payload.images : [];

  if (!requestText && images.length === 0) {
    throw new Error('요청 사항 또는 참고 이미지를 입력해 주세요.');
  }
  if (!draftAnswer) {
    throw new Error('답변 초안을 입력해 주세요. AI가 임의로 결론을 만들지 않도록 초안이 필요합니다.');
  }

  // [v16.8] 수정 전 헬프데스크 답변 톤/구성을 복원합니다.
  // 요청사항/이미지는 문의 배경으로만 사용하고, 답변 초안의 사실·결론·개선사항을 빠짐없이 최종 회신에 반영합니다.
  const systemPrompt = `당신은 친절하고 전문적인 코리아인스트루먼트 IT전략실 헬프데스크 담당자입니다.
사용자가 제출한 [요청 사항], [참고 이미지], [답변 초안]을 바탕으로 사내 게시판 또는 헬프데스크에 그대로 등록할 수 있는 공식 최종 답변을 작성하세요.

가장 중요한 우선순위는 다음과 같습니다.
1순위: [답변 초안] - IT전략실이 실제로 전달하려는 확인 결과, 처리 결과, 개선 방향, 안내 사항, 제공 가능/불가 여부입니다.
2순위: [요청 사항] - 문의의 배경과 어떤 기능/현상을 문의했는지 파악하는 용도입니다.
3순위: [참고 이미지] - 화면 상태나 문맥을 보조 확인하는 용도입니다.

[절대 규칙]
- 최종 답변의 결론은 반드시 [답변 초안]을 따르세요.
- [답변 초안]에 적힌 사실, 확인 결과, 개선 사항, 처리 방향, 조건, 예외를 누락하지 마세요.
- 답변 초안에 '확인 결과', '개선 사항', '처리 내용', '안내 사항'처럼 구분된 내용이 있으면 각 항목의 핵심 내용을 모두 최종 답변에 포함하세요.
- 요청사항이나 이미지의 내용을 다시 요약하는 데 답변의 대부분을 사용하지 마세요.
- 이미지에서 보이는 내용이 답변 초안과 다르게 해석되더라도 답변 초안의 결론을 우선하세요.
- 답변 초안에 없는 완료 여부, 확정 일정, 담당자, 원인, 개발 범위, 정책, 기능을 임의로 만들어내지 마세요.
- 답변 초안의 확정성/시제를 바꾸지 마세요. 예: '검토'는 검토로, '개선 예정'은 예정으로, '수정 완료'는 완료로 유지합니다.
- 문장이 중간에 끊기거나 미완성 상태로 끝나면 안 됩니다.

[답변 형식]
1. 첫 줄은 반드시 아래 문장으로 시작합니다.
안녕하세요, IT전략실입니다.

2. 한 줄을 비운 뒤 문의한 기능 또는 사항을 자연스럽게 짚어 안내합니다.
예: 문의해 주신 '접수내역 불러오기' 기능 이용에 대해 안내해 드립니다.
예: 문의해 주신 '승인 후 수정 시 내 분야만 보기' 기능에 대해 확인 결과 안내드립니다.

3. 답변 초안의 내용을 바탕으로 설명 문단을 작성합니다.
- 확인된 현상이나 현재 상태가 있으면 먼저 설명합니다.
- 개선/조치 방향이 있으면 반드시 이어서 명확하게 안내합니다.
- 너무 짧게 결론만 적지 말고, 문의자가 이해할 수 있도록 답변 초안 범위 안에서 자연스럽게 풀어 씁니다.

4. 여러 확인사항, 사용 조건, 개선 항목, 처리 항목이 있을 때만 글머리표를 사용합니다.
- 소제목은 내용에 따라 '사용 가이드', '확인 사항', '개선 사항', '처리 내용', '안내 사항' 중 자연스러운 것을 사용합니다.
- 예시 형식:
- 개선 사항
  - 첫 번째 개선 내용
  - 두 번째 개선 내용

5. 단순 완료 안내, 제공 불가, 짧은 정책 안내처럼 목록이 불필요하면 억지로 글머리표를 만들지 마세요.

6. 추가 문의가 자연스러운 답변인 경우 아래 문장을 사용해 마무리할 수 있습니다.
이후에도 동일한 문제가 발생하거나 다른 문의 사항이 있으시면 언제든지 IT전략실로 연락해 주시기 바랍니다.
단, 이미 조치 예정/개선 예정만 안내하는 답변에서 이 문장이 어색하면 생략해도 됩니다.

7. 마지막 줄은 반드시 아래 문장으로 끝냅니다.
감사합니다.

[문체]
- 정중하고 친절한 사내 공식 답변 문체
- 본명/직책은 임의로 넣지 않음
- 한두 문장마다 적절히 단락을 나눠 읽기 쉽게 작성
- '요청사항 요약', '분석 결과', '정리하면' 같은 보고서형 제목 사용 금지
- Markdown 코드블록 사용 금지
- 최종 답변 외 분석 과정이나 설명 출력 금지

[좋은 답변 스타일 예시]
안녕하세요, IT전략실입니다.

문의해 주신 '접수내역 불러오기' 기능 이용에 대해 안내해 드립니다.

해당 기능이 정상적으로 작동하기 위해서는 사전에 기준 정보가 등록되어 있어야 합니다. 아래의 안내 사항을 확인하신 후 다시 시도해 주시기 바랍니다.

- 사용 가이드
  - '접수내역 불러오기'를 진행하실 때는 최소 하나 이상의 계측기가 등록되어 있어야 정상적으로 동작합니다.
  - 등록된 계측기가 있는지 먼저 확인하신 후 기능을 이용해 주시기 바랍니다.

이후에도 동일한 문제가 발생하거나 다른 문의 사항이 있으시면 언제든지 IT전략실로 연락해 주시기 바랍니다.

감사합니다.

위 예시는 문장 내용이 아니라 톤과 구성만 참고하세요.

[확인 결과 + 개선 사항 답변 예시]
답변 초안에 아래처럼 적혀 있다면:
확인 결과: '내 분야만 보기' 선택 시 교정 권한이 실무, 기술(정), 기술(부)로 함께 노출됨
개선 사항: 기술(정)만 노출되도록 개선 예정

최종 답변에는 반드시 '현재 함께 노출되는 현상을 확인했다'는 내용과 '기술(정)만 노출되도록 개선할 예정'이라는 두 핵심 내용이 모두 들어가야 합니다. 요청사항만 다시 설명하고 개선 사항을 누락하면 안 됩니다.`;

  const userPrompt = `[요청 사항]
${requestText || '(텍스트 요청 사항 없음. 첨부 이미지를 참고하세요.)'}

[답변 초안 - 반드시 모든 핵심 내용을 반영]
${draftAnswer}

위 내용을 바탕으로 최종 답변만 작성하세요.`;

  const parts = [{ text: systemPrompt + '\n\n' + userPrompt }];
  images.slice(0, 3).forEach(function(img) {
    if (!img) return;
    const mimeType = (img.mimeType || 'image/jpeg').toString();
    let data = (img.data || '').toString();
    if (data.indexOf(',') !== -1) data = data.split(',').pop();
    if (data) parts.push({ inlineData: { mimeType: mimeType, data: data } });
  });

  // 수정 전 로직처럼 continuation을 지원하는 품질 우선 호출을 사용해 문장 중간 잘림을 방지합니다.
  let result = callGeminiFromServer([{ role: 'user', parts: parts }]);
  result = enforceHelpdeskReplyFormat(result);
  return { success: true, text: result };
}

// [v16.10] 게시판 캡처 이미지를 분석해 새 이슈 등록 폼에 자동 입력할 데이터를 반환합니다.
// 제목은 AI가 다듬지 않고 캡처의 게시글 제목 원문을 그대로 사용합니다.
function analyzeHelpdeskCapture(payload) {
  payload = payload || {};
  const images = Array.isArray(payload.images) ? payload.images.slice(0, 3) : [];
  if (images.length === 0) throw new Error('분석할 게시판 캡처 이미지를 붙여넣어 주세요.');

  const prompt = `당신은 코리아인스트루먼트 IT전략실의 헬프데스크 접수 보조 AI입니다.
첨부된 게시판 화면 캡처를 읽고 새 이슈 등록 폼에 들어갈 값만 JSON으로 반환하세요.

[반환 JSON 형식]
{
  "receiptDate": "YYYY-MM-DD 또는 빈 문자열",
  "branch": "서울본사|부산지사|대전지사|웨이투웨이|기타|빈 문자열",
  "requester": "작성자/요청자 이름 또는 빈 문자열",
  "system": "CMS|CWIZ|인프라|기타|빈 문자열",
  "type": "오류|데이터 수정|단순 문의|기능 개선|기타|빈 문자열",
  "priority": "낮음|보통|높음|긴급",
  "menu": "발생 메뉴 또는 빈 문자열",
  "title": "게시판 제목 영역에 표시된 제목 원문 그대로. 확인할 수 없으면 빈 문자열",
  "details": "요청 본문을 사실 위주로 정리한 상세 내용",
  "warnings": ["확인이 필요한 항목이 있으면 짧게 기재"]
}

[판단 규칙]
- 캡처에 실제로 보이는 내용과 문맥만 사용하고, 사람 이름/날짜/메뉴/업체명/번호를 임의로 만들지 마세요.
- 게시판의 원 요청글을 중심으로 읽고, 사이트 메뉴/브라우저 UI/서명/광고성 영역은 제외하세요.
- 댓글이나 답변이 같이 보이면 원 요청 내용과 구분하세요. 댓글 내용을 요청 본문처럼 합치지 마세요.
- 시스템 구분과 유형은 요청의 의미를 보고 가장 가까운 항목을 추천할 수 있습니다.
- 긴급도는 명확한 긴급 표현이 없으면 "보통"으로 하세요.
- 날짜에 연도가 명확하지 않으면 receiptDate는 빈 문자열로 두세요.
- 지사가 명확하지 않으면 branch는 빈 문자열로 두세요.
- title은 게시판 제목 영역에 실제로 표시된 제목을 원문 그대로 복사하세요.
- 제목을 요약하거나 자연스럽게 다듬거나 맞춤법을 고치거나 Jira 말머리를 추가하지 마세요.
- 제목 원문의 글자, 숫자, 띄어쓰기, 특수문자, 괄호, 대괄호, 말머리를 임의로 변경하거나 삭제하지 마세요.
- 게시판 제목이 잘렸거나 흐려서 원문 전체를 확실히 확인할 수 없으면 추정하지 말고 title을 빈 문자열로 두고 warnings에 제목 확인 필요를 추가하세요.
- details에는 캡처에서 확인되는 요청사항을 빠뜨리지 말되, 처리 결과/완료 여부/일정/원인을 임의로 추가하지 마세요.
- 반환값은 JSON 객체만 출력하고 코드블록이나 설명은 출력하지 마세요.`;

  const parts = [{ text: prompt }];
  images.forEach(function(img) {
    if (!img) return;
    const mimeType = (img.mimeType || 'image/jpeg').toString();
    let data = (img.data || '').toString();
    if (data.indexOf(',') !== -1) data = data.split(',').pop();
    if (data) parts.push({ inlineData: { mimeType: mimeType, data: data } });
  });

  const raw = callGeminiJsonFastFromServer([{ role: 'user', parts: parts }]);
  const parsed = parseGeminiJsonObject(raw);
  const normalized = normalizeHelpdeskCaptureResult(parsed);
  return { success: true, data: normalized };
}

function callGeminiJsonFastFromServer(contents) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(GEMINI_API_KEY_PROPERTY);
  if (!apiKey) throw new Error('Gemini API 키가 설정되어 있지 않습니다. 스프레드시트 메뉴에서 "🚀 KIC 헬프데스크 > 🔐 Gemini API 키 설정"을 먼저 실행하세요.');

  const errors = [];
  const models = GEMINI_CAPTURE_MODELS.slice();

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const url = 'https://generativelanguage.googleapis.com/' + GEMINI_API_VERSION + '/models/' + model + ':generateContent?key=' + encodeURIComponent(apiKey);
    const generationConfig = {
      maxOutputTokens: 1800,
      responseMimeType: 'application/json'
    };

    // 단순 이미지 내용 추출에는 긴 추론이 필요하지 않으므로 모델별 최소 사고 설정을 사용합니다.
    // Gemini 3.x에서는 기존 sampling 옵션이 권장되지 않아 2.5 계열에만 적용합니다.
    if (model.indexOf('gemini-3') === 0) {
      generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
    } else {
      generationConfig.temperature = 0.1;
      generationConfig.topP = 0.7;
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const payload = {
      generationConfig: generationConfig,
      contents: contents
    };

    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify(payload)
      });
      const status = response.getResponseCode();
      const body = response.getContentText();
      let data;
      try { data = JSON.parse(body); } catch (e) { data = {}; }

      if (status >= 200 && status < 300) {
        const candidate = data.candidates && data.candidates[0];
        const text = candidate && candidate.content && candidate.content.parts
          ? candidate.content.parts.map(function(part) { return part.text || ''; }).join('').trim()
          : '';
        if (text) return text;
        errors.push(model + ': generated JSON was empty.');
        continue;
      }

      const apiMessage = data && data.error && data.error.message ? data.error.message : body;
      if (status === 400 && String(apiMessage).toLowerCase().indexOf('api key not valid') !== -1) {
        throw new Error('Gemini API 키가 유효하지 않습니다.');
      }
      if (status === 401 || status === 403) throw new Error('인증 오류: ' + apiMessage);
      errors.push(model + ': HTTP ' + status + ' - ' + apiMessage);
    } catch (error) {
      const message = String(error.message || error);
      if (message.indexOf('Gemini API 키') !== -1 || message.indexOf('인증 오류') !== -1) throw error;
      errors.push(model + ': ' + message);
    }
  }

  throw new Error('게시판 캡처 분석에 실패했습니다. 마지막 에러: ' + (errors[errors.length - 1] || '알 수 없는 오류'));
}

function parseGeminiJsonObject(text) {
  let raw = (text || '').toString().trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/g, '').trim();

  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
  } catch (e) {}

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(raw.substring(start, end + 1));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch (e) {}
  }
  throw new Error('AI 분석 결과를 JSON으로 해석하지 못했습니다. 다시 분석해 주세요.');
}

function normalizeHelpdeskCaptureResult(data) {
  data = data || {};
  const allowedBranches = ['서울본사', '부산지사', '대전지사', '웨이투웨이', '기타'];
  const allowedSystems = ['CMS', 'CWIZ', '인프라', '기타'];
  const allowedTypes = ['오류', '데이터 수정', '단순 문의', '기능 개선', '기타'];
  const allowedPriorities = ['낮음', '보통', '높음', '긴급'];

  function clean(value, maxLen) {
    let result = value === null || value === undefined ? '' : String(value).trim();
    result = result.replace(/\r/g, '');
    if (maxLen && result.length > maxLen) result = result.substring(0, maxLen);
    return result;
  }

  function enumValue(value, allowed, fallback) {
    const cleaned = clean(value, 30);
    return allowed.indexOf(cleaned) !== -1 ? cleaned : (fallback || '');
  }

  let receiptDate = clean(data.receiptDate, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receiptDate)) receiptDate = '';

  let warnings = Array.isArray(data.warnings) ? data.warnings : [];
  warnings = warnings.map(function(v) { return clean(v, 120); }).filter(Boolean).slice(0, 5);

  return {
    receiptDate: receiptDate,
    branch: enumValue(data.branch, allowedBranches, ''),
    requester: clean(data.requester, 80),
    system: enumValue(data.system, allowedSystems, ''),
    type: enumValue(data.type, allowedTypes, ''),
    priority: enumValue(data.priority, allowedPriorities, '보통'),
    menu: clean(data.menu, 150),
    // 제목은 캡처 원문을 축약하지 않도록 기존 120자 절단을 적용하지 않습니다.
    title: clean(data.title),
    details: clean(data.details, 4000),
    warnings: warnings
  };
}

function enforceHelpdeskReplyFormat(text) {
  text = (text || '').toString().trim();
  text = text.replace(/^```(?:markdown)?\s*/i, '').replace(/```$/g, '').trim();
  const greeting = '안녕하세요, IT전략실입니다.';
  const closing = '감사합니다.';

  if (text.indexOf(greeting) !== 0) {
    text = text.replace(new RegExp('^' + greeting.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'm'), '').trim();
    text = greeting + '\n\n' + text;
  }

  text = text.replace(/\s*(감사합니다\.?|감사합니다\.\s*)$/g, '').trim();
  text = text + '\n\n' + closing;
  return text;
}


function callGeminiFastFromServer(contents) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(GEMINI_API_KEY_PROPERTY);
  if (!apiKey) throw new Error('Gemini API 키가 설정되어 있지 않습니다. 스프레드시트 메뉴에서 "🚀 KIC 헬프데스크 > 🔐 Gemini API 키 설정"을 먼저 실행하세요.');

  const payload = {
    generationConfig: { temperature: 0.18, topP: 0.8, maxOutputTokens: 1800 },
    contents: contents
  };
  const errors = [];

  // 짧은 답변은 lite/flash 모델을 우선 사용하고 1.5~3.5초 sleep 재시도를 생략합니다.
  for (let i = 0; i < GEMINI_REPLY_MODELS.length; i++) {
    const model = GEMINI_REPLY_MODELS[i];
    const url = 'https://generativelanguage.googleapis.com/' + GEMINI_API_VERSION + '/models/' + model + ':generateContent?key=' + encodeURIComponent(apiKey);

    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify(payload)
      });
      const status = response.getResponseCode();
      const body = response.getContentText();
      let data;
      try { data = JSON.parse(body); } catch (e) { data = {}; }

      if (status >= 200 && status < 300) {
        const candidate = data.candidates && data.candidates[0];
        const text = candidate && candidate.content && candidate.content.parts
          ? candidate.content.parts.map(function(p) { return p.text || ''; }).join('').trim()
          : '';
        if (text) return text;
        errors.push(model + ': generated text was empty.');
        continue;
      }

      const apiMessage = data && data.error && data.error.message ? data.error.message : body;
      if (status === 400 && String(apiMessage).toLowerCase().indexOf('api key not valid') !== -1) {
        throw new Error('Gemini API 키가 유효하지 않습니다.');
      }
      if (status === 401 || status === 403) throw new Error('인증 오류: ' + apiMessage);

      errors.push(model + ': HTTP ' + status + ' - ' + apiMessage);
      // 404/429/5xx는 기다리지 않고 다음 모델로 즉시 전환합니다.
    } catch (error) {
      const message = String(error.message || error);
      if (message.indexOf('Gemini API 키') !== -1 || message.indexOf('인증 오류') !== -1) throw error;
      errors.push(model + ': ' + message);
    }
  }

  throw new Error('Gemini 답변 생성에 실패했습니다. 마지막 에러: ' + (errors[errors.length - 1] || '알 수 없는 오류'));
}

function callGeminiFromServer(contents) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(GEMINI_API_KEY_PROPERTY);
  if (!apiKey) throw new Error('Gemini API 키가 설정되어 있지 않습니다. 스프레드시트 메뉴에서 "🚀 KIC 헬프데스크 > 🔐 Gemini API 키 설정"을 먼저 실행하세요.');

  const basePayload = { generationConfig: { temperature: 0.2, topP: 0.8, maxOutputTokens: 4096 } };
  const errors = [];

  for (let modelIndex = 0; modelIndex < GEMINI_MODELS.length; modelIndex++) {
    const model = GEMINI_MODELS[modelIndex];
    const endpoint = GEMINI_API_VERSION + '/models/' + model;
    const url = 'https://generativelanguage.googleapis.com/' + endpoint + ':generateContent?key=' + encodeURIComponent(apiKey);
    const delays = [0, 1500, 3500];

    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) Utilities.sleep(delays[attempt]);
      try {
        const resultText = requestGeminiWithContinuation(url, basePayload, contents);
        if (resultText) return resultText;
        errors.push(model + ': response succeeded but generated text was empty.');
        break;
      } catch (error) {
        const message = String(error.message || error);
        errors.push(model + ': ' + message);
        if (message.indexOf('API key') !== -1 || message.indexOf('authentication') !== -1) throw error;
        if (message.indexOf('unsupported model') !== -1 || message.indexOf('HTTP 404') !== -1) break;
        if ((message.indexOf('HTTP 429') !== -1 || message.toLowerCase().indexOf('quota') !== -1) && attempt < delays.length - 1) continue;
        break;
      }
    }
  }
  throw new Error('모든 Gemini 모델 통신에 실패했습니다. 마지막 에러: ' + (errors[errors.length - 1] || '알 수 없는 오류'));
}

function requestGeminiWithContinuation(url, basePayload, originalContents) {
  let workingContents = JSON.parse(JSON.stringify(originalContents || []));
  const textParts = [];

  for (let continuationIndex = 0; continuationIndex <= GEMINI_MAX_CONTINUATION_COUNT; continuationIndex++) {
    const response = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(Object.assign({}, basePayload, { contents: workingContents })) });
    const status = response.getResponseCode();
    const body = response.getContentText();
    let data; try { data = JSON.parse(body); } catch(e) { data = {}; }

    if (status < 200 || status >= 300) {
      const apiMessage = data && data.error && data.error.message ? data.error.message : body;
      if (status === 400 && apiMessage.toLowerCase().indexOf('api key not valid') !== -1) throw new Error('Gemini API 키가 유효하지 않습니다.');
      if (status === 401 || status === 403) throw new Error('인증 오류: ' + apiMessage);
      if (status === 404) throw new Error('HTTP 404 - unsupported model');
      throw new Error('HTTP ' + status + ' - ' + apiMessage);
    }

    if (!data.candidates || data.candidates.length === 0) return { text: '', finishReason: '', finishMessage: '' };
    const candidate = data.candidates[0];
    
    let text = '';
    if (candidate.content && candidate.content.parts) text = candidate.content.parts.map(p => p.text || '').join('').trim();
    if (text) textParts.push(text);

    if (candidate.finishReason === 'MAX_TOKENS') {
      if (continuationIndex < GEMINI_MAX_CONTINUATION_COUNT && text) {
        workingContents.push({ role: 'model', parts: [{ text: text }] });
        workingContents.push({ role: 'user', parts: [{ text: 'Continue from the last sentence naturally in Korean.' }] });
        continue;
      }
    }
    return textParts.join('\n\n').trim();
  }
  return textParts.join('\n\n').trim();
}

/* ==========================================
   📊 대시보드 데이터 조회 및 업데이트
   ========================================== */
function getDashboardData(startDateStr, endDateStr) {
  const sheet = getMainSheet();
  ensureLinkColumns(sheet);
  const lastRow = sheet.getLastRow();

  let stats = {
    total: 0, done: 0, pending: 0,
    statusData: {}, branchData: {}, devData: {}, devStatusData: {}, systemData: {}, typeData: {},
    pendingCurrent: [], pendingPast: [], rejectedPast: [], quarterRequestItems: [], pastKanbanItems: [], completedCurrent: [],
    // [v16.2] 주간 리포트의 전주 비교용 요약. 같은 시트 스캔에서 함께 집계해 추가 조회를 피합니다.
    previousWeek: {
      enabled: false,
      startDate: '', endDate: '',
      total: 0, completed: 0, pending: 0, rejected: 0, completionRate: 0,
      systemData: {}, typeData: {}, branchData: {}
    }
  };

  let start = startDateStr ? new Date(startDateStr) : null;
  let end = endDateStr ? new Date(endDateStr) : null;
  if (start) start.setHours(0, 0, 0, 0);
  if (end) end.setHours(23, 59, 59, 999);

  // 주간(최대 7일) 조회일 때만 전주 동일 요일 구간을 비교합니다.
  let previousStart = null;
  let previousEnd = null;
  if (start && end) {
    const selectedDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    if (selectedDays >= 1 && selectedDays <= 7) {
      previousStart = new Date(start);
      previousEnd = new Date(end);
      previousStart.setDate(previousStart.getDate() - 7);
      previousEnd.setDate(previousEnd.getDate() - 7);
      stats.previousWeek.enabled = true;
      stats.previousWeek.startDate = Utilities.formatDate(previousStart, TIMEZONE, 'yyyy-MM-dd');
      stats.previousWeek.endDate = Utilities.formatDate(previousEnd, TIMEZONE, 'yyyy-MM-dd');
    }
  }

  if (lastRow >= START_ROW) {
    const data = sheet.getRange(START_ROW, 1, lastRow - START_ROW + 1, JIRA_LINKED_COLUMN).getValues();
    data.forEach(row => {
      if (!row[0]) return;
      const receiptDate = new Date(row[2]);
      let inDateRange = true, isPast = false;

      if (start && receiptDate < start) { inDateRange = false; isPast = true; }
      if (end && receiptDate > end) inDateRange = false;

      const issueObj = buildDashboardIssueObject(row, SOURCE_TYPE_HELPDESK);
      const status = issueObj.status;
      const isPending = (status !== "완료" && status !== "반려");

      // [v16.2] 전주 동일 요일 데이터도 현재 조회와 같은 1회 스캔에서 집계합니다.
      if (stats.previousWeek.enabled && previousStart && previousEnd && receiptDate >= previousStart && receiptDate <= previousEnd) {
        stats.previousWeek.total++;
        if (status === '완료') stats.previousWeek.completed++;
        else if (status === '반려') stats.previousWeek.rejected++;
        else stats.previousWeek.pending++;
        if (issueObj.system) stats.previousWeek.systemData[issueObj.system] = (stats.previousWeek.systemData[issueObj.system] || 0) + 1;
        if (issueObj.type) stats.previousWeek.typeData[issueObj.type] = (stats.previousWeek.typeData[issueObj.type] || 0) + 1;
        if (issueObj.branch) stats.previousWeek.branchData[issueObj.branch] = (stats.previousWeek.branchData[issueObj.branch] || 0) + 1;
      }

      if (inDateRange) {
        stats.total++;
        if (!isPending) { stats.done++; stats.completedCurrent.push(issueObj); } else { stats.pending++; }
        if (status) stats.statusData[status] = (stats.statusData[status] || 0) + 1;
        if (issueObj.branch) stats.branchData[issueObj.branch] = (stats.branchData[issueObj.branch] || 0) + 1;
        const devKey = issueObj.dev || '미배정';
        stats.devData[devKey] = (stats.devData[devKey] || 0) + 1;
        if (!stats.devStatusData[devKey]) stats.devStatusData[devKey] = {pending: 0, done: 0, rejected: 0, total: 0};
        stats.devStatusData[devKey].total++;
        if (status === '완료') stats.devStatusData[devKey].done++;
        else if (status === '반려') stats.devStatusData[devKey].rejected++;
        else stats.devStatusData[devKey].pending++;
        if (issueObj.system) stats.systemData[issueObj.system] = (stats.systemData[issueObj.system] || 0) + 1;
        if (issueObj.type) stats.typeData[issueObj.type] = (stats.typeData[issueObj.type] || 0) + 1;
      }

      if (isPending) {
        if (inDateRange) stats.pendingCurrent.push(issueObj); else if (isPast) stats.pendingPast.push(issueObj);
      } else if (isPast && status === "반려") {
        stats.rejectedPast.push(issueObj);
      }
    });
  }

  if (stats.previousWeek.enabled) {
    stats.previousWeek.completionRate = stats.previousWeek.total > 0
      ? Math.round((stats.previousWeek.completed / stats.previousWeek.total) * 100)
      : 0;
  }

  const quarterSheet = getQuarterRequestSheet();
  if (quarterSheet && quarterSheet.getLastRow() >= START_ROW) {
    ensureLinkColumns(quarterSheet);
    const quarterLastRow = quarterSheet.getLastRow();
    const quarterData = quarterSheet.getRange(START_ROW, 1, quarterLastRow - START_ROW + 1, JIRA_LINKED_COLUMN).getValues();
    quarterData.forEach(row => {
      if (!row[0]) return;
      const issueObj = buildDashboardIssueObject(row, SOURCE_TYPE_QUARTER);
      if (issueObj.status !== "완료") {
        stats.quarterRequestItems.push(issueObj);
      }
    });
  }

  // 칸반 보드에서는 이월 미처리, 불가(반려), 분기요청 항목을 함께 보여줍니다.
  stats.pastKanbanItems = stats.quarterRequestItems.concat(stats.pendingPast, stats.rejectedPast);

  return stats;
}

function sanitizeString(str) {
  if (str === null || str === undefined) return "";
  return str.toString().replace(/\\/g, "/").replace(/\r/g, "").replace(/\n/g, " ").replace(/'/g, "’").replace(/"/g, "”").trim();
}

function addIssueFromDashboard(formData) {
  const sheet = getMainSheet();
  ensureLinkColumns(sheet);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const identity = reserveIssueIdentity(sheet, formData.receiptDate);
    const targetRow = findInsertRowForIssueDate(sheet, identity.date);
    insertIssueRowAt(sheet, targetRow);

    const rowValues = [[
      identity.id,
      formData.branch || '',
      identity.date,
      formData.requester || '',
      formData.system || '',
      formData.type || '',
      formData.priority || '보통',
      formData.menu || '',
      formData.title || '',
      formData.details || '',
      formData.dev || '',
      '접수대기',
      '',
      '',
      '',
      formData.sourceLink || '',
      formData.jiraLink || '',
      '',
      formData.jiraLinkedFlag === 'Y' || formData.jiraLinked === 'Y' ? 'Y' : ''
    ]];

    // [v15] A:S를 한 번에 기록해 Spreadsheet 서비스 호출 횟수를 크게 줄입니다.
    sheet.getRange(targetRow, 1, 1, JIRA_LINKED_COLUMN).setValues(rowValues);
    sheet.getRange(targetRow, 3).setNumberFormat(NUMBER_FORMAT_DT);

    return {
      success: true,
      id: identity.id,
      date: Utilities.formatDate(identity.date, TIMEZONE, 'yyyy-MM-dd HH:mm')
    };
  } finally {
    lock.releaseLock();
  }
}

function generateCustomIdAndDate(sheet, rowIdx, dateStr) {
  // 기존 호출 호환용. 신규 등록은 addIssueFromDashboard에서 일괄 처리합니다.
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const identity = reserveIssueIdentity(sheet, dateStr);
    sheet.getRange(rowIdx, 1).setValue(identity.id);
    sheet.getRange(rowIdx, 3).setValue(identity.date).setNumberFormat(NUMBER_FORMAT_DT);
    return identity.id;
  } finally {
    lock.releaseLock();
  }
}

function updateIssueFromDashboard(formData) {
  if (!formData || !formData.id) throw new Error('수정할 이슈 ID가 없습니다.');

  const targetSourceType = formData.sourceType === SOURCE_TYPE_QUARTER ? SOURCE_TYPE_QUARTER : SOURCE_TYPE_HELPDESK;
  const sheet = targetSourceType === SOURCE_TYPE_QUARTER ? getQuarterRequestSheet() : getMainSheet();
  if (!sheet) throw new Error(targetSourceType === SOURCE_TYPE_QUARTER ? '분기요청 시트를 찾을 수 없습니다.' : '이슈사항 시트를 찾을 수 없습니다.');

  ensureLinkColumns(sheet);
  const targetRow = findIssueRowById(sheet, formData.id);
  if (targetRow === -1) throw new Error('해당 이슈를 찾을 수 없습니다: ' + formData.id);

  const range = sheet.getRange(targetRow, 9, 1, JIRA_LINKED_COLUMN - 8); // I:S
  const row = range.getValues()[0];
  const oldStatus = normalizeIssueStatus(row[3]);
  const newStatus = normalizeIssueStatus(formData.status);

  row[0] = formData.title || '';
  row[1] = formData.details || '';
  row[2] = formData.dev || '';
  row[3] = newStatus;

  if (newStatus !== oldStatus) {
    if (newStatus === '완료' || newStatus === '반려') {
      if (!row[4]) row[4] = new Date();
    } else {
      row[4] = '';
    }
  }

  row[5] = formData.actionContent || '';
  row[6] = formData.remark || '';
  row[7] = formData.sourceLink || '';
  row[8] = formData.jiraLink || '';
  if (newStatus !== '반려') row[9] = '';
  row[10] = formData.jiraLinkedFlag === 'Y' || formData.jiraLinked === 'Y' ? 'Y' : '';

  // [v15] 개별 setValue 다중 호출 대신 한 번에 저장합니다.
  range.setValues([row]);
  if ((newStatus === '완료' || newStatus === '반려') && row[4] instanceof Date) {
    sheet.getRange(targetRow, 13).setNumberFormat(NUMBER_FORMAT_DT);
  }

  // 담당자/상태 수정은 접수일시를 바꾸지 않으므로 전체 시트 재정렬하지 않습니다.
  return {success: true, id: formData.id, sourceType: targetSourceType};
}

function updateIssueStatusFromDashboard(issueId, newStatus, sourceType) {
  if (!issueId) throw new Error('이슈 ID가 없습니다.');
  if (!newStatus) throw new Error('변경할 상태값이 없습니다.');

  const targetSourceType = sourceType === SOURCE_TYPE_QUARTER ? SOURCE_TYPE_QUARTER : SOURCE_TYPE_HELPDESK;
  const sheet = targetSourceType === SOURCE_TYPE_QUARTER ? getQuarterRequestSheet() : getMainSheet();
  if (!sheet) throw new Error(targetSourceType === SOURCE_TYPE_QUARTER ? '분기요청 시트를 찾을 수 없습니다.' : '이슈사항 시트를 찾을 수 없습니다.');

  ensureLinkColumns(sheet);
  const targetRow = findIssueRowById(sheet, issueId);
  if (targetRow === -1) throw new Error('해당 이슈를 찾을 수 없습니다: ' + issueId);

  const range = sheet.getRange(targetRow, 12, 1, HIDDEN_FLAG_COLUMN - 11); // L:R
  const row = range.getValues()[0];
  const oldStatus = normalizeIssueStatus(row[0]);
  if (oldStatus === newStatus) {
    return {success: true, id: issueId, sourceType: targetSourceType, status: newStatus, changed: false};
  }

  row[0] = newStatus;
  if (newStatus === '완료' || newStatus === '반려') {
    if (!row[1]) row[1] = new Date();
  } else {
    row[1] = '';
  }
  if (newStatus !== '반려') row[6] = '';

  range.setValues([row]);
  if ((newStatus === '완료' || newStatus === '반려') && row[1] instanceof Date) {
    sheet.getRange(targetRow, 13).setNumberFormat(NUMBER_FORMAT_DT);
  }

  // 상태 변경만으로 접수일시 순서는 변하지 않으므로 전체 정렬을 생략합니다.
  return {success: true, id: issueId, sourceType: targetSourceType, status: newStatus, changed: true};
}

function updateIssueHiddenFromDashboard(issueId, hiddenYn, sourceType) {
  if (!issueId) throw new Error('이슈 ID가 없습니다.');

  const targetSourceType = sourceType === SOURCE_TYPE_QUARTER ? SOURCE_TYPE_QUARTER : SOURCE_TYPE_HELPDESK;
  const sheet = targetSourceType === SOURCE_TYPE_QUARTER ? getQuarterRequestSheet() : getMainSheet();
  if (!sheet) throw new Error(targetSourceType === SOURCE_TYPE_QUARTER ? '분기요청 시트를 찾을 수 없습니다.' : '이슈사항 시트를 찾을 수 없습니다.');

  ensureLinkColumns(sheet);
  const targetRow = findIssueRowById(sheet, issueId);
  if (targetRow === -1) throw new Error('해당 이슈를 찾을 수 없습니다: ' + issueId);

  const range = sheet.getRange(targetRow, 12, 1, HIDDEN_FLAG_COLUMN - 11); // L:R
  const row = range.getValues()[0];
  const status = normalizeIssueStatus(row[0]);
  if (status !== '반려') throw new Error('불가(반려) 상태인 이슈만 숨김 처리할 수 있습니다.');

  const hiddenValue = hiddenYn === 'Y' || hiddenYn === true ? 'Y' : '';
  row[6] = hiddenValue;
  range.setValues([row]);

  return {
    success: true,
    id: issueId,
    sourceType: targetSourceType,
    hiddenFlag: hiddenValue
  };
}
