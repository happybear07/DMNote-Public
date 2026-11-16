// 캔버스 설정 (알파 10/31, 위 막대 ⋯ › 캔버스 설정): 바탕색(테마 따라 · 흰색 · 옥스퍼드 · 어둡게) · 무늬(점 · 괘선 · 모눈 · 무지) · 간격.
// 노트마다 저장(note.paper — 실행 취소 가능). 바탕색은 캔버스 안만 바꾼다 — 앱 화면 밝기는 설정 › 편집 › 테마 그대로.
// 고르는 부분(PaperControls)은 노트 설정(빈 곳 오른쪽 클릭, NoteMenu.tsx)도 같이 쓴다.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_PAPER, PAPER_GAPS, setNotePaper, type Engine, type Paper, type PaperColor, type PaperKind } from '@dn/engine-core';
import { svg } from './ToolChoice';

const COLORS: { v: PaperColor | null; label: string; cls: string }[] = [
  { v: null, label: '테마 따라', cls: 'c-theme' }, { v: 'white', label: '흰색', cls: 'c-white' },
  { v: 'oxford', label: '옥스퍼드', cls: 'c-oxford' }, { v: 'dark', label: '어둡게', cls: 'c-dark' },
];
const KINDS: { v: PaperKind; label: string; icon: ReactNode }[] = [
  { v: 'dots', label: '점', icon: <><circle cx="6" cy="6" r=".9" /><circle cx="14" cy="6" r=".9" /><circle cx="6" cy="14" r=".9" /><circle cx="14" cy="14" r=".9" /></> },
  { v: 'lines', label: '괘선', icon: <path d="M3 6h14M3 10h14M3 14h14" /> },
  { v: 'grid', label: '모눈', icon: <path d="M3 3.5h14v13H3zM3 10h14M10 3.5v13M3 6.8h14M3 13.2h14M6.5 3.5v13M13.5 3.5v13" /> },
  { v: 'none', label: '무지', icon: <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" /> },
];

/** 바탕색 · 무늬 · 간격 — 캔버스 설정 창과 노트 설정(오른쪽 클릭)이 같이 쓴다 */
export function PaperControls({ engine }: { engine: Engine }) {
  const [paper, setPaper] = useState<Paper>(engine.note.paper ?? DEFAULT_PAPER);
  // 실행 취소 등 엔진 쪽 변경도 반영
  useEffect(() => { setPaper(engine.note.paper ?? DEFAULT_PAPER); return engine.subscribe(() => setPaper(engine.note.paper ?? DEFAULT_PAPER)); }, [engine]);
  const set = (p: Omit<Partial<Paper>, 'color'> & { color?: PaperColor | null }) => {
    const { color, ...rest } = { ...paper, ...p };
    setNotePaper(engine, { ...rest, ...(color ? { color } : {}) });
  };
  return (
    <>
      <div className="cs-title" id="cs-color">바탕색</div>
      <div className="cs-choices" role="radiogroup" aria-labelledby="cs-color">
        {COLORS.map((c) => {
          const on = (paper.color ?? null) === c.v;
          return (
            <button key={c.label} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => set({ color: c.v })}>
              <span className={`cs-chip ${c.cls}`} aria-hidden="true" />{c.label}
            </button>
          );
        })}
      </div>
      <div className="cs-title" id="cs-kind">무늬</div>
      <div className="cs-choices" role="radiogroup" aria-labelledby="cs-kind">
        {KINDS.map((k) => (
          <button key={k.v} type="button" role="radio" aria-checked={paper.kind === k.v} className={paper.kind === k.v ? 'on' : ''} onClick={() => set({ kind: k.v })}>
            {svg(k.icon)}{k.label}
          </button>
        ))}
      </div>
      <div className="cs-title" id="cs-gap">간격</div>
      <div className="cs-gaps" role="radiogroup" aria-labelledby="cs-gap">
        {PAPER_GAPS.map((g) => (
          <button key={g} type="button" role="radio" aria-checked={paper.gap === g} className={paper.gap === g ? 'on' : ''} disabled={paper.kind === 'none'} onClick={() => set({ gap: g })}>{g}px</button>
        ))}
      </div>
    </>
  );
}

export function CanvasSettings({ engine, onClose }: { engine: Engine; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!box.current?.parentElement?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    box.current?.querySelector<HTMLElement>('button.on')?.focus();
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [onClose]);
  return (
    <div ref={box} className="canvas-settings" role="dialog" aria-label="캔버스 설정">
      <h3>캔버스 설정</h3>
      <PaperControls engine={engine} />
      <p className="cs-note">이 노트의 캔버스에만 적용돼요. 앱 전체 밝기는 설정 › 편집 › 테마에서 바꿔요.</p>
    </div>
  );
}
