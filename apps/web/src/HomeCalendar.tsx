// 내 페이지 '오늘' 카드 (11/03 달력 → 11/11): 평소엔 이번 주 7일 띠 + 고른 날 항목(알림 · 할 일 · 노트 — 누르면 그 노트 · 블록으로),
// 'YYYY년 M월'을 누르면 한 달 칸으로 펼쳐 넓은 카드가 된다(HOME-DESIGN-REFS HD-U1). 주 · 달 넘기기 · 오늘.
// 앱 안 데이터만 쓴다(calendar.ts). 바깥 일정(커넥터)은 나중에 같은 칸에 'event'로.
import { useMemo, useState } from 'react';
import { dateLabel, isoDate, type IconName } from '@dn/text-pm';
import { Icon } from './Icon';
import { calendarItems, monthGrid, weekGrid, type CalItem, type CalKind } from './calendar';
import type { Workspace, WorkspaceState } from './workspace';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const KIND_ICON: Record<CalKind, IconName> = { event: 'calendar', remind: 'flag', todo: 'checkSquare', note: 'note' };
const KIND_LABEL: Record<CalKind, string> = { event: '일정', remind: '알림', todo: '할 일', note: '노트' };

export function HomeCalendar({ ws, s, now }: { ws: Workspace; s: WorkspaceState; now: number }) {
  const today = isoDate(new Date(now));
  const [ym, setYm] = useState(() => ({ y: new Date(now).getFullYear(), m: new Date(now).getMonth() }));
  const [pick, setPick] = useState(today);
  const [full, setFull] = useState(false);
  const pickDate = useMemo(() => { const [y, m, d] = pick.split('-').map(Number); return new Date(y!, m! - 1, d!); }, [pick]);
  const grid = useMemo(() => (full ? monthGrid(ym.y, ym.m) : weekGrid(pickDate)), [full, ym, pickDate]);
  const items = useMemo(() => {
    const last = grid[grid.length - 1]!;
    return calendarItems(s.notes, s.todoList ?? [], grid[0]!, new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }, [s.notes, s.todoList, grid]);
  /** 고른 날 — 주 띠에서는 달 이름도 그날의 달로 */
  const choose = (d: Date) => { setPick(isoDate(d)); if (!full) setYm({ y: d.getFullYear(), m: d.getMonth() }); };
  const move = (k: number) => {
    if (!full) { choose(new Date(pickDate.getFullYear(), pickDate.getMonth(), pickDate.getDate() + 7 * k)); return; }
    setYm(({ y, m }) => { const d = new Date(y, m + k, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  };
  const goToday = () => { const d = new Date(now); setYm({ y: d.getFullYear(), m: d.getMonth() }); setPick(today); };
  const list = items.get(pick) ?? [];
  const open = (it: CalItem) => { if (it.noteId) void ws.openHit(it.noteId, it.blockId); };

  return (
    <section className={`card cal-card${full ? ' wide full' : ' week'}`} aria-label="오늘">
      <h2>오늘
        <span className="cal-nav">
          <button className="icon-btn" aria-label={full ? '지난달' : '지난주'} title={full ? '지난달' : '지난주'} onClick={() => move(-1)}><Icon name="chevronLeft" size={16} /></button>
          <button className="cal-month" aria-live="polite" aria-expanded={full} title={full ? '이번 주만 보기' : '한 달 달력 펼치기'}
            onClick={() => { if (full) setYm({ y: pickDate.getFullYear(), m: pickDate.getMonth() }); setFull(!full); }}>{ym.y}년 {ym.m + 1}월</button>
          <button className="icon-btn" aria-label={full ? '다음 달' : '다음 주'} title={full ? '다음 달' : '다음 주'} onClick={() => move(1)}><Icon name="chevronRight" size={16} /></button>
          <button className="text-btn" onClick={goToday}>오늘</button>
        </span>
      </h2>
      <div className="cal-body">
        <div className="cal-grid">
          {WEEK.map((w, i) => <span key={w} className={`cal-wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`} aria-hidden>{w}</span>)}
          {grid.map((d) => {
            const key = isoDate(d), its = items.get(key) ?? [], kinds = [...new Set(its.map((i) => i.kind))];
            const cls = `cal-day${full && d.getMonth() !== ym.m ? ' out' : ''}${key === today ? ' today' : ''}${key === pick ? ' on' : ''}${d.getDay() === 0 ? ' sun' : ''}`;
            return (
              <button key={key} className={cls} aria-pressed={key === pick} onClick={() => choose(d)}
                aria-label={`${d.getMonth() + 1}월 ${d.getDate()}일${key === today ? ' 오늘' : ''}${its.length ? ` · ${kinds.map((k) => KIND_LABEL[k]).join(' · ')} ${its.length}개` : ''}`}>
                <span className="cal-num">{d.getDate()}</span>
                <span className="cal-dots" aria-hidden>{kinds.map((k) => <i key={k} className={k} />)}</span>
              </button>
            );
          })}
        </div>
        <div className="cal-list">
          <div className="cal-list-head">{dateLabel(pick, new Date(now))}{list.length ? <small>{list.length}개</small> : null}</div>
          {!list.length ? <p className="card-empty">이날은 알림 · 할 일 · 노트가 없어요.</p> : (
            <ul>
              {list.map((it) => (
                <li key={it.key} className={`${it.kind}${it.done ? ' done' : ''}`}>
                  <button onClick={() => open(it)} disabled={!it.noteId}>
                    <Icon name={KIND_ICON[it.kind]} size={14} />
                    <span><b>{it.text}</b><small>{it.sub}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
