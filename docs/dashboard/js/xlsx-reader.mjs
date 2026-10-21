// 기존 운영현황의 읽기 전용 XLSX 파서. 외부 전송 없이 브라우저에서 처리합니다.
function xml(text, fileName) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error(`${fileName || "Excel XML"}을 읽는 중 XML 오류가 발생했습니다.`);
  return doc;
}
function childText(node, tag) {
  const el = Array.from(node.children || []).find((child) => child.localName === tag);
  return el ? el.textContent : null;
}
function colIndex(ref) {
  const letters = String(ref || "A1").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}
function resolvePath(base, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/"); parts.pop();
  for (const p of target.replace(/\\/g,"/").split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") parts.pop(); else parts.push(p);
  }
  return parts.join("/");
}

async function unzip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer), view = new DataView(arrayBuffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("올바른 .xlsx 파일이 아닙니다. ZIP 구조를 확인할 수 없습니다.");
  const total = view.getUint16(eocd + 10, true), centralOffset = view.getUint32(eocd + 16, true);
  let pos = centralOffset;
  const entries = new Map();
  const decoder = new TextDecoder("utf-8");
  for (let i = 0; i < total; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error("Excel 압축 디렉터리가 손상되었습니다.");
    const method = view.getUint16(pos + 10, true), compressedSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true), extraLen = view.getUint16(pos + 30, true), commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.slice(pos + 46, pos + 46 + nameLen)).replace(/\\/g,"/");
    const localNameLen = view.getUint16(localOffset + 26, true), localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    entries.set(name, { method, compressed });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  async function extract(name) {
    const entry = entries.get(name);
    if (!entry) return null;
    if (entry.method === 0) return entry.compressed;
    if (entry.method !== 8) throw new Error(`지원하지 않는 Excel 압축 방식입니다. (${entry.method})`);
    if (typeof DecompressionStream === "undefined") throw new Error("이 브라우저는 Excel 압축 해제를 지원하지 않습니다. 최신 Chrome 또는 Edge에서 열어 주세요.");
    const stream = new Blob([entry.compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return { names:[...entries.keys()], extract };
}

async function parseXlsx(file) {
  const zip = await unzip(await file.arrayBuffer());
  const decoder = new TextDecoder("utf-8");
  const readText = async (path, optional=false) => {
    const data = await zip.extract(path);
    if (!data) { if (optional) return null; throw new Error(`${file.name}: ${path} 항목이 없습니다.`); }
    return decoder.decode(data);
  };

  const workbookPath = "xl/workbook.xml";
  const workbookDoc = xml(await readText(workbookPath), file.name);
  const relsDoc = xml(await readText("xl/_rels/workbook.xml.rels"), file.name);
  const rels = new Map(Array.from(relsDoc.getElementsByTagNameNS("*","Relationship")).map((r) => [r.getAttribute("Id"), resolvePath(workbookPath, r.getAttribute("Target") || "")]));
  const date1904 = workbookDoc.getElementsByTagNameNS("*","workbookPr")[0]?.getAttribute("date1904") === "1";

  let sharedStrings = [];
  const sharedText = await readText("xl/sharedStrings.xml", true);
  if (sharedText) {
    const sharedDoc = xml(sharedText, file.name);
    sharedStrings = Array.from(sharedDoc.getElementsByTagNameNS("*","si")).map((si) => Array.from(si.getElementsByTagNameNS("*","t")).map((t) => t.textContent || "").join(""));
  }

  const dateStyleIndexes = new Set();
  const stylesText = await readText("xl/styles.xml", true);
  if (stylesText) {
    const stylesDoc = xml(stylesText, file.name);
    const custom = new Map(Array.from(stylesDoc.getElementsByTagNameNS("*","numFmt")).map((n) => [Number(n.getAttribute("numFmtId")), n.getAttribute("formatCode") || ""]));
    const builtInDate = new Set([14,15,16,17,18,19,20,21,22,27,30,36,45,46,47,50,57]);
    const cellXfs = stylesDoc.getElementsByTagNameNS("*","cellXfs")[0];
    Array.from(cellXfs?.children || []).filter((n) => n.localName === "xf").forEach((xf, index) => {
      const id = Number(xf.getAttribute("numFmtId") || 0);
      const fmt = (custom.get(id) || "").replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "");
      if (builtInDate.has(id) || /[ymdhis]/i.test(fmt)) dateStyleIndexes.add(index);
    });
  }

  function excelDate(serial) {
    const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
    const date = new Date(epoch + serial * 86400000);
    if (Math.abs(serial - Math.round(serial)) < 1e-9) return date.toISOString().slice(0,10);
    return date.toISOString().replace("T"," ").slice(0,19);
  }
  function cellValue(cell) {
    const type = cell.getAttribute("t") || "n";
    if (type === "inlineStr") return Array.from(cell.getElementsByTagNameNS("*","t")).map((t) => t.textContent || "").join("");
    const raw = childText(cell, "v");
    if (raw === null) return "";
    if (type === "s") return sharedStrings[Number(raw)] ?? "";
    if (type === "b") return raw === "1";
    if (["str","e","d"].includes(type)) return raw;
    const n = Number(raw);
    const style = Number(cell.getAttribute("s") || 0);
    if (Number.isFinite(n) && dateStyleIndexes.has(style)) return excelDate(n);
    return Number.isFinite(n) ? n : raw;
  }

  const sheets = [];
  for (const sheetNode of Array.from(workbookDoc.getElementsByTagNameNS("*","sheet"))) {
    const relId = sheetNode.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships","id") || sheetNode.getAttribute("r:id");
    const path = rels.get(relId);
    if (!path) continue;
    const sheetDoc = xml(await readText(path), file.name);
    const rows = [];
    for (const rowNode of Array.from(sheetDoc.getElementsByTagNameNS("*","row"))) {
      const row = [];
      for (const cell of Array.from(rowNode.children || []).filter((n) => n.localName === "c")) row[colIndex(cell.getAttribute("r"))] = cellValue(cell);
      rows.push(row.map((v) => v ?? ""));
    }
    sheets.push({ name:sheetNode.getAttribute("name") || "Sheet", rows });
  }
  return sheets;
}


export { parseXlsx };
