// 홈 달력 (11/03): 한 달 칸 · 날마다 항목 — 알림(반복) · 할 일 기한 · 만든 · 고친 노트
import { describe, expect, it } from 'vitest';
import type { NoteMeta, NoteReminder } from '@dn/storage-idb';
import { calendarItems, monthGrid, weekGrid } from '../src/calendar';
import type { TodoItem } from '../src/todos';

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const note = (id: string, o: Partial<NoteMeta> = {}): NoteMeta => ({ id, title: id, createdAt: day(2026, 1, 1).getTime(), updatedAt: day(2026, 1, 1).getTime(), schemaVersion: 1, ...o }) as NoteMeta;
const rem = (o: Partial<NoteReminder>): NoteReminder => ({ blockId: 'b', date: '2026-11-10', time: '09:30', repeat: '', text: '회의', done: false, ...o });
const NOV = [day(2026, 11, 1), day(2026, 12, 13)] as const; // 2026년 11월 칸 (11/1 일요일부터 42일)

describe('monthGrid', () => {
  it('1일이 든 주의 일요일부터 42일', () => {
    const g = monthGrid(2026, 10);
    expect(g).toHaveLength(42);
    expect(g[0]!.getDay()).toBe(0);
    expect([g[0]!.getMonth(), g[0]!.getDate()]).toEqual([10, 1]); // 2026-11-01은 일요일
    const oct = monthGrid(2026, 9);
    expect([oct[0]!.getMonth(), oct[0]!.getDate()]).toEqual([8, 27]); // 10/1(목) → 9/27(일)부터
  });
});

describe('calendarItems', () => {
  it('알림 한 번 — 그날 · 시각 · 노트 이름', () => {
    const m = calendarItems([note('기획', { reminders: [rem({})] })], [], ...NOV);
    const [it] = m.get('2026-11-10')!;
    expect(it).toMatchObject({ kind: 'remind', text: '회의', sub: '09:30 · 기획', noteId: '기획', blockId: 'b' });
    expect(new Date(it!.at!).getHours()).toBe(9);
  });

  it('매일 반복은 범위 안 날마다, 매주 반복은 같은 요일마다 — 시작 전 날은 없음', () => {
    const m = calendarItems([note('n', { reminders: [rem({ date: '2026-10-20', repeat: 'daily', id: 'd' }), rem({ date: '2026-11-04', repeat: 'weekly', id: 'w' })] })], [], ...NOV);
    const daily = [...m.values()].flat().filter((i) => i.key.includes('|d|'));
    expect(daily).toHaveLength(42);
    const weekly = [...m.values()].flat().filter((i) => i.key.includes('|w|')).map((i) => i.day);
    expect(weekly).toEqual(['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25', '2026-12-02', '2026-12-09']);
  });

  it('끝낸 알림은 빼고, 잠긴 노트는 알림 글 대신 노트 이름', () => {
    const m = calendarItems([note('a', { reminders: [rem({ done: true })] }), note('비밀', { locked: true, reminders: [rem({ text: '보이면 안 됨' })] })], [], ...NOV);
    expect(m.get('2026-11-10')!.map((i) => i.text)).toEqual(['비밀']);
  });

  it('범위 밖 알림 · 기한은 없음', () => {
    const m = calendarItems([note('a', { reminders: [rem({ date: '2027-01-05' })] })], [{ noteId: 'a', blockId: 'b', contentId: 'c', pos: 1, text: 'x', checked: false, due: day(2026, 10, 1).getTime() }], ...NOV);
    expect(m.size).toBe(0);
  });

  it('할 일 기한 · 끝낸 표시, 만든 날 · 고친 날(다른 날일 때만)', () => {
    const todos: TodoItem[] = [{ noteId: 'p', blockId: 'b', contentId: 'c', pos: 3, text: '보고서', checked: true, due: day(2026, 11, 12).getTime() }];
    const notes = [note('p', { createdAt: day(2026, 11, 2).getTime() + 3600_000, updatedAt: day(2026, 11, 12).getTime() + 7200_000 }), note('q', { createdAt: day(2026, 11, 5).getTime(), updatedAt: day(2026, 11, 5).getTime() + 60_000 })];
    const m = calendarItems(notes, todos, ...NOV);
    expect(m.get('2026-11-02')!.map((i) => i.sub)).toEqual(['만든 노트']);
    expect(m.get('2026-11-05')!.map((i) => i.sub)).toEqual(['만든 노트']);
    expect(m.get('2026-11-12')!.map((i) => [i.kind, i.done ?? false])).toEqual([['todo', true], ['note', false]]);
  });

  it('그날 안 차례: 알림(이른 시각 먼저) → 할 일 → 노트', () => {
    const notes = [note('n', { createdAt: day(2026, 11, 10).getTime(), updatedAt: day(2026, 11, 10).getTime(), reminders: [rem({ time: '18:00', id: '1' }), rem({ time: '08:05', id: '2' })] })];
    const todos: TodoItem[] = [{ noteId: 'n', blockId: 'b', contentId: 'c', pos: 1, text: '할 일', checked: false, due: day(2026, 11, 10).getTime() }];
    expect(calendarItems(notes, todos, ...NOV).get('2026-11-10')!.map((i) => i.kind + (i.at ? `@${new Date(i.at).getHours()}` : ''))).toEqual(['remind@8', 'remind@18', 'todo', 'note']);
  });
});

describe('weekGrid (내 페이지 오늘 주 띠)', () => {
  it('그날이 든 주의 일요일부터 7일 — 달이 바뀌는 주도', () => {
    expect(weekGrid(day(2026, 11, 11)).map((d) => d.getDate())).toEqual([8, 9, 10, 11, 12, 13, 14]);
    const wrap = weekGrid(day(2026, 12, 2));
    expect(wrap.map((d) => `${d.getMonth() + 1}/${d.getDate()}`)).toEqual(['11/29', '11/30', '12/1', '12/2', '12/3', '12/4', '12/5']);
    expect(weekGrid(day(2026, 11, 8))[0]!.getDate()).toBe(8); // 일요일이면 그날부터
  });
});
