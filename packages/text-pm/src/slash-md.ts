// 슬래시(/) 메뉴 원본 읽기 (docs/SLASH-COMMANDS.md): '## 제목' = 묶음, 표 한 줄 = 명령(이름 | 검색어 | 설명 | 실행 | 노션).
// '계획'이 든 절과 실행이 '계획'인 줄은 넣지 않는다. 모르는 실행 이름은 건너뛰고 경고만 — 사용자가 고친 표 하나 때문에 메뉴 전체가 죽지 않게.
import { isoDate, WEEK } from './dates';
import type { FormatCommand } from './format';

export type SlashAction =
  | { kind: 'format'; cmd: FormatCommand }
  /** 상자 밖 일 — 호스트(캔버스 · 문서 뷰)가: 넣기 종류('table' …) · 'action:duplicate' · 'color:red' · 'bg:red' */
  | { kind: 'insert'; what: string }
  | { kind: 'link' }
  | { kind: 'page' }
  /** 날짜 언급: 오늘에서 며칠 */
  | { kind: 'date'; offset: number }
  /** 마크다운 조각 ({오늘} · {지금} … 자리 표시는 넣을 때 바꾼다) */
  | { kind: 'text'; md: string }
  | { kind: 'ai' }
  /** 기호 · 이모지 · 상호 참조 고르기 판 */
  | { kind: 'symbols'; which: 'symbol' | 'emoji' | 'xref' };

export interface SlashItem {
  id: string;
  label: string;
  hint: string;
  /** 검색어 — 한글 · 영문 · 흔한 별칭 */
  keywords: string[];
  /** 묶음 머리 (md의 ## 제목) */
  section: string;
  action: SlashAction;
  /** 노션에서의 이름 (참고) */
  notion: string;
  ai?: boolean;
}

const FORMAT: readonly FormatCommand[] = ['paragraph', 'h1', 'h2', 'h3', 'h4', 'bullet', 'ordered', 'task', 'toggle', 'toggleH1', 'toggleH2', 'toggleH3', 'quote', 'callout', 'code_block', 'math', 'mathInline', 'divider', 'footnote'];
export const SLASH_INSERTS = ['table', 'chart', 'image', 'video', 'audio', 'file', 'record', 'toc', 'database', 'db-board', 'db-calendar', 'db-gallery', 'db-list', 'db-timeline', 'db-chart', 'columns-2', 'columns-3', 'columns-4', 'columns-5', 'embed', 'bookmark', 'web-embed', 'button', 'tabs'] as const;
const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red', 'default'];
const DATES: Record<string, number> = { 오늘: 0, 내일: 1, 어제: -1 };

/** 실행 칸 → 동작 · id. 모르면 null */
function action(run: string, label: string): { id: string; action: SlashAction } | null {
  const sp = run.indexOf(' ');
  const verb = sp < 0 ? run : run.slice(0, sp), arg = sp < 0 ? '' : run.slice(sp + 1).trim();
  switch (verb) {
    case '서식': return (FORMAT as readonly string[]).includes(arg) ? { id: arg === 'code_block' ? 'code' : arg, action: { kind: 'format', cmd: arg as FormatCommand } } : null;
    case '넣기': return (SLASH_INSERTS as readonly string[]).includes(arg) ? { id: arg, action: { kind: 'insert', what: arg } } : null;
    case '동작':
      if (arg === 'link' || arg === 'page') return { id: arg, action: { kind: arg } };
      if (arg === 'symbol' || arg === 'emoji' || arg === 'xref') return { id: arg, action: { kind: 'symbols', which: arg } };
      return ['duplicate', 'delete', 'copy-link', 'comment', 'move', 'select', 'select-block'].includes(arg) ? { id: arg, action: { kind: 'insert', what: `action:${arg}` } } : null;
    case '색': return COLORS.includes(arg) ? { id: `color-${arg}`, action: { kind: 'insert', what: `color:${arg}` } } : null;
    case '배경': return COLORS.includes(arg) ? { id: `bg-${arg}`, action: { kind: 'insert', what: `bg:${arg}` } } : null;
    case '날짜': return arg in DATES ? { id: `date-${arg}`, action: { kind: 'date', offset: DATES[arg]! } } : null;
    case '글': return arg ? { id: `text:${label}`, action: { kind: 'text', md: arg.replace(/\\n/g, '\n') } } : null;
    case 'AI': return arg === '구조화' ? { id: 'ai', action: { kind: 'ai' } } : null;
    default: return null;
  }
}

/** 표 한 줄 → 칸들 (\| 는 글자 |) */
function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}
const unquote = (s: string) => s.replace(/^`(.*)`$/, '$1');

/** md → 메뉴 항목. bad: 건너뛴 줄 (이유) */
export function parseSlashMd(md: string): { items: SlashItem[]; bad: string[] } {
  const items: SlashItem[] = [], bad: string[] = [], ids = new Set<string>();
  let section = '', table = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^##\s+(.+)$/.exec(line);
    if (h) { section = h[1]!.trim(); table = false; continue; }
    if (!line.startsWith('|')) { table = false; continue; }
    const c = cells(line);
    if (c[0] === '이름' && c[3] === '실행') { table = true; continue; }
    if (!table || /^:?-{2,}:?$/.test(c[0] ?? '') || section.includes('계획')) continue;
    const [label = '', keys = '', hint = '', run = '', notion = ''] = c;
    if (!label || unquote(run) === '계획') continue;
    const a = action(unquote(run), label);
    if (!a) { bad.push(`${label}: 모르는 실행 '${run}'`); continue; }
    if (ids.has(a.id)) { bad.push(`${label}: 같은 명령이 이미 있음 (${a.id})`); continue; }
    ids.add(a.id);
    items.push({
      id: a.id, label, hint, section, action: a.action, notion: notion === '-' ? '' : notion,
      keywords: keys.split(',').map((k) => k.trim()).filter(Boolean),
      ...(a.action.kind === 'ai' ? { ai: true } : {}),
    });
  }
  return { items, bad };
}

/** 날짜 언급에 쓰는 YYYY-MM-DD (오늘에서 offset일) */
export function isoDay(offset = 0, now = new Date()): string {
  return isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
}

/** 글 조각의 자리 표시: {오늘} {내일} {어제} → 2026년 10월 8일, {요일} → 목요일, {지금} → 2026년 10월 8일 오후 3:05 */
export function fillSlashText(md: string, now = new Date()): string {
  const day = (off: number) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`; };
  const h = now.getHours(), time = `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`;
  return md.replace(/\{오늘\}/g, day(0)).replace(/\{내일\}/g, day(1)).replace(/\{어제\}/g, day(-1))
    .replace(/\{요일\}/g, `${WEEK[now.getDay()]}요일`).replace(/\{지금\}/g, `${day(0)} ${time}`);
}
