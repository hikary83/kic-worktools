// v3 디자인 토큰 대비 검사: kic-theme.css 의 라이트(:root)·다크(html.dark) 값을 읽어
// 본문 글자 4.5:1, 상태 점·테두리 같은 큰 표시 3:1 을 확인합니다. 화면을 열지 않는 순수 계산입니다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../docs/css/kic-theme.css'), 'utf8');
function block(selector) {
  const start = css.indexOf(selector + ' {');
  const body = css.slice(start, css.indexOf('}', start));
  const out = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const themes = { light: block(':root'), dark: block('html.dark') };
const surfaces = ['bg', 'panel', 'card', 'raise', 'dialog', 'field'];
const text = ['ink', 'muted', 'dim', 'accent', 'ok', 'warn', 'err'];

for (const [name, t] of Object.entries(themes)) {
  test(`${name}: 본문 글자 색은 모든 판 위에서 4.5:1 이상`, () => {
    const rows = [];
    for (const fg of text) for (const bg of surfaces) {
      const r = ratio(t[fg], t[bg]);
      rows.push(`${fg} on ${bg} ${r.toFixed(2)}`);
      assert.ok(r >= 4.5, `${name} ${fg}(${t[fg]}) on ${bg}(${t[bg]}) = ${r.toFixed(2)}`);
    }
    console.log(name, rows.join(' | '));
  });
  test(`${name}: 포인트 버튼 글자 · 보라 점 · 선`, () => {
    assert.ok(ratio(t['accent-ink'], t.accent) >= 4.5, `${name} accent-ink on accent`);
    assert.ok(ratio(t.purple, t.card) >= 3, `${name} purple dot on card`);
    assert.ok(ratio(t.ink, t.bg) >= 15, `${name} ink on bg`);
  });
}
