// 홈 달력 (11/03): 한 달 칸(6주 × 7일)과 날마다의 항목 — 앱 안 데이터만: 알림(반복 포함) · 할 일 기한 · 만든 · 고친 노트.
// 바깥 일정(구글 캘린더 같은 커넥터)은 나중에 같은 CalItem(kind 'event')으로 더한다. 날짜 열쇠는 기기 시간대의 'YYYY-MM-DD'.
import type { NoteMeta } from '@dn/storage-idb';
import { fromIso, isoDate } from '@dn/text-pm';
import type { TodoItem } from './todos';
import { displayTitle } from './ws-model';

export type CalKind = 'remind' | 'todo' | 'note' | 'event';
export interface CalItem {
  readonly key: string; readonly day: string; readonly kind: CalKind;
  /** 보이는 글 · 작은 글 (시각 · 노트 이름 …) */
  readonly text: string; readonly sub: string;
  /** 그날 안 순서 — 알림 시각, 없으면 뒤로 */
  readonly at?: number;
  readonly noteId?: string; readonly blockId?: string;
  readonly done?: boolean;
}

/** 이 달 칸: 1일이 든 주의 일요일부터 42일 */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - first.getDay() + i));
}

/** 그날이 든 주(일요일부터) 7일 — 내 페이지 '오늘' 카드의 주 띠 (11/11) */
export function weekGrid(day: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => new Date(day.getFullYear(), day.getMonth(), day.getDate() - day.getDay() + i));
}

const RANK: Record<CalKind, number> = { event: 0, remind: 1, todo: 2, note: 3 };
/** 15:00 */
export const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** [from, to) 사이(날 단위 — 둘 다 그날 0시)의 항목, 날짜 열쇠별 · 그날 안에서는 바깥 일정 → 알림(시각 순) → 할 일 → 노트 */
export function calendarItems(notes: readonly NoteMeta[], todos: readonly TodoItem[], from: Date, to: Date, extra: readonly CalItem[] = []): Map<string, CalItem[]> {
  const out = new Map<string, CalItem[]>();
  const t0 = from.getTime(), t1 = to.getTime();
  const add = (it: CalItem) => { const a = out.get(it.day); if (a) a.push(it); else out.set(it.day, [it]); };
  for (const n of notes) {
    // 알림: 반복이면 그 범위 안의 날마다 (같은 시각)
    for (const r of n.reminders ?? []) {
      const base = fromIso(r.date), t = /^(\d{1,2}):(\d{2})$/.exec(r.time);
      if (!base || !t || r.done) continue;
      const step = r.repeat === 'daily' ? 1 : r.repeat === 'weekly' ? 7 : 0;
      let d = new Date(base);
      if (step && d.getTime() < t0) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + Math.ceil((t0 - d.getTime()) / 86_400_000 / step) * step);
      for (; d.getTime() < t1; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + step)) {
        if (d.getTime() >= t0) {
          const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +t[1]!, +t[2]!).getTime();
          add({ key: `r|${n.id}|${r.blockId}|${r.id ?? ''}|${isoDate(d)}`, day: isoDate(d), kind: 'remind', text: (!n.locked && r.text) || displayTitle(n), sub: `${hhmm(at)} · ${displayTitle(n)}`, at, noteId: n.id, ...(r.blockId ? { blockId: r.blockId } : {}) });
        }
        if (!step) break;
      }
    }
    // 노트: 만든 날 · (다른 날이면) 마지막으로 고친 날
    const made = isoDate(new Date(n.createdAt)), edited = isoDate(new Date(n.updatedAt));
    if (n.createdAt >= t0 && n.createdAt < t1) add({ key: `c|${n.id}`, day: made, kind: 'note', text: displayTitle(n), sub: '만든 노트', noteId: n.id });
    if (edited !== made && n.updatedAt >= t0 && n.updatedAt < t1) add({ key: `u|${n.id}`, day: edited, kind: 'note', text: displayTitle(n), sub: '고친 노트', noteId: n.id });
  }
  const byId = new Map(notes.map((n) => [n.id, n]));
  for (const td of todos) {
    if (td.due === undefined || td.due < t0 || td.due >= t1) continue;
    const n = byId.get(td.noteId);
    add({ key: `t|${td.noteId}|${td.contentId}|${td.pos}`, day: isoDate(new Date(td.due)), kind: 'todo', text: td.text || '(빈 할 일)', sub: `할 일 · ${n ? displayTitle(n) : ''}`, noteId: td.noteId, blockId: td.blockId, done: td.checked });
  }
  for (const it of extra) add(it);
  for (const list of out.values()) list.sort((a, b) => RANK[a.kind] - RANK[b.kind] || (a.at ?? Infinity) - (b.at ?? Infinity));
  return out;
}
