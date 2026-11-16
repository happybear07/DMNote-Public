// 노트형 정리 메뉴 줄 (docs/research/NOTE-SHEET-PLAN.md NS-01 · 02 · 03 · 04):
// 카드 — 묶음 메뉴에서 테두리를 '카드'로 고르면 이름 · 바탕색 · 번호 · 격자로 맞추기. 구분선 — 블록 메뉴에서 방향 · 선 모양 · 라벨.
// 카드가 겹치면(글이 늘어) 캔버스 위에 '카드 다시 맞추기' 단추 — 누를 때만 겹친 카드를 아래로(ADR-0014: 다른 블록을 저절로 옮기지 않는다).
import { useEffect, useState } from 'react';
import {
  arrangeCards, noteCards, overlappingCards, renameGroup, restackCards, setDivider, setGroupMeta, type DividerContent, type DividerLine,
} from '@dn/engine-core';
import { BLOCK_COLORS, type CanvasView } from '@dn/engine-dom';
import { COLOR_LABEL } from './TextStyleMenu';

const TONES = ['blue', 'yellow', 'green', 'pink', 'gray'] as const;

export function CardRows({ view, gid, onDone }: { view: CanvasView; gid: string; onDone: () => void }) {
  const [, bump] = useState(0);
  const meta = view.engine.note.groups?.[gid];
  const [name, setName] = useState(meta?.name ?? '');
  const set = (p: Parameters<typeof setGroupMeta>[2]) => { setGroupMeta(view.engine, gid, p); bump((n) => n + 1); };
  const saveName = () => { if (name.trim() !== (meta?.name ?? '')) renameGroup(view.engine, gid, name); };
  const cards = noteCards(view.engine);
  return (
    <>
      <div className="menu-head">카드</div>
      <input className="mean-select card-name" aria-label="카드 이름" placeholder="카드 이름" value={name} maxLength={60}
        onChange={(e) => setName(e.target.value)} onBlur={saveName}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveName(); onDone(); } e.stopPropagation(); }} />
      <div className="swatches" role="group" aria-label="카드 바탕색">
        <button role="menuitemradio" aria-checked={!meta?.tone} className="sw none" title="기본" aria-label="기본 바탕" onClick={() => set({ tone: undefined })} />
        {TONES.map((k) => (
          <button key={k} role="menuitemradio" aria-checked={meta?.tone === k} className={`sw${meta?.tone === k ? ' on' : ''}`} title={COLOR_LABEL[k]} aria-label={`${COLOR_LABEL[k]} 바탕`}
            style={{ background: BLOCK_COLORS[k] }} onClick={() => set({ tone: k })} />
        ))}
      </div>
      <button role="menuitemcheckbox" aria-checked={!!meta?.numbered} onClick={() => set({ numbered: meta?.numbered ? undefined : true })}>
        <span>머리에 번호</span><kbd>{meta?.numbered ? '켬' : '끔'}</kbd>
      </button>
      {cards.length > 1 && <button role="menuitem" title="이 노트의 카드를 읽는 순서대로 같은 간격 격자에 (A4면 용지 폭 안)" onClick={() => { arrangeCards(view.engine, cards.map((c) => c.id)); onDone(); }}>
        <span>카드 격자로 맞추기</span><kbd>{cards.length}장</kbd>
      </button>}
    </>
  );
}

const LINES: [DividerLine, string][] = [['solid', '실선'], ['dashed', '점선'], ['dotted', '점'], ['double', '이중']];

export function DividerRows({ view, c }: { view: CanvasView; c: DividerContent }) {
  const [, bump] = useState(0);
  const [label, setLabel] = useState(c.label ?? '');
  const set = (p: Parameters<typeof setDivider>[2]) => { setDivider(view.engine, c.id, p); bump((n) => n + 1); };
  const cur = (view.engine.getContent(c.id) as DividerContent | undefined) ?? c;
  return (
    <>
      <div className="menu-head">구분선</div>
      <div className="align-row" role="group" aria-label="구분선 방향">
        {([['h', '가로'], ['v', '세로']] as const).map(([o, n]) => (
          <button key={o} role="menuitemradio" aria-checked={cur.orient === o} className={cur.orient === o ? 'on' : ''} onClick={() => set({ orient: o })}>{n}</button>
        ))}
      </div>
      <div className="align-row" role="group" aria-label="선 모양">
        {LINES.map(([l, n]) => (
          <button key={l} role="menuitemradio" aria-checked={(cur.line ?? 'solid') === l} className={(cur.line ?? 'solid') === l ? 'on' : ''} onClick={() => set({ line: l })}>{n}</button>
        ))}
      </div>
      <input className="mean-select" aria-label="구분선 가운데 글" placeholder="가운데 글 (예: VS)" value={label} maxLength={40}
        onChange={(e) => setLabel(e.target.value)} onBlur={() => set({ label })}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); set({ label }); } e.stopPropagation(); }} />
    </>
  );
}

/** 카드가 겹치면 보이는 단추 — 누르면 겹친 카드만 아래로 (실행 취소 한 번) */
export function CardFixPill({ view }: { view: CanvasView }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let t = 0;
    const check = () => { clearTimeout(t); t = window.setTimeout(() => setN(overlappingCards(view.engine).length), 300); };
    check();
    const off = view.engine.subscribe(check);
    return () => { off(); clearTimeout(t); };
  }, [view]);
  if (!n || view.readOnly) return null;
  return (
    <button className="card-fix-pill" title="글이 늘어 겹친 카드를 아래로 — 다른 카드는 그대로" onClick={() => restackCards(view.engine)}>
      카드가 겹쳐요 · 다시 맞추기
    </button>
  );
}
