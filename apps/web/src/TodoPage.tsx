// 할 일 모아보기 (FR-137): 모든 노트의 할 일을 기한별로 — 기한 지남 · 오늘 · 이번 주 · 나중 · 날짜 없음.
// 체크하면 원래 노트의 할 일도 바뀐다. 항목을 누르면 그 노트의 그 상자로.
import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { fmtDue, GROUP_LABEL, groupOf, type TodoGroup, type TodoItem } from './todos';
import { displayTitle, type Workspace, type WorkspaceState } from './workspace';

const ORDER: TodoGroup[] = ['overdue', 'today', 'week', 'later', 'none'];

export function TodoPage({ ws, s, menu }: { ws: Workspace; s: WorkspaceState; menu?: ReactNode }) {
  const [showDone, setShowDone] = useState(false);
  /** 여기서 방금 체크한 항목은 끝났어도 줄 그은 채로 남겨 둔다 (잘못 눌렀으면 바로 되돌리게) — 새로 고치면 정리 */
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const keyOf = (t: TodoItem) => `${t.noteId}:${t.contentId}:${t.pos}`;
  const now = Date.now();
  const titles = useMemo(() => new Map(s.notes.map((n) => [n.id, displayTitle(n)])), [s.notes]);
  const list = s.todoList ?? [];
  const open = list.filter((t) => !t.checked).length;
  const groups = useMemo(() => {
    const m = new Map<TodoGroup, TodoItem[]>();
    for (const t of list) {
      if (t.checked && !showDone && !touched.has(keyOf(t))) continue;
      const g = groupOf(t.due, now);
      m.set(g, [...(m.get(g) ?? []), t]);
    }
    for (const items of m.values()) items.sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
    return ORDER.filter((g) => m.has(g)).map((g) => [g, m.get(g)!] as const);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, showDone, touched]);

  return (
    <div className="trash-page todo-page">
      <div className="todo-head">
        {menu}
        <h1><Icon name="checkSquare" size={20} />할 일</h1>
        <span className="todo-sum">{s.todoLoading && !s.todoList ? '모으는 중…' : `남은 일 ${open.toLocaleString()}개 · 노트 ${new Set(list.map((t) => t.noteId)).size}개에서`}</span>
        <label className="todo-done"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />끝난 일도 보기</label>
        <button className="btn sm" onClick={() => { setTouched(new Set()); void ws.loadTodos(); }} disabled={s.todoLoading}>새로 고침</button>
      </div>
      <p className="todo-hint">할 일 글에 날짜를 쓰면 기한으로 묶어요 <span className="hint-q" title="예: 10/5 · 10월 5일 · 2026-10-05 · 내일 · 금요일 · 다음 주 월요일" aria-label="날짜 쓰는 법: 10/5 · 10월 5일 · 2026-10-05 · 내일 · 금요일 · 다음 주 월요일"><Icon name="question" size={14} /></span></p>
      <div className="todo-body">
        {s.todoList && !groups.length && (
          <div className="trash-empty"><strong>{list.length ? '남은 할 일이 없어요' : '아직 할 일이 없어요'}</strong>
            <span>노트의 상자에서 <code>[]</code>와 빈칸을 치면 할 일 목록이 생겨요.</span></div>
        )}
        {groups.map(([g, items]) => (
          <section key={g} className={`todo-group ${g}`} aria-label={GROUP_LABEL[g]}>
            <h2>{GROUP_LABEL[g]} <span>{items.length}</span></h2>
            {items.map((t) => (
              <div key={keyOf(t)} className={`todo-row${t.checked ? ' done' : ''}`}>
                <input type="checkbox" checked={t.checked} aria-label={`${t.text} ${t.checked ? '완료 취소' : '완료'}`} onChange={() => { setTouched((x) => new Set(x).add(keyOf(t))); void ws.toggleTodo(t); }} />
                <button className="todo-text" onClick={() => void ws.openHit(t.noteId, t.blockId)} title="이 할 일이 있는 노트로">
                  <span>{t.text || '(빈 할 일)'}</span>
                  <small><Icon name="note" size={12} />{titles.get(t.noteId) ?? ''}{t.due !== undefined && <em>{fmtDue(t.due, now)}</em>}</small>
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
