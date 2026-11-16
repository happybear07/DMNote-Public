// 할 일 모아보기 (FR-137): 노트의 할 일 항목 모으기 · 글 속 날짜 읽기 · 기한 묶음. DOM 없이 계산만.
import { isTextContent, nodeText, type Engine, type Id, type TextNode } from '@dn/engine-core';
import { toNode } from '@dn/text-pm/headless';

export interface TodoItem {
  noteId: Id;
  blockId: Id;
  contentId: Id;
  /** 문서 안 task_item 위치 (flipAttrSteps에 넘긴다) */
  pos: number;
  text: string;
  checked: boolean;
  /** 글에서 읽은 기한 (그날 0시) */
  due?: number;
}

/** 노트 하나의 할 일 (읽기 순서: 위 → 아래, 왼쪽 → 오른쪽) */
export function collectTodos(engine: Engine, now = Date.now()): TodoItem[] {
  const out: TodoItem[] = [];
  const blocks = [...engine.blocks()].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const b of blocks) {
    for (const c of engine.contentsOf(b.id)) {
      if (!isTextContent(c) || !JSON.stringify(c.doc).includes('task_item')) continue;
      toNode(c.doc).descendants((n, pos) => {
        if (n.type.name !== 'task_item') return true;
        // 항목의 첫 문단 글자 (하위 목록은 따로 항목이 된다)
        const text = nodeText((n.firstChild?.toJSON() ?? { type: 'paragraph' }) as TextNode).trim();
        const due = parseDue(text, now);
        out.push({ noteId: engine.note.id, blockId: b.id, contentId: c.id, pos, text, checked: !!n.attrs.checked, ...(due !== undefined ? { due } : {}) });
        return true;
      });
    }
  }
  // AI가 만든 상자(노트 요약 등)의 할 일이 같은 노트의 다른 할 일과 글이 같으면 한 번만 — 모아보기 · 개수에 두 번 나오지 않게 (교차 검토 A7).
  // 요약이 글에서 새로 뽑은 할 일은 그대로 남는다
  const ai = new Set(blocks.filter((b) => b.ai).map((b) => b.id)), norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  const own = new Set(out.filter((x) => !ai.has(x.blockId)).map((x) => norm(x.text)));
  return out.filter((x) => !ai.has(x.blockId) || !own.has(norm(x.text)));
}

const DAY = 86_400_000;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 글 속 날짜: 2026-10-05 · 2026.10.5 · 10/5 · 10월 5일 · 오늘 · 내일 · 모레 · (이번 주/다음 주) 금요일.
 * 연도가 없으면 올해(이미 반년 넘게 지났으면 내년). 못 읽으면 undefined.
 */
export function parseDue(text: string, now = Date.now()): number | undefined {
  const today = startOfDay(now);
  const y0 = new Date(now).getFullYear();
  const mk = (y: number, m: number, d: number) => {
    const t = new Date(y, m - 1, d).getTime();
    return new Date(t).getMonth() === m - 1 ? t : undefined; // 2월 30일 같은 것
  };
  const withYear = (m: number, d: number) => {
    const t = mk(y0, m, d);
    return t !== undefined && today - t > 182 * DAY ? mk(y0 + 1, m, d) : t;
  };
  let m = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(text);
  if (m) return mk(+m[1]!, +m[2]!, +m[3]!);
  m = /(\d{1,2})월\s*(\d{1,2})일/.exec(text);
  if (m) return withYear(+m[1]!, +m[2]!);
  m = /(?:^|[^\d/.])(\d{1,2})[/.](\d{1,2})(?![\d/.])/.exec(text);
  if (m && +m[1]! <= 12) return withYear(+m[1]!, +m[2]!);
  if (/모레/.test(text)) return today + 2 * DAY;
  if (/내일/.test(text)) return today + DAY;
  if (/오늘/.test(text)) return today;
  m = /(다음\s*주\s*)?([월화수목금토일])요일/.exec(text);
  if (m) {
    const want = WEEKDAYS.indexOf(m[2]!);
    const cur = new Date(today).getDay();
    if (!m[1]) return today + ((want - cur + 7) % 7) * DAY; // 다가오는 그 요일 (오늘 포함)
    // 다음 주 = 다음 월요일부터 시작하는 주의 그 요일
    const toMonday = (1 - cur + 7) % 7 || 7;
    return today + (toMonday + (want - 1 + 7) % 7) * DAY;
  }
  return undefined;
}

export type TodoGroup = 'overdue' | 'today' | 'week' | 'later' | 'none';
export const GROUP_LABEL: Record<TodoGroup, string> = { overdue: '기한 지남', today: '오늘', week: '이번 주', later: '나중', none: '날짜 없음' };

/** 기한 묶음: 이번 주 = 오늘 다음 날부터 이번 주 일요일까지 */
export function groupOf(due: number | undefined, now = Date.now()): TodoGroup {
  if (due === undefined) return 'none';
  const today = startOfDay(now);
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  const dow = new Date(today).getDay();
  const endOfWeek = today + ((7 - dow) % 7) * DAY;
  return due <= endOfWeek ? 'week' : 'later';
}

export function fmtDue(due: number, now = Date.now()): string {
  const diff = Math.round((due - startOfDay(now)) / DAY);
  const d = new Date(due);
  const year = d.getFullYear() !== new Date(now).getFullYear() ? `${d.getFullYear()}년 ` : '';
  const md = `${year}${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  if (diff === 0) return '오늘';
  if (diff === 1) return `내일 · ${md}`;
  if (diff < 0) return `${-diff}일 지남 · ${md}`;
  return md;
}
