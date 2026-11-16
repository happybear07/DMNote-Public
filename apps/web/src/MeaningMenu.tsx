// 의미 고르기 (노트 v6): 블록 메뉴의 "노드 종류" · 화살표 오른쪽 클릭 메뉴의 "관계 종류". 모양(색 · 선)과 따로 저장되고,
// 고른 값은 이 노트에만 남는다(학습에 쓰지 않는다 — 처리방침 · AI 안내). AI가 만든 것을 고치면 출처에 "사람이 고침"이 남는다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  endBlock, GROUP_KIND_LABEL, GROUP_KINDS, groupName, groupOf, NODE_KIND_LABEL, NODE_KINDS_TIER1, NODE_KINDS_TIER2, NODE_KINDS_V1, RELATION_LABEL, RELATIONS_TIER1, RELATIONS_TIER2, RELATIONS_V1,
  setArrowGroupEnd, setArrowMarks, setArrowRelation, setBlockMeta, setGroupMeta, setNodeKind, type BlockMeta, type ArrowMarks, type KnownNodeKind, type KnownRelation,
} from '@dn/engine-core';
import type { ArrowMenuRequest, CanvasView } from '@dn/engine-dom';
import { ArrowStyleRows } from './ArrowStyleMenu';
import { SubMenu } from './SubMenu';
import { CardRows } from './CardMenu';

/** 모두 같은 값이면 그 값, 섞였으면 '*', 없으면 '' */
function common(values: readonly (string | undefined)[]): string {
  const set = new Set(values.map((v) => v ?? ''));
  return set.size === 1 ? [...set][0]! : '*';
}

function Options<K extends string>({ groups, label }: { groups: readonly [string, readonly K[]][]; label: Readonly<Record<K, string>> }) {
  return <>{groups.map(([name, list]) => (
    <optgroup key={name} label={name}>{list.map((k) => <option key={k} value={k}>{label[k]}</option>)}</optgroup>
  ))}</>;
}

const KIND_GROUPS: readonly [string, readonly KnownNodeKind[]][] = [['기본', NODE_KINDS_V1], ['논증 · 수학 · 회의', NODE_KINDS_TIER1], ['그 밖', NODE_KINDS_TIER2]];
const REL_GROUPS: readonly [string, readonly KnownRelation[]][] = [['기본', RELATIONS_V1], ['논리 · 과정', RELATIONS_TIER1], ['그 밖', RELATIONS_TIER2]];

/** 블록 메뉴 안: 노드 종류 고르기 */
export function NodeKindRow({ view, ids }: { view: CanvasView; ids: string[] }) {
  const [, bump] = useState(0);
  const now = common(ids.map((id) => view.engine.getBlock(id)?.nodeKind));
  return (
    <>
      <div className="menu-head">노드 종류</div>
      <select className="mean-select" aria-label="노드 종류" value={now} title="이 상자가 글에서 하는 역할"
        onChange={(e) => { setNodeKind(view.engine, ids, e.target.value || undefined); bump((n) => n + 1); }}>
        {now === '*' && <option value="*" disabled>(여러 종류)</option>}
        <option value="">(없음)</option>
        <Options groups={KIND_GROUPS} label={NODE_KIND_LABEL} />
      </select>
      <MetaRows view={view} ids={ids} />
    </>
  );
}

const STATUS: [string, string][] = [['', '없음'], ['belief', '통념'], ['refuted', '반증됨'], ['before', '이전(As-Is)'], ['wrong', '틀림'], ['deferred', '보류']];

