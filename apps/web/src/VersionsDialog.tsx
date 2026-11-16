// 버전 기록 (FR-093): 이 노트의 지난 스냅샷 목록 → 고르면 문서 모양 미리보기(읽기) → 이 버전으로 되돌리기 · 지금 상태 저장.
import { useEffect, useRef, useState } from 'react';
import { DocView } from '@dn/engine-dom';
import { diffBlocks } from '@dn/engine-core';
import type { VersionInfo } from '@dn/storage-idb';
import type { Workspace } from './workspace';
import { VERSION_REASON } from './ws-versions';
import { Icon } from './Icon';

const fmt = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function VersionsDialog({ ws, noteId }: { ws: Workspace; noteId: string }) {
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []); // 열면 대화상자에 초점 — Esc로 바로 닫히게
  // 지금과 비교 (FR-135): 이 버전에만 있는 블록 · 고친 블록 · 그 뒤 새로 생긴 블록 수
  const [diff, setDiff] = useState<{ gone: number; changed: number; added: number; links: number } | null>(null);
  const reload = () => void ws.listVersions(noteId).then((l) => { setList(l); setSel((s) => s ?? l[0]?.at ?? null); });
  useEffect(reload, [ws, noteId]);
  // 미리보기: 그 버전을 읽기 전용 문서 뷰로
  useEffect(() => {
    if (sel === null || !host.current) return;
    let view: DocView | null = null, live = true;
    void ws.versionEngine(noteId, sel).then((e) => {
      if (!live || !e || !host.current) return;
      host.current.replaceChildren();
      view = new DocView({ engine: e, container: host.current, readOnly: true });
      const now = ws.view?.engine;
      if (now && now.note.id === noteId) {
        const d = diffBlocks(e, now);
        const mark = (ids: string[], cls: string, title: string) => { for (const id of ids) { const el = host.current?.querySelector<HTMLElement>(`.dn-doc-item[data-id="${id}"]`); if (el) { el.classList.add(cls); el.title = title; } } };
        mark(d.onlyA, 'diff-gone', '지금은 없는 블록');
        mark(d.changed, 'diff-changed', '이 버전 뒤에 고친 블록');
        setDiff({ gone: d.onlyA.length, changed: d.changed.length, added: d.onlyB.length, links: d.arrowsA + d.arrowsB });
      } else setDiff(null);
    });
    return () => { live = false; view?.destroy(); };
  }, [ws, noteId, sel]);
  const close = () => ws.closeDialog();
  const cur = list?.find((v) => v.at === sel);
  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div ref={box} tabIndex={-1} className="dialog tpl-dialog ver-dialog" role="dialog" aria-modal="true" aria-label="버전 기록" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
        <div className="tpl-head">
          <h2>버전 기록</h2>
          <button className="icon-btn" aria-label="닫기" onClick={close}><Icon name="close" size={14} /></button>
        </div>
        <div className="tpl-body">
          <div className="tpl-list ver-list" role="listbox" aria-label="버전 목록">
            {list === null && <p className="ver-empty">불러오는 중…</p>}
            {list?.length === 0 && <p className="ver-empty">아직 남은 버전이 없어요. 고친 뒤 10분마다, 노트를 떠날 때, 큰 변경 전에 자동으로 남아요.</p>}
            {list?.map((v) => (
              <button key={v.at} role="option" aria-selected={v.at === sel} className={`ver-item${v.at === sel ? ' on' : ''}`} onClick={() => setSel(v.at)}>
                <b>{fmt(v.at)}</b>
                <small>{VERSION_REASON[v.reason]} · 블록 {v.blocks}개</small>
              </button>
            ))}
          </div>
          <div className="ver-side">
            {diff && (
              <p className="ver-diff" role="status">
                지금과 비교: {diff.gone + diff.changed + diff.added + diff.links === 0 ? '같아요' : <>
                  {!!diff.gone && <span className="d-gone">이 버전에만 {diff.gone}</span>}
                  {!!diff.changed && <span className="d-changed">고침 {diff.changed}</span>}
                  {!!diff.added && <span className="d-added">그 뒤 새로 {diff.added}</span>}
                  {!!diff.links && <span className="d-links">연결 바뀜 {diff.links}</span>}
                </>}
              </p>
            )}
            <div className="ver-preview" ref={host} aria-label="미리보기" />
          </div>
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={() => void ws.saveVersion('manual', true).then(() => { ws.toast('지금 상태를 버전으로 남겼어요.'); setSel(null); reload(); })}>지금 상태 저장</button>
          <button className="btn primary" disabled={!cur} onClick={() => { if (cur) void ws.restoreVersion(cur.at).then((ok) => { if (ok) close(); }); }}>
            이 버전으로 되돌리기
          </button>
        </div>
      </div>
    </div>
  );
}
