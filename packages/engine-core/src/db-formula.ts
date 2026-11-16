// 데이터베이스 수식 속성 (GAP #19 — 노션 Formula): 항목마다 다른 속성 값으로 계산한 값. 저장하지 않고 그릴 때마다 계산한다.
// 글자를 직접 읽어 계산한다(eval 없음). 문법: 숫자 · "글자" · true/false, prop("속성 이름"), + - * / %(글자가 있으면 + 는 잇기),
// == != > >= < <=, && || !(and · or · not), 괄호, 함수 if · empty · length · concat · lower · upper · contains · replace ·
// round · floor · ceil · abs · min · max · toNumber · format · today · now · dateAdd · dateBetween · year · month · day.
// 날짜는 'YYYY-MM-DD' 글자. 잘못 쓰면 FormulaError(메시지는 한국어) — 칸에 '#오류'로 보인다.

export type FormulaValue = number | string | boolean | null;
export class FormulaError extends Error {}

type Node =
  | { k: 'lit'; v: FormulaValue }
  | { k: 'prop'; name: string }
  | { k: 'un'; op: '-' | '!'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] };

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|"((?:[^"\\]|\\.)*)"|([A-Za-z_][\w]*)|(==|!=|>=|<=|&&|\|\||[-+*/%(),<>!]))/y;

function tokenize(src: string): (string | { num: number } | { str: string } | { id: string })[] {
  const out: (string | { num: number } | { str: string } | { id: string })[] = [];
  TOKEN.lastIndex = 0;
  let at = 0;
  while (at < src.length) {
    if (!src.slice(at).trim()) break;
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(src);
    if (!m) throw new FormulaError(`읽을 수 없는 글자: '${src.slice(at).trim()[0]}'`);
    at = TOKEN.lastIndex;
    if (m[1] !== undefined) out.push({ num: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ str: m[2].replace(/\\(.)/g, '$1') });
    else if (m[3] !== undefined) out.push({ id: m[3] });
    else out.push(m[4]!);
  }
  return out;
}

const PREC: Record<string, number> = { '||': 1, or: 1, '&&': 2, and: 2, '==': 3, '!=': 3, '>': 4, '>=': 4, '<': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

/** 수식 글자 → 나무. 잘못 썼으면 FormulaError */
export function parseFormula(src: string): Node {
  const t = tokenize(src);
  let i = 0;
  const peek = () => t[i];
  const opOf = (x: (typeof t)[number] | undefined) => (typeof x === 'string' ? x : x && 'id' in x && (x.id === 'and' || x.id === 'or') ? x.id : null);
  const expect = (s: string) => { if (peek() !== s) throw new FormulaError(`'${s}'가 있어야 해요`); i++; };
  const primary = (): Node => {
    const x = t[i++];
    if (x === undefined) throw new FormulaError('수식이 덜 끝났어요');
    if (x === '(') { const e = expr(0); expect(')'); return e; }
    if (x === '-' || x === '!') return { k: 'un', op: x, a: primary() };
    if (typeof x === 'string') throw new FormulaError(`'${x}' 자리가 맞지 않아요`);
    if ('num' in x) return { k: 'lit', v: x.num };
    if ('str' in x) return { k: 'lit', v: x.str };
    if (x.id === 'true' || x.id === 'false') return { k: 'lit', v: x.id === 'true' };
    if (x.id === 'not') return { k: 'un', op: '!', a: primary() };
    if (peek() !== '(') throw new FormulaError(`'${x.id}' 뒤에 괄호가 있어야 해요 — 속성은 prop("이름")`);
    i++;
    const args: Node[] = [];
    if (peek() !== ')') { for (;;) { args.push(expr(0)); if (peek() === ',') { i++; continue; } break; } }
    expect(')');
    if (x.id === 'prop') {
      const a = args[0];
      if (args.length !== 1 || a?.k !== 'lit' || typeof a.v !== 'string') throw new FormulaError('prop("속성 이름")처럼 써 주세요');
      return { k: 'prop', name: a.v };
    }
    if (!(x.id in FNS)) throw new FormulaError(`모르는 함수: ${x.id}`);
    return { k: 'call', fn: x.id, args };
  };
  const expr = (min: number): Node => {
    let a = primary();
    for (;;) {
      const op = opOf(peek());
      const p = op ? PREC[op] : undefined;
      if (!op || p === undefined || p < min) break;
      i++;
      const b = expr(p + 1);
      a = { k: 'bin', op: op === 'and' ? '&&' : op === 'or' ? '||' : op, a, b };
    }
    return a;
  };
  const root = expr(0);
  if (i < t.length) throw new FormulaError('수식 끝에 남는 글자가 있어요');
  return root;
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
const toDate = (v: FormulaValue) => { if (!isDate(v)) throw new FormulaError('날짜가 아니에요 (YYYY-MM-DD)'); return new Date(`${v.slice(0, 10)}T00:00:00`); };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (v: FormulaValue): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new FormulaError(`숫자가 아니에요: "${v}"`);
  return n;
};
const str = (v: FormulaValue) => (v === null ? '' : typeof v === 'number' ? fmt(v) : typeof v === 'boolean' ? (v ? 'true' : 'false') : v);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000));
const truthy = (v: FormulaValue) => !(v === null || v === false || v === 0 || v === '');
const UNITS: Record<string, number> = { days: 1, day: 1, 일: 1, weeks: 7, week: 7, 주: 7 };
const monthsBetween = (a: Date, b: Date) => (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth()) - (a.getDate() < b.getDate() ? 1 : 0);

