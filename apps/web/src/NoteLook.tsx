// 노트 아이콘 · 커버 (FR-070): 아이콘 표시(사이드바 · 검색 · 홈 · 위 막대), 아이콘 고르기(이모지 · 선 아이콘 · 직접 입력), 커버 띠(바꾸기 · 위치 · 없애기).
// 아이콘 값: 이모지 글자 그대로, 또는 'icon:<선 아이콘 이름>'. 이모지는 사용자가 고른 내용이라 색 이모지를 그대로 보여 준다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NoteCover } from '@dn/engine-core';
import { isIconName, type IconName } from '@dn/text-pm';
import { Icon } from './Icon';
import type { Workspace } from './workspace';

export function NoteGlyph({ icon, size = 16, fallback = 'note' }: { icon?: string; size?: number; fallback?: IconName }) {
  const name = icon?.startsWith('icon:') ? icon.slice(5) : null;
  if (name && isIconName(name)) return <Icon name={name} size={size} className="note-glyph" />;
  if (icon) return <span className="note-emoji" style={{ fontSize: Math.round(size * 0.92), width: size, height: size }} aria-hidden>{icon}</span>;
  return <Icon name={fallback} size={size} />;
}

const EMOJI: { label: string; list: string }[] = [
  { label: '자주 쓰는', list: '📝📌⭐💡✅📚🎯🔥🚀📊📈🗂️📅⏰🔖💼' },
  { label: '공부 · 일', list: '📖✏️🖊️📐🧮🔬🧪💻🖥️📱⌨️🗃️📋📎🧾📰' },
  { label: '생활', list: '🏠🍳☕🍎🛒💰💳🏃🧘🎵🎮🎨📷✈️🚗🎁' },
  { label: '자연', list: '🌱🌳🌸🌻🍀🌙☀️⛅🌈❄️🌊⚡🐶🐱🐻🦊' },
  { label: '표정', list: '😀😊🙂😎🤔😴😢😡🥳😍🤩😅🙏👍👏💪' },
  { label: '기호', list: '❤️🧡💛💚💙💜🖤⚠️❗❓✔️❌⭕🔴🟢🔵' },
];
const LINE: IconName[] = ['note', 'folder', 'star', 'bookmark', 'flag', 'pin', 'heart', 'target', 'bulb', 'check', 'info', 'alert', 'question', 'pencil', 'home', 'sparkle', 'table', 'chart', 'database', 'code', 'mic', 'image', 'list', 'checkSquare'];

const graphemes = (s: string): string[] => [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment);

/** 아이콘 고르기: 위 막대의 아이콘을 누르면 아래로 펼친다 */
export function IconPicker({ ws, icon, hasCover, at, onClose }: { ws: Workspace; icon?: string; hasCover: boolean; at: { x: number; y: number }; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'emoji' | 'line'>(icon?.startsWith('icon:') ? 'line' : 'emoji');
  const [custom, setCustom] = useState('');
  const [pos, setPos] = useState(at);
  const groups = useMemo(() => EMOJI.map((g) => ({ label: g.label, list: graphemes(g.list) })), []);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.max(8, Math.min(at.x, innerWidth - r.width - 8)), y: at.y });
  }, [at]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [onClose]);
  const pick = (v: string | null) => { ws.setNoteIcon(v); onClose(); };
  return (
    <div ref={ref} className="menu icon-picker" role="dialog" aria-label="노트 아이콘" style={{ left: pos.x, top: pos.y }}>
      <div className="ip-head">
        <div className="seg" role="tablist" aria-label="아이콘 종류">
          <button role="tab" aria-selected={tab === 'emoji'} className={tab === 'emoji' ? 'on' : ''} onClick={() => setTab('emoji')}>이모지</button>
          <button role="tab" aria-selected={tab === 'line'} className={tab === 'line' ? 'on' : ''} onClick={() => setTab('line')}>아이콘</button>
        </div>
        {icon && <button className="btn sm" onClick={() => pick(null)}>없애기</button>}
      </div>
      <div className="ip-body">
        {tab === 'emoji' ? groups.map((g) => (
          <div key={g.label}>
            <div className="menu-head">{g.label}</div>
            <div className="ip-grid">
              {g.list.map((e) => <button key={e} className={`ip-cell${icon === e ? ' on' : ''}`} aria-label={`아이콘 ${e}`} onClick={() => pick(e)}><span className="note-emoji">{e}</span></button>)}
            </div>
          </div>
        )) : (
          <div className="ip-grid">
            {LINE.map((n) => <button key={n} className={`ip-cell${icon === `icon:${n}` ? ' on' : ''}`} aria-label={`아이콘 ${n}`} onClick={() => pick(`icon:${n}`)}><Icon name={n} size={20} /></button>)}
          </div>
        )}
      </div>
      <form className="ip-custom" onSubmit={(e) => { e.preventDefault(); const g = graphemes(custom.trim()).slice(0, 2).join(''); if (g) pick(g); }}>
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="다른 이모지 붙여넣기" aria-label="이모지 직접 입력" />
        <button className="btn sm" type="submit" disabled={!custom.trim()}>쓰기</button>
      </form>
      <button className="btn sm ip-cover" onClick={() => { onClose(); void ws.pickNoteCover(); }}>
        <Icon name="image" size={14} />{hasCover ? '커버 바꾸기' : '커버 이미지 추가'}
      </button>
    </div>
  );
}

/** 커버 띠: 위치 조정은 끌어서(놓으면 저장 · 실행 취소 한 번) */
export function CoverBanner({ ws, cover, readOnly }: { ws: Workspace; cover: NoteCover; readOnly: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [pos, setPos] = useState(cover.pos);
  const drag = useRef<{ y: number; pos: number } | null>(null);
  useEffect(() => { let live = true; void ws.fileUrl(cover.attachment).then((u) => { if (live) setUrl(u); }); return () => { live = false; }; }, [ws, cover.attachment]);
  useEffect(() => setPos(cover.pos), [cover.pos]);
  const onDown = (e: React.PointerEvent) => {
    if (!adjust) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, pos };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) setPos(Math.max(0, Math.min(100, d.pos - (e.clientY - d.y) * 0.4)));
  };
  const onUp = () => { if (drag.current) { drag.current = null; ws.setNoteCoverPos(pos); } };
  return (
    <div className={`cover${adjust ? ' adjusting' : ''}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {url ? <img src={url} alt="" draggable={false} style={{ objectPosition: `center ${pos}%` }} /> : <div className="cover-missing">커버 이미지를 찾을 수 없어요</div>}
      {!readOnly && (
        <div className="cover-actions">
          {adjust
            ? <><span className="cover-hint">위아래로 끌어 위치를 맞춰요</span><button className="btn sm" onClick={() => setAdjust(false)}>완료</button></>
            : <>
              <button className="btn sm" onClick={() => void ws.pickNoteCover()}>커버 바꾸기</button>
              <button className="btn sm" onClick={() => setAdjust(true)}>위치 조정</button>
              <button className="btn sm" onClick={() => ws.setNoteCover(null)}>없애기</button>
            </>}
        </div>
      )}
    </div>
  );
}
