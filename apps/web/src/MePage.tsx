// 내 페이지 (11/10 — 예전 홈 대시보드 UX-FLOW 09를 옮김): 계정 · 빠른 메모(→ 받은 메모) · 이어서 쓰기 · 오늘(주 띠 · 펼치면 한 달) · 오늘 할 일 ·
// 저장 공간과 백업 · 다가오는 알림 · 즐겨찾기(FR-075) · 이번 주 · 태그.
// 홈은 서재(모든 노트를 책으로, HomePage.tsx). 벤토 그리드 3열(데스크톱) · 2열(태블릿) · 1열(폰) — 책상 바닥(--side) 위 테두리 없는 종이 카드.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NoteGlyph } from './NoteLook';
import { HomeCalendar } from './HomeCalendar';
import { ContinueCard } from './ContinueCard';
import { QuickMemo } from './QuickMemo';
import { dateLabel, isoDate } from '@dn/text-pm';
import { reminderKey } from './reminders';
import { LegalLinks } from './LegalDialog';
import { fmtDue, groupOf, type TodoItem } from './todos';
import { ago, displayTitle, type Workspace, type WorkspaceState } from './workspace';
import { DAY, tagCounts } from './ws-model';
import { hhmm } from './calendar';

/** 알림 시각: 오늘 15:00 · 내일 09:00 · 10월 9일 (금) 09:00 */
const whenLabel = (at: number, now: number) => `${dateLabel(isoDate(new Date(at)), new Date(now))} ${hhmm(at)}`;

const fmtBytes = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))}KB` : b < 1024 ** 3 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${(b / 1024 ** 3).toFixed(1)}GB`);

