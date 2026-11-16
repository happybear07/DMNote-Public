// HTML 붙여넣기 (FR-031 · SECURITY 5.1). 파싱은 스키마의 parseDOM 규칙만 따르므로 모르는 태그 · 속성은 애초에 들어오지 않는다.
// 여기서는 "실행될 수 있는 것이 있었는가"만 따로 세어 사용자에게 알린다 (MSG-PASTE-001 — 실제로 뺐을 때만).
import type { TextDoc } from '@dn/engine-core';
import { DOMParser as PMDOMParser } from 'prosemirror-model';
import { toJSON } from './codec';
import { schema } from './schema';

export interface PasteReport { removedActive: boolean }

let parser: PMDOMParser | null = null;

/** 붙여넣은 HTML에서 스크립트 · 이벤트 속성 · javascript: 링크를 지우고 있었는지 알려 준다. */
export function scrubHTML(html: string): { html: string; body: HTMLElement; report: PasteReport } {
  // DOMParser 문서는 비활성 — 스크립트가 실행되지 않고 이미지도 불러오지 않는다
  const dom = new DOMParser().parseFromString(html, 'text/html');
  let removed = false;
  for (const el of dom.querySelectorAll('script, iframe, object, embed, style, link, meta')) {
    if (el.tagName !== 'STYLE' && el.tagName !== 'META' && el.tagName !== 'LINK') removed = true;
    el.remove();
  }
  for (const el of dom.body.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name)) { el.removeAttribute(a.name); removed = true; }
      else if ((a.name === 'href' || a.name === 'src') && /^\s*(javascript|vbscript|data):/i.test(a.value)) { el.removeAttribute(a.name); removed = true; }
    }
  }
  return { html: dom.body.innerHTML, body: dom.body, report: { removedActive: removed } };
}

/** 붙여넣은 표 — 표 블록으로 만든다 (글 문서에는 표가 없다) */
export interface PastedTable { readonly columns: string[]; readonly rows: string[][]; /** 500행 · 30열을 넘어 잘림 */ readonly cut?: boolean }
const MAX_COLS = 30, MAX_ROWS = 500;

/** HTML의 표를 떼어 낸다. 머리글: thead나 첫 줄이 모두 th면 그 줄, 아니면 '열 n'.
 *  배치용 표(메일 · 뉴스레터의 role=presentation, 칸 하나, 칸 안에 문단 · 제목 · 코드 같은 덩어리)는 떼지 않는다 — 스키마가 글로 읽는다 */
function takeTables(body: HTMLElement): PastedTable[] {
  const out: PastedTable[] = [];
  for (const t of [...body.querySelectorAll('table')]) {
    if (!t.isConnected || t.parentElement?.closest('table')) continue; // 표 안의 표는 바깥 표의 칸 글자로
    const trs = [...t.querySelectorAll('tr')].filter((tr) => tr.closest('table') === t);
    const cells = (tr: Element) => [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
    const all = trs.flatMap(cells);
    if (/^(presentation|none)$/i.test(t.getAttribute('role') ?? '') || all.length <= 1
      || all.some((c) => c.querySelector('p, div, h1, h2, h3, h4, h5, h6, pre, ul, ol, li, blockquote, table, img, hr'))) continue;
    const cut = trs.some((tr) => cells(tr).length > MAX_COLS);
    const grid = trs.map((tr) => cells(tr).slice(0, MAX_COLS).map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim())).filter((r) => r.length);
    t.remove();
    if (!grid.length) continue;
    const first = trs.find((tr) => cells(tr).length);
    const head = !!t.querySelector('thead') || (!!first && cells(first).every((c) => c.tagName === 'TH'));
    const width = Math.max(...grid.map((r) => r.length));
    const columns = Array.from({ length: width }, (_, i) => (head ? grid[0]![i] : '') || `열 ${i + 1}`);
    const body = head ? grid.slice(1) : grid;
    const rows = body.slice(0, MAX_ROWS).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
    out.push({ columns, rows: rows.length ? rows : [Array.from({ length: width }, () => '')], ...(cut || body.length > MAX_ROWS ? { cut: true } : {}) });
  }
  return out;
}

/** 캔버스에 붙여넣은 HTML → 텍스트 문서 (블록 하나로 만들 때). tables면 표는 따로 돌려준다 (FR-031) */
export function htmlToDoc(html: string, opts: { tables?: boolean } = {}): { doc: TextDoc; report: PasteReport; tables: PastedTable[] } {
  const { body, report } = scrubHTML(html);
  const tables = opts.tables ? takeTables(body) : [];
  parser ??= PMDOMParser.fromSchema(schema);
  return { doc: toJSON(parser.parse(body)), report, tables };
}

/** 편집 중 붙여넣기: 표가 있으면 표를 뗀 나머지 HTML과 표들, 없으면 null */
export function splitTables(html: string): { html: string; tables: PastedTable[] } | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const { body } = scrubHTML(html);
  const tables = takeTables(body);
  return tables.length ? { html: body.innerHTML, tables } : null;
}