const FNS: Record<string, (a: FormulaValue[]) => FormulaValue> = {
  if: (a) => (truthy(a[0] ?? null) ? a[1] ?? null : a[2] ?? null),
  empty: (a) => !truthy(a[0] ?? null) && a[0] !== 0,
  not: (a) => !truthy(a[0] ?? null),
  length: (a) => str(a[0] ?? null).length,
  concat: (a) => a.map(str).join(''),
  lower: (a) => str(a[0] ?? null).toLowerCase(),
  upper: (a) => str(a[0] ?? null).toUpperCase(),
  contains: (a) => str(a[0] ?? null).includes(str(a[1] ?? null)),
  replace: (a) => str(a[0] ?? null).split(str(a[1] ?? null)).join(str(a[2] ?? null)),
  round: (a) => { const k = 10 ** num(a[1] ?? 0); return Math.round(num(a[0] ?? null) * k) / k; },
  floor: (a) => Math.floor(num(a[0] ?? null)),
  ceil: (a) => Math.ceil(num(a[0] ?? null)),
  abs: (a) => Math.abs(num(a[0] ?? null)),
  min: (a) => Math.min(...a.map(num)),
  max: (a) => Math.max(...a.map(num)),
  toNumber: (a) => { try { return num(a[0] ?? null); } catch { return null; } },
  format: (a) => str(a[0] ?? null),
  today: () => ymd(new Date()),
  now: () => { const d = new Date(); return `${ymd(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; },
  year: (a) => toDate(a[0] ?? null).getFullYear(),
  month: (a) => toDate(a[0] ?? null).getMonth() + 1,
  day: (a) => toDate(a[0] ?? null).getDate(),
  dateAdd: (a) => {
    const d = toDate(a[0] ?? null), n = num(a[1] ?? null), u = str(a[2] ?? 'days');
    if (u === 'months' || u === 'month' || u === '달') d.setMonth(d.getMonth() + n);
    else if (u === 'years' || u === 'year' || u === '해') d.setFullYear(d.getFullYear() + n);
    else d.setDate(d.getDate() + n * (UNITS[u] ?? 1));
    return ymd(d);
  },
  dateBetween: (a) => {
    const x = toDate(a[0] ?? null), y = toDate(a[1] ?? null), u = str(a[2] ?? 'days');
    if (u === 'months' || u === 'month' || u === '달') return monthsBetween(x, y);
    if (u === 'years' || u === 'year' || u === '해') return Math.trunc(monthsBetween(x, y) / 12);
    return Math.trunc(Math.round((x.getTime() - y.getTime()) / 86400000) / (UNITS[u] ?? 1));
  },
};

/** 나무 계산 — prop(이름) 값은 get이 준다 */
export function evalFormula(n: Node, get: (name: string) => FormulaValue): FormulaValue {
  switch (n.k) {
    case 'lit': return n.v;
    case 'prop': return get(n.name);
    case 'un': { const v = evalFormula(n.a, get); return n.op === '!' ? !truthy(v) : -num(v); }
    case 'call': return FNS[n.fn]!(n.args.map((a) => evalFormula(a, get)));
    case 'bin': {
      if (n.op === '&&') return truthy(evalFormula(n.a, get)) && truthy(evalFormula(n.b, get));
      if (n.op === '||') return truthy(evalFormula(n.a, get)) || truthy(evalFormula(n.b, get));
      const a = evalFormula(n.a, get), b = evalFormula(n.b, get);
      switch (n.op) {
        case '+': return typeof a === 'string' || typeof b === 'string' ? str(a) + str(b) : num(a) + num(b);
        case '-': return num(a) - num(b);
        case '*': return num(a) * num(b);
        case '/': { const d = num(b); if (d === 0) throw new FormulaError('0으로 나눌 수 없어요'); return num(a) / d; }
        case '%': return num(a) % num(b);
        case '==': return str(a) === str(b);
        case '!=': return str(a) !== str(b);
        default: {
          const both = typeof a === 'number' || typeof b === 'number';
          const x = both ? num(a) : str(a), y = both ? num(b) : str(b);
          return n.op === '>' ? x > y : n.op === '>=' ? x >= y : n.op === '<' ? x < y : x <= y;
        }
      }
    }
  }
}

/** 수식 값 → 칸 글자 (숫자는 소수 넷째 자리까지, 참 · 거짓은 예 · 아니요) */
export function formulaText(v: FormulaValue): string {
  return v === null ? '' : typeof v === 'number' ? (Number.isFinite(v) ? fmt(v) : '') : typeof v === 'boolean' ? (v ? '예' : '아니요') : v;
}
