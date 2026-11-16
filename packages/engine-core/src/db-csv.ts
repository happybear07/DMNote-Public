// 데이터베이스 ↔ CSV (GAP #13 — 노션 ••• › 내보내기 › CSV): 지금 보기 그대로(필터 · 정렬 · 숨긴 속성 빼고) 내보내고,
// CSV 파일을 새 데이터베이스로 가져온다(열 값으로 속성 타입 추정 — 노션 내보내기 속 CSV도 같은 길). 엑셀이 한글을 바로 읽도록 BOM + CRLF.
import type { Engine } from './engine';
import { DB_OPTION_COLORS, type DatabaseContent, type DatabaseData, type DbOption, type DbProperty, type DbPropType, type DbRow, type DbValue } from './database';
import { dbCellTextIn } from './db-relations';
import { activeDbView, viewRows, type DbView } from './db-views';
import { newId } from './id';
import { keyBetween, type OrderKey } from './order';

/** 칸 하나 — 스프레드시트가 수식으로 읽는 첫 글자(= + - @ 탭 CR)는 ' 를 앞에 붙여 글로 (보안 2-6) */
const csvCell = (raw: string) => {
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 지금 보기 기준 CSV — 숨기지 않은 속성, 필터를 지난 항목, 보기의 정렬. 체크박스는 예 · 아니요(가져오기가 다시 체크박스로 읽는다) */
export function dbToCsv(engine: Engine, d: DatabaseContent, view: DbView = activeDbView(d)): { csv: string; rows: number } {
  const props = d.properties.filter((p) => !p.hidden);
  const rows = viewRows(d, view);
  const text = (r: DbRow, p: DbProperty) => (p.type === 'checkbox' ? (r.values[p.id] === true ? '예' : '아니요') : dbCellTextIn(engine, d, r, p));
  const lines = [props.map((p) => csvCell(p.name)), ...rows.map((r) => props.map((p) => csvCell(text(r, p))))].map((l) => l.join(','));
  return { csv: `\uFEFF${lines.join('\r\n')}\r\n`, rows: rows.length };
}

/** RFC 4180 CSV (따옴표 · 줄바꿈 · BOM) → 행 × 칸, 빈 줄은 뺀다 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const t = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const DATE_LIKE = /^(\d{4}[-./]\d{1,2}[-./]\d{1,2}|[A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}년)/;
function toDate(s: string): string | null {
  const first = s.split(' → ')[0]!.trim();
  const ko = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(first);
  const d = ko ? new Date(+ko[1]!, +ko[2]! - 1, +ko[3]!) : new Date(first.replace(/(\d{4})[./](\d{1,2})[./](\d{1,2})/, '$1-$2-$3').replace(/ \d{1,2}:\d{2}.*$/, ''));
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const toNum = (s: string) => { const n = Number(s.replace(/[,\s%$₩]/g, '')); return /\d/.test(s) && Number.isFinite(n) ? n : null; };

/** 열 값으로 속성 타입 추정 (첫 열은 항목 이름 = 텍스트) */
export function inferType(values: readonly string[]): DbPropType {
  const v = values.map((x) => x.trim()).filter(Boolean);
  if (!v.length) return 'text';
  if (v.every((x) => /^(yes|no|예|아니요|true|false)$/i.test(x))) return 'checkbox';
  if (v.every((x) => /^-?[\d,]*\.?\d+\s*%?$/.test(x))) return 'number';
  if (v.every((x) => DATE_LIKE.test(x) && toDate(x))) return 'date';
  if (v.every((x) => /^https?:\/\/\S+$/i.test(x))) return 'url';
  const tokens = v.flatMap((x) => x.split(/,\s*/).map((t) => t.trim()).filter(Boolean));
  const distinct = new Set(tokens).size;
  const short = tokens.every((t) => t.length <= 30);
  if (short && v.some((x) => x.includes(',')) && distinct < tokens.length && distinct <= Math.max(8, v.length)) return 'multiSelect';
  if (v.every((x) => x.length <= 40) && new Set(v).size <= Math.min(20, Math.max(2, Math.ceil(v.length * 0.6))) && new Set(v).size < v.length) return 'select';
  return 'text';
}

/** CSV 머리 줄 + 행 → 데이터베이스 콘텐츠 데이터(id 포함) + 행 id 목록(행 순서 그대로) */
export function csvToDatabase(header: readonly string[], body: readonly (readonly string[])[], title: string, id: string = newId()): { data: DatabaseData & { id: string }; rowIds: string[] } {
  const props = header.map((name, i): DbProperty => ({
    id: newId(), name: name.trim() || `속성 ${i + 1}`, type: i === 0 ? 'text' : inferType(body.map((r) => r[i] ?? '')), width: i === 0 ? 220 : 140,
  }));
  const options = props.map((): DbOption[] => []);
  const opt = (i: number, name: string) => {
    let o = options[i]!.find((x) => x.name === name);
    if (!o) { o = { id: newId(), name, color: DB_OPTION_COLORS[options[i]!.length % DB_OPTION_COLORS.length]! }; options[i]!.push(o); }
    return o.id;
  };
  let order: OrderKey | null = null;
  const rowIds: string[] = [];
  const rows = body.map((r): DbRow => {
    const values: Record<string, DbValue> = {};
    props.forEach((p, i) => {
      const s = (r[i] ?? '').trim();
      if (!s) return;
      values[p.id] = p.type === 'number' ? toNum(s) : p.type === 'checkbox' ? /^(yes|예|true)$/i.test(s) : p.type === 'date' ? toDate(s) ?? s
        : p.type === 'select' ? opt(i, s) : p.type === 'multiSelect' ? [...new Set(s.split(/,\s*/).filter(Boolean).map((t) => opt(i, t.trim())))] : s;
    });
    order = keyBetween(order, null);
    const rid = newId();
    rowIds.push(rid);
    return { id: rid, order, values };
  });
  const properties = props.map((p, i) => (p.type === 'select' || p.type === 'multiSelect' ? { ...p, options: options[i] } : p));
  return { data: { id, title, properties, rows }, rowIds };
}
