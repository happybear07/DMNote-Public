// 목차 (FR-084): 제목 상자와 글 안의 제목(H1~H3)을 읽기 순서로 — 누르면 그 블록으로, 지금 화면 가운데에 가까운 항목을 강조.
import { useEffect, useMemo, useState } from 'react';
import { blockTextParts, documentOrder, isTextContent, nodeText, type Engine, type TextNode } from '@dn/engine-core';
import type { Workspace } from './workspace';

interface Entry { blockId: string; text: string; level: number }

/** 노트의 목차 — 제목 상자 = 0단계, 글 안의 제목 n = n단계 */
export function outlineOf(engine: Engine): Entry[] {
  const out: Entry[] = [];
  for (const { block: b } of documentOrder(engine)) {
    const contents = engine.contentsOf(b.id);
    const { title, bodies } = blockTextParts(contents);
    if (title && !bodies.length) {
      const t = nodeText(title.doc).trim();
      if (t) out.push({ blockId: b.id, text: t, level: 0 });
      continue;
    }
    for (const c of contents) {
      if (!isTextContent(c)) continue;
      for (const n of c.doc.content as TextNode[]) {
        if (n.type !== 'heading') continue;
        const t = nodeText(n).trim();
        if (t) out.push({ blockId: b.id, text: t, level: Math.min(3, Number(n.attrs?.level) || 1) });
      }
    }
  }
  return out;
}

export function Outline({ ws, version }: { ws: Workspace; version: unknown }) {
  const engine = ws.engine;
  // 목록이 바뀔 때(편집 뒤 400ms)마다 다시 — version은 노트 목록 상태
  const entries = useMemo(() => (engine ? outlineOf(engine) : []), [engine, version]);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const update = () => {
      const v = ws.view;
      if (!v || !engine) return;
      const r = v.visibleRect();
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      let best: string | null = null, bestD = Infinity;
      for (const e of entries) {
        const b = engine.getBlock(e.blockId);
        if (!b) continue;
        const d = Math.hypot(b.x + b.w / 2 - cx, b.y + Math.min(b.h, 80) / 2 - cy);
        if (d < bestD) { bestD = d; best = e.blockId; }
      }
      setActive(best);
    };
    update();
    return ws.onCamera(update);
  }, [ws, engine, entries]);

  if (!entries.length) return <p className="panel-empty">제목 상자나 제목(#)을 쓰면 여기에 목차가 생겨요.</p>;
  return (
    <nav className="outline" aria-label="목차">
      {entries.map((e, i) => (
        <button key={`${e.blockId}:${i}`} className={`outline-item lv${e.level}${e.blockId === active ? ' on' : ''}`}
          aria-current={e.blockId === active || undefined} onClick={() => ws.focusBlock(e.blockId)}>{e.text}</button>
      ))}
    </nav>
  );
}
