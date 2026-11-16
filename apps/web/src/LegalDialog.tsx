// 이용약관 · 개인정보 처리방침 · AI 이용 안내 창 (LEGAL-RISK R1, 10/26). 다른 창(설정 · AI 동의) 위에 뜨고, 닫으면 그 창으로 돌아간다.
// 본문(legal/*.md)은 열 때 불러온다. 같은 글이 배포에서는 /terms · /privacy · /ai 정적 페이지로도 나간다(legal-pages.ts).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Inline, MdBlock } from './legal/md';
import { LEGAL_DOCS, legalIdOf, legalTitle, type LegalId } from './legal/meta';
import { Icon } from './Icon';

function Text({ xs, go }: { xs: readonly Inline[]; go: (id: LegalId) => void }) {
  return <>{xs.map((x, i) => {
    if (x.t === 'b') return <strong key={i}>{x.v}</strong>;
    if (x.t === 'text') return x.v;
    const doc = legalIdOf(x.href);
    if (doc) return <a key={i} href={x.href} onClick={(e) => { e.preventDefault(); go(doc); }}>{x.v}</a>;
    return <a key={i} href={x.href} target="_blank" rel="noopener noreferrer">{x.v}</a>;
  })}</>;
}

function Body({ blocks, go }: { blocks: readonly MdBlock[]; go: (id: LegalId) => void }) {
  return <>{blocks.map((b, i): ReactNode => {
    if (b.t === 'h') { const H = `h${Math.min(b.level + 1, 4)}` as 'h2' | 'h3' | 'h4'; return <H key={i}><Text xs={b.text} go={go} /></H>; }
    if (b.t === 'p') return <p key={i}><Text xs={b.text} go={go} /></p>;
    if (b.t === 'table') {
      return (
        <div key={i} className="legal-table"><table>
          <thead><tr>{b.head.map((c, j) => <th key={j}><Text xs={c} go={go} /></th>)}</tr></thead>
          <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Text xs={c} go={go} /></td>)}</tr>)}</tbody>
        </table></div>
      );
    }
    const L = b.t;
    return <L key={i}>{b.items.map((it, j) => <li key={j}><Text xs={it.text} go={go} />{it.sub.length > 0 && <ul>{it.sub.map((s, k) => <li key={k}><Text xs={s} go={go} /></li>)}</ul>}</li>)}</L>;
  })}</>;
}

export function LegalDialog({ initial, onClose }: { initial: LegalId; onClose: () => void }) {
  const [id, setId] = useState(initial);
  const [blocks, setBlocks] = useState<MdBlock[] | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    let live = true;
    setBlocks(null);
    void import('./legal/docs').then((m) => { if (live) { setBlocks(m.legalBlocks(id)); body.current?.scrollTo(0, 0); } });
    return () => { live = false; };
  }, [id]);
  // 아래 창(설정 등)의 Esc보다 먼저 받아 이 창만 닫는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close.current(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const doc = LEGAL_DOCS.find((d) => d.id === id)!;
  // 맨 앞 # 제목은 창 머리에 쓰므로 본문에서 뺀다
  const shown = blocks && blocks[0]?.t === 'h' && blocks[0].level === 1 ? blocks.slice(1) : blocks;
  // body로 띄운다 — 아래 창의 자리 · 잘림과 상관없이 맨 위에 (React 이벤트는 여는 쪽 트리로 그대로 올라간다)
  return createPortal(
    <div className="legal-backdrop" onMouseDown={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="legal-dialog" role="dialog" aria-modal="true" aria-label={legalTitle(id)} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <nav className="legal-tabs" aria-label="문서">
            {LEGAL_DOCS.map((d) => <button key={d.id} className={d.id === id ? 'on' : ''} aria-current={d.id === id ? 'page' : undefined} onClick={() => setId(d.id)}>{d.title}</button>)}
          </nav>
          <a className="legal-open" href={doc.path} target="_blank" rel="noopener noreferrer" title="새 창에서 열기 (주소를 나눌 수 있어요)"><Icon name="external" size={14} /></a>
          <button className="x" aria-label="닫기" onClick={onClose}><Icon name="close" size={14} /></button>
        </header>
        <div className="legal-body" ref={body}>
          {shown ? <Body blocks={shown} go={setId} /> : <p className="legal-wait">불러오는 중…</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 문서 링크 묶음 — 누르면 그 자리에서 LegalDialog를 연다 */
export function LegalLinks({ ids = ['terms', 'privacy', 'ai'] }: { ids?: readonly LegalId[] }) {
  const [open, setOpen] = useState<LegalId | null>(null);
  return (
    <>
      <span className="legal-links">{ids.map((id) => <button key={id} type="button" className="link-btn" onClick={() => setOpen(id)}>{legalTitle(id)}</button>)}</span>
      {open && <LegalDialog initial={open} onClose={() => setOpen(null)} />}
    </>
  );
}