/** 상태 · 역할 · 발화자 (가이드 4.5 · 4.12) — 접어 두고 펼쳐서 고친다. 글자는 원문 그대로 */
function MetaRows({ view, ids }: { view: CanvasView; ids: string[] }) {
  const [open, setOpen] = useState(false);
  const [, bump] = useState(0);
  const b = view.engine.getBlock(ids[0]!);
  if (!b) return null;
  const set = (p: BlockMeta) => { setBlockMeta(view.engine, ids, p); bump((n) => n + 1); };
  const text = (key: 'role' | 'speaker', label: string, max: number) => (
    <label className="meta-text">{label}
      <input key={`${key}:${b[key] ?? ''}`} defaultValue={b[key] ?? ''} maxLength={max} aria-label={label}
        onBlur={(e) => set({ [key]: e.target.value })} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
  return (
    <>
      <button role="menuitem" aria-expanded={open} onClick={() => setOpen((o) => !o)}><span>상태 · 역할 {open ? '▾' : '▸'}</span></button>
      {open && <>
        <select className="mean-select" aria-label="상태" value={b.status ?? ''} title="흐림 — 버려진 · 이전의 · 틀린 · 미정인 진술" onChange={(e) => set({ status: (e.target.value || undefined) as BlockMeta['status'] })}>
          {STATUS.map(([v, name]) => <option key={v} value={v}>{v ? `흐림 · ${name}` : '상태 없음'}</option>)}
        </select>
        <div className="align-row" role="group" aria-label="강조">
          {([['', '보통'], ['strong', '강조'], ['warning', '⚠ 경고']] as const).map(([v, name]) => (
            <button key={v} role="menuitemradio" aria-checked={(b.emphasis ?? '') === v} className={(b.emphasis ?? '') === v ? 'on' : ''} onClick={() => set({ emphasis: (v || undefined) as BlockMeta['emphasis'] })}>{name}</button>
          ))}
          <button role="menuitemcheckbox" aria-checked={!!b.hedge} className={b.hedge ? 'on' : ''} title="원문이 아마 · 대체로처럼 불확실하게 말함" onClick={() => set({ hedge: !b.hedge })}>불확실</button>
        </div>
        {text('role', '역할', 24)}
        {text('speaker', '발화자', 40)}
      </>}
    </>
  );
}

/** 화살표 오른쪽 클릭 메뉴: 관계 종류 · 라벨 고치기 · 지우기 */
export function ArrowMenu({ req, view, onClose }: { req: ArrowMenuRequest; view: CanvasView; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: req.x, y: req.y });
  const [, bump] = useState(0);
  const [sub, setSub] = useState<string | null>(null);
  const now = common(req.ids.map((id) => view.engine.getArrow(id)?.relation));
  // 화면 안으로 — 모양 칸을 펼쳐 메뉴가 길어져도 다시 맞춘다 (너무 길면 메뉴 안에서 스크롤)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => { const r = el.getBoundingClientRect(); setPos({ x: Math.max(8, Math.min(req.x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(req.y, innerHeight - r.height - 8)) }); };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [req]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); view.root.focus(); } };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [onClose, view]);
  const act = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <div ref={ref} className="menu" role="menu" aria-label="화살표 메뉴" style={{ left: pos.x, top: pos.y }}
      onMouseOver={(e) => { if (sub && !(e.target as Element).closest('.menu-sub')) setSub(null); }}>
      {req.ids.length > 1 && <div className="menu-head">화살표 {req.ids.length}개</div>}
      {/* 자주 쓰는 것 위 · 지우기는 맨 아래 (DS-016) — 관계 종류 · 기호 · 번호 · 묶음 끝은 '관계 ▸', 선 · 끝 · 색은 '모양 ▸' */}
      {req.ids.length === 1 && <button role="menuitem" onClick={act(() => view.editArrowLabel(req.ids[0]!))}><span>라벨 고치기</span><kbd>두 번 클릭</kbd></button>}
      <SubMenu id="style" label="모양" open={sub} setOpen={setSub}><ArrowStyleRows view={view} ids={req.ids} inline /></SubMenu>
      <SubMenu id="rel" label="관계" hint={now && now !== '*' ? RELATION_LABEL[now as keyof typeof RELATION_LABEL] : undefined} open={sub} setOpen={setSub}>
        <div className="menu-head">관계 종류</div>
        <select className="mean-select" aria-label="관계 종류" value={now} title="두 상자가 어떤 관계인지 — 화살표 모양이 따라 바뀌어요"
          onChange={(e) => { setArrowRelation(view.engine, req.ids, e.target.value || undefined); bump((n) => n + 1); }}>
          {now === '*' && <option value="*" disabled>(여러 관계)</option>}
          <option value="">(정하지 않음)</option>
          <Options groups={REL_GROUPS} label={RELATION_LABEL} />
        </select>
        <MarksRows view={view} ids={req.ids} onChange={() => bump((n) => n + 1)} />
        {req.ids.length === 1 && <GroupEnds view={view} id={req.ids[0]!} onChange={() => bump((n) => n + 1)} />}
      </SubMenu>
      <div className="menu-sep" />
      <button role="menuitem" className="danger-item" onClick={act(() => view.deleteSelection())}><span>지우기</span><kbd>Del</kbd></button>
    </div>
  );
}

/** 끝이 묶음에 든 상자면: 그 끝을 묶음 전체(둘레)에 붙이기 · 떼기 — "이 전제들 전체가 결론을 뒷받침" 같은 관계 (v6) */
function GroupEnds({ view, id, onChange }: { view: CanvasView; id: string; onChange: () => void }) {
  const a = view.engine.getArrow(id);
  if (!a) return null;
  const rows = (['from', 'to'] as const).map((end) => { const id = endBlock(a[end]); return { end, g: id ? groupOf(view.engine, id) : null }; }).filter((x) => !!x.g);
  if (!rows.length) return null;
  return (
    <>
      <div className="menu-sep" />
      {rows.map(({ end, g }) => {
        const on = a[end].groupId === g!.id;
        return (
          <button key={end} role="menuitemcheckbox" aria-checked={on} className={on ? 'on' : ''}
            onClick={() => { setArrowGroupEnd(view.engine, id, end, !on); onChange(); }}>
            <span>{on ? '✓ ' : ''}{end === 'from' ? '출발' : '도착'}을 묶음 전체에 · {groupName(view.engine, g!.id, g!.ids)}</span>
          </button>
        );
      })}
    </>
  );
}