/** menu: 좁은 화면에서 사이드바 서랍을 여는 단추 (MenuBtn) */
export function MePage({ ws, s, menu }: { ws: Workspace; s: WorkspaceState; menu?: ReactNode }) {
  const now = Date.now();
  const upcoming = ws.upcomingReminders(now, 5);
  const byId = useMemo(() => new Map(s.notes.map((n) => [n.id, n])), [s.notes]);
  const titleOf = (id: string) => { const n = byId.get(id); return n ? displayTitle(n) : ''; };
  const favorites = ws.favorites;
  const todos = s.todoList ?? [];
  const pending = todos.filter((t) => !t.checked);
  const urgent = pending.filter((t) => ['overdue', 'today'].includes(groupOf(t.due, now)));
  const week = pending.filter((t) => groupOf(t.due, now) === 'week').length;
  const shown: TodoItem[] = [...urgent, ...pending.filter((t) => !urgent.includes(t))].slice(0, 5);
  const editedThisWeek = s.notes.filter((n) => now - n.updatedAt < 7 * DAY).length;
  const blocks = s.notes.reduce((sum, n) => sum + (n.stats?.blocks ?? 0), 0);
  const topTags = useMemo(() => [...tagCounts(s.notes)].sort((a, b) => b[1] - a[1]).slice(0, 12), [s.notes]);

  // 저장 공간 (FR-091): 브라우저가 알려 주는 사용량 · 한도 · 지워지지 않게 고정됐는지
  const [store, setStore] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const est = await navigator.storage?.estimate?.().catch(() => null);
      const persisted = (await navigator.storage?.persisted?.().catch(() => false)) ?? false;
      if (alive && est) setStore({ usage: est.usage ?? 0, quota: est.quota ?? 0, persisted });
    })();
    return () => { alive = false; };
  }, []);
  const backupDays = s.lastExportAt ? Math.floor((now - s.lastExportAt) / DAY) : null;
  const backupWarn = backupDays === null || backupDays >= 7;

  const d = new Date(now);
  return (
    <div className="trash-page home-page me-page">
      <div className="home-scroll">
        <header className="home-head">
          <div>
            <h1>{menu}내 페이지</h1>
            <p>{d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })} · {s.account
              ? <>{s.account.email} · <button className="text-btn" onClick={() => ws.openSettings('account')}>계정 · 동기화</button></>
              : <>이 기기에만 저장 중 · <button className="text-btn" onClick={() => ws.auth.open()}>로그인</button></>}</p>
          </div>
          <div className="home-actions">
            <button className="btn" onClick={() => void ws.exportAll()}>모든 노트 내보내기</button>
          </div>
        </header>

        <QuickMemo ws={ws} />
        <div className="bento">
          <ContinueCard ws={ws} s={s} />
          <HomeCalendar ws={ws} s={s} now={now} />
          <section className="card wide" aria-label="오늘 할 일">
            <h2>오늘 할 일
              <span className="card-meta">{s.todoLoading && !s.todoList ? '모으는 중…' : `급한 일 ${urgent.length} · 이번 주 ${week} · 전체 ${pending.length}`}</span>
              <button className="text-btn" onClick={() => ws.showTodos()}>모두 보기</button>
            </h2>
            {s.todoList && !pending.length && <p className="card-empty">남은 할 일이 없어요.</p>}
            <ul className="home-todos">
              {shown.map((t) => {
                const g = groupOf(t.due, now);
                return (
                  <li key={`${t.noteId}:${t.contentId}:${t.pos}`} className={t.checked ? 'done' : ''}>
                    <input type="checkbox" checked={t.checked} aria-label={`${t.text} 완료`} onChange={() => void ws.toggleTodo(t)} />
                    <button onClick={() => void ws.openHit(t.noteId, t.blockId)}>
                      <span>{t.text || '(빈 할 일)'}</span>
                      <small>{titleOf(t.noteId)}
                        {t.due !== undefined && <em className={g}>{fmtDue(t.due, now)}</em>}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card" aria-label="저장 공간 · 백업">
            <h2>저장 · 백업</h2>
            {store && (
              <div className="meter" title={`${fmtBytes(store.usage)} / ${fmtBytes(store.quota)}`}>
                <div style={{ width: `${Math.min(100, Math.max(1, (store.usage / Math.max(1, store.quota)) * 100))}%` }} />
              </div>
            )}
            <p className="card-line">{store ? `이 기기에 ${fmtBytes(store.usage)} 사용 · 브라우저 한도 ${fmtBytes(store.quota)}` : '사용량을 알 수 없어요'}</p>
            {store && !store.persisted && <p className="card-line warn">공간이 모자라면 브라우저가 지울 수 있어요. 가끔 내보내 두세요.</p>}
            <p className={`card-line${backupWarn ? ' warn' : ''}`}>{backupDays === null ? '아직 한 번도 내보내지 않았어요.' : backupDays === 0 ? '오늘 내보냈어요.' : `마지막 내보내기 ${backupDays}일 전`}</p>
            <button className="btn sm" onClick={() => void ws.exportAll()}>모든 노트 내보내기</button>
          </section>


          {/* 비어 있는 알림 · 즐겨찾기 카드는 숨긴다 (U-4) — 생기면 나타난다 */}
          {upcoming.length > 0 && <section className="card" aria-label="다가오는 알림">
            <h2>다가오는 알림</h2>
            <ul className="home-notes">
              {upcoming.map((d) => (
                <li key={reminderKey(d.noteId, d.r)}><button onClick={() => void ws.openHit(d.noteId, d.r.blockId)}>
                  <span>{d.r.text || d.title}</span><small>{whenLabel(d.at, now)}{d.r.repeat ? ` · ${d.r.repeat === 'daily' ? '매일' : '매주'}` : ''} · {d.title}</small>
                </button></li>
              ))}
            </ul>
          </section>}

          {favorites.length > 0 && <section className="card" aria-label="즐겨찾기">
            <h2>즐겨찾기</h2>
            <ul className="home-notes">
              {favorites.map((n) => (
                <li key={n.id}><button onClick={() => void ws.openById(n.id)}><span><NoteGlyph icon={n.icon} size={14} />{displayTitle(n)}</span><small>{ago(n.updatedAt, now)}</small></button></li>
              ))}
            </ul>
          </section>}

          <section className="card" aria-label="이번 주">
            <h2>이번 주</h2>
            <div className="stats">
              <div><b>{editedThisWeek}</b><span>고친 노트</span></div>
              <div><b>{s.notes.length}</b><span>전체 노트</span></div>
              <div><b>{blocks.toLocaleString()}</b><span>상자</span></div>
              <div><b>{s.tags.length}</b><span>태그</span></div>
            </div>
          </section>

          {topTags.length > 0 && (
            <section className="card" aria-label="태그">
              <h2>태그</h2>
              <div className="home-tags">
                {topTags.map(([id, count]) => {
                  const t = s.tags.find((x) => x.id === id);
                  return t ? <button key={id} className="tag-item" onClick={() => ws.setTagFilter(id)}><span className="tag-name">#{t.name}</span><span className="count">{count}</span></button> : null;
                })}
              </div>
            </section>
          )}
        </div>
        {/* 약관 · 처리방침 · AI 안내 (LEGAL-RISK R1 · DEPLOY-PLAN 6.5 "첫 화면 아래") */}
        <footer className="home-legal"><LegalLinks /></footer>
      </div>
    </div>
  );
}
