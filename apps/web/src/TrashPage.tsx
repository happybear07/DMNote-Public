// 14 휴지통 (Figma 앱 화면 27:2, FR-076). 복원 · 영구 삭제 · 비우기 · 다중 선택.
import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { NoteGlyph } from './NoteLook';
import type { NoteMeta } from '@dn/storage-idb';
import { displayTitle, TRASH_DAYS, type Workspace } from './workspace';
import type { ConfirmRequest } from './ConfirmDialog';
import { DAY } from './ws-model';

const fmt = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

function daysLeft(n: NoteMeta, now: number): number {
  return Math.max(0, Math.ceil((n.deletedAt! + TRASH_DAYS * DAY - now) / DAY));
}

export function TrashPage({ ws, trash, confirm, menu }: { ws: Workspace; trash: NoteMeta[]; confirm: (r: ConfirmRequest) => void; menu?: ReactNode }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const now = Date.now();
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? trash.filter((n) => displayTitle(n).toLowerCase().includes(k)) : trash;
  }, [trash, q]);
  const selected = [...sel].filter((id) => trash.some((n) => n.id === id));

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = rows.length > 0 && rows.every((n) => sel.has(n.id));

  const askDelete = (ids: string[]) => {
    const one = ids.length === 1 ? trash.find((n) => n.id === ids[0]) : undefined;
    confirm(one
      ? { title: '노트를 영구 삭제할까요?', body: `'${displayTitle(one)}' 노트를 영구 삭제하면 되돌릴 수 없어요.`, confirmLabel: '영구 삭제', onConfirm: () => { void ws.deleteForever(ids); setSel(new Set()); } }
      : { title: '노트를 영구 삭제할까요?', body: `노트 ${ids.length}개를 영구 삭제해요. 되돌릴 수 없어요.`, confirmLabel: `${ids.length}개 영구 삭제`, onConfirm: () => { void ws.deleteForever(ids); setSel(new Set()); } });
  };
  const askEmpty = () => confirm({
    title: '휴지통을 비울까요?', body: `노트 ${trash.length}개를 영구 삭제해요. 되돌릴 수 없어요.`,
    confirmLabel: `${trash.length}개 영구 삭제`, onConfirm: () => { void ws.emptyTrash(); setSel(new Set()); },
  });

  return (
    <div className="trash-page">
      <header className="topbar">{menu}<span className="doc-icon"><Icon name="trash" size={16} /></span><span className="page-name">휴지통</span></header>
      <div className="trash-body">
        {/* 소개 · 경고를 회색 한 줄로 (DS-020) — 제목은 위 막대에 있다 */}
        <div className="trash-banner">
          <span>삭제한 노트는 {TRASH_DAYS}일 동안 보관해요. 비우면 되돌릴 수 없어요.</span>
          <button className="btn" disabled={!trash.length} onClick={askEmpty}>휴지통 비우기</button>
        </div>

        {trash.length === 0 ? (
          <div className="trash-empty"><strong>휴지통이 비어 있어요</strong></div>
        ) : (
          <>
            <div className="trash-tools">
              <input className="search" placeholder="휴지통에서 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="휴지통에서 검색" />
              <span className="meta">노트 {trash.length}개 · 삭제일 최신순</span>
            </div>
            <table className="trash-table">
              <thead>
                <tr>
                  <th className="chk"><input type="checkbox" aria-label="전체 선택" checked={allOn}
                    onChange={() => setSel(allOn ? new Set() : new Set(rows.map((n) => n.id)))} /></th>
                  <th>이름</th><th>원래 위치</th><th>삭제일</th><th>남은 기간</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => {
                  const d = daysLeft(n, now);
                  return (
                    <tr key={n.id} className={sel.has(n.id) ? 'on' : ''}>
                      <td className="chk"><input type="checkbox" aria-label={`${displayTitle(n)} 선택`} checked={sel.has(n.id)} onChange={() => toggle(n.id)} /></td>
                      <td>
                        <div className="t-name"><NoteGlyph icon={n.icon} size={14} />{displayTitle(n)}</div>
                        <div className="t-sub">블록 {n.stats?.blocks ?? 0}개</div>
                      </td>
                      <td className="t-muted">노트</td>
                      <td className="t-muted">{fmt.format(n.deletedAt!)}</td>
                      <td><span className={`days${d <= 7 ? ' soon' : ''}`}>{d <= 7 ? `${d}일 뒤 삭제` : `${d}일 남음`}</span></td>
                      <td className="t-act">
                        <button className="btn sm" onClick={() => void ws.restore([n.id])}>↺ 복원</button>
                        <button className="btn sm text-danger" onClick={() => askDelete([n.id])}>영구 삭제</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="foot">휴지통의 노트는 검색 결과와 AI 구조화 대상에서 빠져요.</p>
          </>
        )}
      </div>

      {selected.length > 0 && (
        <div className="selbar" role="toolbar" aria-label="선택한 노트">
          <strong>{selected.length}개 선택됨</strong>
          <button onClick={() => { void ws.restore(selected); setSel(new Set()); }}>↺ 복원</button>
          <button className="text-danger" onClick={() => askDelete(selected)}>영구 삭제</button>
          <button aria-label="선택 해제" onClick={() => setSel(new Set())}><Icon name="close" size={14} /></button>
        </div>
      )}
    </div>
  );
}
