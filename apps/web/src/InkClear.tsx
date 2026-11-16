// 지우개 막대 '지우기' (알파 10/31): 필기 모두 지우기 · 모두 지우기(상자 · 화살표 · 필기). 옆의 '숨기기'(보이기 전환)와 이름으로 나눈다.
// 누르면 무엇을 몇 개 지우는지 묻고(Enter = 지우기, Esc = 취소), 지운 뒤에는 실행 취소 알림 — 한 번에 되돌린다.
import { useEffect, useRef, useState } from 'react';
import { clearCanvas, clearTargets } from '@dn/engine-core';
import type { CanvasView } from '@dn/engine-dom';
import { svg } from './ToolChoice';

type Kind = 'ink' | 'all';
const X = <path d="M12.5 12.5l4 4M16.5 12.5l-4 4" />;
const DEL_INK = <><path d="M2.5 9c1.2-3 2.4-4.2 3.6-3s.8 3.4 2 3.4 1.7-3.8 3-3.8 1.2 2.4 2.9 2" />{X}</>;
const DEL_ALL = <><rect x="2.5" y="3.5" width="11" height="8" rx="1.5" /><path d="M5 8.5c.8-1.6 1.6-2.2 2.4-1.5s.6 1.8 1.4 1.8 1.1-2 2-2" />{X}</>;
const LABEL: Record<Kind, string> = { ink: '필기 모두 지우기', all: '모두 지우기' };

export function InkClear({ view, onDone }: { view: CanvasView; onDone?: (text: string) => void }) {
  const [ask, setAsk] = useState<{ kind: Kind; blocks: number; strokes: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!ask) return;
    yes.current?.focus();
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setAsk(null); };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [ask]);
  // 몇 개인지는 누를 때만 센다 (막대는 그릴 때마다 다시 그려진다)
  const open = (kind: Kind) => {
    if (ask?.kind === kind) { setAsk(null); return; }
    const t = clearTargets(view.engine, kind);
    setAsk({ kind, blocks: kind === 'all' ? t.blocks.length : 0, strokes: t.strokes.length });
  };
  const close = () => { setAsk(null); view.root.focus(); };
  const run = () => {
    if (!ask) return;
    const r = clearCanvas(view.engine, ask.kind);
    view.ink.selected.clear();
    close();
    view.schedule();
    view.notifyUi();
    if (r.ok) onDone?.(ask.kind === 'all' ? '캔버스를 모두 지웠어요.' : '필기를 모두 지웠어요.');
  };
  const what = ask ? [ask.blocks ? `상자 ${ask.blocks}개` : '', ask.strokes ? `필기 ${ask.strokes}획` : ''].filter(Boolean).join(' · ') : '';
  return (
    <span ref={ref} className="ink-group ink-labeled ink-clear">
      <span className="ink-cap">지우기</span>
      <span className="ink-row">
        {(['ink', 'all'] as const).map((k) => (
          <button key={k} className={`ink-icon danger${ask?.kind === k ? ' on' : ''}`} aria-label={LABEL[k]} aria-haspopup="dialog" aria-expanded={ask?.kind === k}
            title={k === 'ink' ? '필기 모두 지우기 — 상자는 그대로 (실행 취소로 되돌려요)' : '모두 지우기 — 상자 · 화살표 · 필기 전부 (실행 취소로 되돌려요)'} onClick={() => open(k)}>
            {svg(k === 'ink' ? DEL_INK : DEL_ALL)}
          </button>
        ))}
      </span>
      {ask && (
        <span className="ink-confirm" role="alertdialog" aria-label={LABEL[ask.kind]}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
          {what ? <>
            <span>{what} — 모두 지울까요?</span>
            <button ref={yes} className="danger" onClick={run}>지우기</button>
            <button onClick={close}>취소</button>
          </> : <>
            <span>지울 {ask.kind === 'all' ? '것이' : '필기가'} 없어요.</span>
            <button ref={yes} onClick={close}>닫기</button>
          </>}
        </span>
      )}
    </span>
  );
}