const SYMBOLS: [string, string][] = [['∴', '그러므로'], ['∵', '왜냐하면'], ['↺', '되돌림 · 반복'], ['↩', '돌아감']];

/** 기호 (v6 3단계): 기호 칩 · 성립하지 않음 ⇏ · 극성 + − · 번호 · 응답 — 라벨(원문 구절)과 따로 저장되고 칩에 함께 보인다 */
function MarksRows({ view, ids, onChange }: { view: CanvasView; ids: string[]; onChange: () => void }) {
  const a = view.engine.getArrow(ids[0]!);
  if (!a) return null;
  const set = (p: ArrowMarks) => { setArrowMarks(view.engine, ids, p); onChange(); };
  return (
    <>
      <div className="menu-head">기호</div>
      <div className="align-row arrow-style-row" role="group" aria-label="기호">
        {SYMBOLS.map(([s, name]) => (
          <button key={s} role="menuitemradio" aria-checked={a.symbol === s} className={a.symbol === s ? 'on' : ''} title={name} aria-label={`기호 ${name}`}
            onClick={() => set({ symbol: a.symbol === s ? undefined : s })}>{s}</button>
        ))}
        <button role="menuitemcheckbox" aria-checked={!!a.negated} className={a.negated ? 'on' : ''} title="성립하지 않음 (⇏)" aria-label="성립하지 않음"
          onClick={() => set({ negated: a.negated ? undefined : true })}>⇏</button>
        {(['+', '-'] as const).map((g) => (
          <button key={g} role="menuitemradio" aria-checked={a.sign === g} className={a.sign === g ? 'on' : ''} title={g === '+' ? '같은 방향 (+)' : '반대 방향 (−)'} aria-label={g === '+' ? '극성 더하기' : '극성 빼기'}
            onClick={() => set({ sign: a.sign === g ? undefined : g })}>{g === '+' ? '+' : '−'}</button>
        ))}
      </div>
      <div className="align-row" role="group" aria-label="번호 · 응답">
        <label className="mark-order">번호 <input type="number" min={1} max={99} value={a.order ?? ''} aria-label="화살표 번호"
          onChange={(e) => set({ order: e.target.value ? Math.max(1, Math.min(99, Math.round(Number(e.target.value)))) : undefined })} /></label>
        <button role="menuitemcheckbox" aria-checked={!!a.reply} className={a.reply ? 'on' : ''} title="응답 메시지 (파선)" onClick={() => set({ reply: a.reply ? undefined : true })}>응답</button>
      </div>
    </>
  );
}

/** 블록 메뉴 › 묶음 ▸ (묶음 전체를 골랐을 때): 묶음 종류(전제 묶음 · 경우 · 증명 …) · 테두리 모양(상자 · 중괄호 · 없음) — v6 3단계 */
export function GroupMetaRows({ view, gid, onDone = () => {}, onChange }: { view: CanvasView; gid: string; onDone?: () => void; /** 값이 바뀌면 (메뉴 줄의 지금 값 표시) */ onChange?: () => void }) {
  const [, bump] = useState(0);
  const meta = view.engine.note.groups?.[gid];
  const set = (p: Parameters<typeof setGroupMeta>[2]) => { setGroupMeta(view.engine, gid, p); bump((n) => n + 1); onChange?.(); };
  const bracket = meta?.bracket ?? 'box';
  return (
    <>
      <div className="menu-head">묶음 종류</div>
      <select className="mean-select" aria-label="묶음 종류" value={meta?.kind ?? ''} onChange={(e) => set({ kind: e.target.value || undefined })}>
        <option value="">(없음)</option>
        {GROUP_KINDS.map((k) => <option key={k} value={k}>{GROUP_KIND_LABEL[k]}</option>)}
      </select>
      <div className="align-row" role="group" aria-label="묶음 테두리">
        {([['box', '상자'], ['brace', '중괄호 }'], ['none', '없음'], ['card', '카드']] as const).map(([b, name]) => (
          <button key={b} role="menuitemradio" aria-checked={bracket === b} className={bracket === b ? 'on' : ''} aria-label={`테두리 ${name}`}
            onClick={() => set({ bracket: b === 'box' ? undefined : b })}>{name}</button>
        ))}
      </div>
      {bracket === 'card' && <CardRows key={gid} view={view} gid={gid} onDone={onDone} />}
      <div className="menu-head">문서에서</div>
      <div className="align-row" role="group" aria-label="문서에서 보이는 모양">
        {([[false, '글로'], [true, '도식 그림으로']] as const).map(([fig, name]) => (
          <button key={name} role="menuitemradio" aria-checked={!!meta?.figure === fig} className={!!meta?.figure === fig ? 'on' : ''} title={fig ? '문서 뷰 · 인쇄 · PDF · 워드에서 상자와 화살표를 캔버스 모양 그대로 그림 한 장으로' : '문서에서 상자마다 글로 (기본)'}
            onClick={() => set({ figure: fig || undefined })}>{name}</button>
        ))}
      </div>
    </>
  );
}
