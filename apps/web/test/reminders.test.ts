// 알림 (FR-136): 시각이 붙은 날짜 멘션 모으기(체크한 할 일은 끝남 · 잠긴 노트는 글자 없이) · 지난/다음 알림 시각(반복 포함)
import { describe, expect, it } from 'vitest';
import { createDatabaseBlock, createTextBlock, dbRows, Engine, isDatabaseContent, setDbPropertyRemind, setDbValue, type TextDoc } from '@dn/engine-core';
import { collectReminders, inQuiet, lastOccurrence, nextOccurrence, reminderKey, type NoteReminder } from '../src/reminders';

const mention = (date: string, time = '', repeat = '') => ({ type: 'date_mention', attrs: { date, time, repeat } });
const text = (t: string) => ({ type: 'text', text: t });
const para = (...c: unknown[]) => ({ type: 'paragraph', content: c });
const task = (checked: boolean, ...c: unknown[]) => ({ type: 'task_item', attrs: { checked }, content: [para(...c)] });

function engine(): Engine {
  const e = new Engine();
  const doc = {
    type: 'doc', content: [
      para(text('보고서 마감 '), mention('2026-10-09', '18:00')),
      para(text('그냥 날짜 '), mention('2026-10-10')),
      { type: 'task_list', content: [task(false, text('약 먹기 '), mention('2026-10-05', '09:00', 'daily')), task(true, text('끝난 일 '), mention('2026-10-06', '10:00'))] },
    ],
  } as TextDoc;
  const r = createTextBlock(e, { x: 0, y: 0 }, { doc });
  if (!r.ok) throw new Error('setup');
  return e;
}

describe('알림 모으기', () => {
  it('시각이 있는 날짜만 · 그 줄 글자 · 체크한 할 일은 끝남 · 반복', () => {
    const rs = collectReminders(engine());
    expect(rs.map((r) => [r.date, r.time, r.repeat, r.text, r.done])).toEqual([
      ['2026-10-09', '18:00', '', '보고서 마감', false],
      ['2026-10-05', '09:00', 'daily', '약 먹기', false],
      ['2026-10-06', '10:00', '', '끝난 일', true],
    ]);
  });
  it('데이터베이스 날짜 속성 알림: 날짜가 있는 항목마다 · 글자는 항목 이름', () => {
    const e = new Engine();
    const b = createDatabaseBlock(e, { x: 0, y: 0 });
    if (!b.ok) throw new Error('db');
    const c = [...e.contents()].find(isDatabaseContent)!;
    const [name, , date] = c.properties;
    const [r1, r2] = dbRows(c);
    setDbValue(e, c.id, r1!.id, name!.id, '보고서 제출');
    setDbValue(e, c.id, r1!.id, date!.id, '2026-10-09');
    setDbValue(e, c.id, r2!.id, name!.id, '날짜 없는 항목');
    expect(collectReminders(e)).toEqual([]);
    setDbPropertyRemind(e, c.id, date!.id, '09:30');
    expect(collectReminders(e).map((r) => [r.date, r.time, r.text])).toEqual([['2026-10-09', '09:30', '보고서 제출']]);
    // 같은 날짜의 항목 둘 — 열쇠가 겹치면 하나만 울린다
    setDbValue(e, c.id, r2!.id, date!.id, '2026-10-09');
    const two = collectReminders(e);
    expect(two).toHaveLength(2);
    expect(new Set(two.map((r) => reminderKey('n', r))).size).toBe(2);
    setDbPropertyRemind(e, c.id, date!.id, null);
    expect(collectReminders(e)).toEqual([]);
  });

  it('잠긴 노트: 글자는 남기지 않는다', () => {
    expect(collectReminders(engine(), { hideText: true }).every((r) => r.text === '')).toBe(true);
  });
});

describe('알림 시각', () => {
  const r = (date: string, time: string, repeat: NoteReminder['repeat'] = ''): NoteReminder => ({ blockId: 'b', date, time, repeat, text: '', done: false });
  const at = (m: number, d: number, h: number, mi = 0) => new Date(2026, m - 1, d, h, mi).getTime();
  it('한 번: 지나면 그 시각, 아직이면 null · 다음 시각', () => {
    expect(lastOccurrence(r('2026-10-09', '18:00'), at(10, 9, 17, 59))).toBeNull();
    expect(lastOccurrence(r('2026-10-09', '18:00'), at(10, 9, 18, 0))).toBe(at(10, 9, 18));
    expect(nextOccurrence(r('2026-10-09', '18:00'), at(10, 1, 0))).toBe(at(10, 9, 18));
    expect(nextOccurrence(r('2026-10-09', '18:00'), at(10, 10, 0))).toBeNull();
  });
  it('매일 · 매주: 가장 최근 · 다음', () => {
    const daily = r('2026-10-05', '09:00', 'daily');
    expect(lastOccurrence(daily, at(10, 8, 8, 59))).toBe(at(10, 7, 9));
    expect(lastOccurrence(daily, at(10, 8, 9, 0))).toBe(at(10, 8, 9));
    expect(nextOccurrence(daily, at(10, 8, 9, 30))).toBe(at(10, 9, 9));
    const weekly = r('2026-10-05', '09:00', 'weekly');
    expect(lastOccurrence(weekly, at(10, 20, 12))).toBe(at(10, 19, 9));
    expect(nextOccurrence(weekly, at(10, 20, 12))).toBe(at(10, 26, 9));
  });
  it('열쇠는 날짜 · 시각 · 반복을 바꾸면 달라진다 (새 알림)', () => {
    expect(reminderKey('n', r('2026-10-09', '18:00'))).not.toBe(reminderKey('n', r('2026-10-09', '18:30')));
  });
});

describe('방해 금지 (FR-138)', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 5, h, m).getTime();
  it('자정을 넘는 시간대 · 같은 날 시간대 · 끝 시각은 포함하지 않음 · 없으면 늘 아님', () => {
    const night = { inApp: true, device: true, quiet: { from: '22:00', to: '08:00' } };
    expect([at(23), at(2), at(7, 59), at(8), at(12), at(21, 59)].map((x) => inQuiet(night, x))).toEqual([true, true, true, false, false, false]);
    const lunch = { inApp: true, device: true, quiet: { from: '12:00', to: '13:00' } };
    expect([at(12, 30), at(13), at(11)].map((x) => inQuiet(lunch, x))).toEqual([true, false, false]);
    expect(inQuiet({ inApp: true, device: true }, at(23))).toBe(false);
  });
});
