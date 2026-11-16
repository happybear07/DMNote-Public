// 알림 (FR-136): 노트의 날짜 멘션 중 시각이 붙은 것 모으기 · 다음/지난 알림 시각 계산. DOM 없이 계산만.
// 할 일 안의 알림은 체크하면 끝난 것으로 본다. 잠긴 노트는 글자를 남기지 않는다(목록 정보에 본문이 새지 않게).
import { dbCellText, dbRows, isDatabaseContent, isTextContent, nodeText, readingOrder, type Engine, type Id, type TextNode } from '@dn/engine-core';
import type { NoteReminder } from '@dn/storage-idb';

export type { NoteReminder };

const DAY = 86_400_000;

/** 노트 하나의 알림 (읽는 순서) */
export function collectReminders(engine: Engine, opts: { hideText?: boolean } = {}): NoteReminder[] {
  const out: NoteReminder[] = [];
  for (const b of readingOrder(engine.blocks())) {
    for (const c of engine.contentsOf(b.id)) {
      // 데이터베이스 날짜 속성 알림: 항목마다 그 날짜 · 그 시각, 글자는 항목 이름(첫 속성)
      if (isDatabaseContent(c)) {
        const title = c.properties[0];
        for (const p of c.properties) {
          if (p.type !== 'date' || !p.remind || !/^\d{2}:\d{2}$/.test(p.remind)) continue;
          for (const row of dbRows(c)) {
            const date = row.values[p.id];
            if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
            const text = opts.hideText || !title ? '' : dbCellText(title, row.values[title.id]).slice(0, 120);
            out.push({ blockId: b.id, date, time: p.remind, repeat: '', text, done: false, id: `${c.id}:${row.id}:${p.id}` });
          }
        }
        continue;
      }
      if (!isTextContent(c) || !JSON.stringify(c.doc).includes('"time":"')) continue;
      let i = 0; // 이 콘텐츠 안 알림 순서 (체크한 할 일도 센다 — 체크해도 다른 알림의 열쇠가 바뀌지 않게)
      const walk = (n: TextNode, done: boolean) => {
        const inDone = done || (n.type === 'task_item' && !!n.attrs?.checked);
        const kids = n.content ?? [];
        for (const k of kids) {
          if (k.type !== 'date_mention') continue;
          const time = typeof k.attrs?.time === 'string' ? k.attrs.time : '';
          const date = typeof k.attrs?.date === 'string' ? k.attrs.date : '';
          if (!/^\d{2}:\d{2}$/.test(time) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          const repeat = k.attrs?.repeat === 'daily' || k.attrs?.repeat === 'weekly' ? k.attrs.repeat : '';
          // 그 줄 글자 — 날짜 멘션 자체는 빼고 (알림에 시각이 따로 붙는다)
          const text = opts.hideText ? '' : kids.map((x) => (x.type === 'date_mention' ? '' : nodeText(x))).join('').replace(/\s+/g, ' ').trim().slice(0, 120);
          out.push({ blockId: b.id, date, time, repeat, text, done: inDone, id: `${c.id}:${i++}` });
        }
        for (const k of kids) if (k.content) walk(k, inDone);
      };
      walk(c.doc, false);
    }
  }
  return out;
}

/** 알림 시각 기준점 (기기 시간대) */
function base(r: NoteReminder): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date), t = /^(\d{2}):(\d{2})$/.exec(r.time);
  if (!m || !t) return null;
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +t[1]!, +t[2]!);
}

/** `now` 이전(포함)의 가장 최근 알림 시각 — 아직 한 번도 오지 않았으면 null */
export function lastOccurrence(r: NoteReminder, now: number): number | null {
  const b = base(r);
  if (!b || b.getTime() > now) return null;
  if (!r.repeat) return b.getTime();
  const step = r.repeat === 'daily' ? 1 : 7;
  // 날짜 단위로 더한다 (서머타임이 있어도 같은 시각)
  const days = Math.floor((now - b.getTime()) / DAY / step) * step;
  let d = new Date(b.getFullYear(), b.getMonth(), b.getDate() + days, b.getHours(), b.getMinutes());
  if (d.getTime() > now) d = new Date(b.getFullYear(), b.getMonth(), b.getDate() + days - step, b.getHours(), b.getMinutes());
  return d.getTime();
}

/** `now` 이후의 다음 알림 시각 (반복 없고 지났으면 null) */
export function nextOccurrence(r: NoteReminder, now: number): number | null {
  const b = base(r);
  if (!b) return null;
  if (b.getTime() > now) return b.getTime();
  if (!r.repeat) return null;
  const last = lastOccurrence(r, now)!;
  const l = new Date(last);
  return new Date(l.getFullYear(), l.getMonth(), l.getDate() + (r.repeat === 'daily' ? 1 : 7), l.getHours(), l.getMinutes()).getTime();
}

/** 알림 하나를 가리키는 열쇠 (보낸 기록용) — 날짜 · 시각 · 반복을 바꾸면 새 알림 */
export const reminderKey = (noteId: Id, r: NoteReminder) => `${noteId}|${r.blockId}|${r.id ?? ''}|${r.date}|${r.time}|${r.repeat}`;

/** 알림 설정 (FR-138): 받는 곳 · 방해 금지 시간대('HH:MM' — 끝이 시작보다 이르면 자정을 넘김) */
export interface RemindPrefs { inApp: boolean; device: boolean; quiet?: { from: string; to: string } }

/** 방해 금지 시간인가 (기기 시간대) */
export function inQuiet(p: RemindPrefs, now: number): boolean {
  if (!p.quiet) return false;
  const m = (s: string) => { const [h, mi] = s.split(':').map(Number); return (h ?? 0) * 60 + (mi ?? 0); };
  const d = new Date(now), cur = d.getHours() * 60 + d.getMinutes(), a = m(p.quiet.from), b = m(p.quiet.to);
  return a === b ? false : a < b ? cur >= a && cur < b : cur >= a || cur < b;
}
