// 캡션 그리기 · 고치기 (engine-core caption.ts): 표는 위에, 그림은 아래에 '그림 N. 글'. 누르면 그 자리에서 고치는 입력 칸
// (Enter 저장 · Esc 그만 · 비우면 지움). 캔버스 블록과 문서 뷰 항목이 같이 쓴다.
import { captionKind, captionNumbers, isImageContent, setBlockCaption, setImageAlt, type CaptionNumber, type Engine, type Id } from '@dn/engine-core';
import { refreshXrefs, setXrefResolver, type XrefHost } from '@dn/text-pm';

/** 블록 요소 el에 캡션을 맞춘다 (없으면 뗀다) */
export function syncCaption(el: HTMLElement, engine: Engine, blockId: Id, num: CaptionNumber | undefined, readOnly: boolean): void {
  const b = engine.getBlock(blockId);
  let cap = el.querySelector<HTMLElement>(':scope > .dn-caption');
  if (!b?.caption || !num) { cap?.remove(); return; }
  if (!cap) {
    const c = document.createElement('div');
    c.className = 'dn-caption dn-ui';
    c.addEventListener('pointerdown', (e) => e.stopPropagation());
    c.addEventListener('click', (e) => { e.stopPropagation(); if (!readOnly) editCaption(engine, blockId, c.getBoundingClientRect()); });
    cap = c;
  }
  const text = `${num.label}. ${b.caption}`;
  if (cap.textContent !== text) cap.textContent = text;
  cap.dataset.kind = num.kind;
  cap.title = readOnly ? '' : '눌러서 캡션 고치기';
  if (num.kind === '표') { if (el.firstElementChild !== cap) el.prepend(cap); } else if (el.lastElementChild !== cap) el.append(cap);
}

/** 캔버스: 마운트된 블록 전체의 캡션 맞추기 (번호는 문서 차례라 하나가 바뀌면 다른 번호도 바뀐다) */
export function syncCaptions(engine: Engine, mounted: ReadonlyMap<Id, { el: HTMLElement }>, readOnly: boolean): void {
  let any = false;
  for (const b of engine.blocks()) if (b.caption) { any = true; break; }
  const nums = any ? captionNumbers(engine) : new Map<Id, CaptionNumber>();
  useCaptionNumbers(nums);
  for (const [id, m] of mounted) { syncCaption(m.el, engine, id, nums.get(id), readOnly); refreshXrefs(m.el); }
}

/** 지금 캡션 번호를 상호 참조 글자에 (새로 그리는 글은 바로, 그려 둔 글은 refreshXrefs로) */
export function useCaptionNumbers(nums: ReadonlyMap<Id, CaptionNumber>): void {
  setXrefResolver((id) => nums.get(id)?.label ?? null);
}

/** 상호 참조 고르기 목록 (캡션 단 그림 · 표, 문서 차례) · 누르면 open */
export function xrefHost(engine: Engine, open: (id: Id) => void): XrefHost {
  return { targets: () => [...captionNumbers(engine)].map(([id, n]) => ({ id, label: n.label, caption: engine.getBlock(id)?.caption ?? '' })), open };
}

type Spot = { left: number; top: number; width: number };

/** 캡션 고치기 입력 칸 — 화면 자리 r에 (캡션을 눌렀으면 그 자리, 메뉴에서면 블록 아래) */
export function editCaption(engine: Engine, blockId: Id, r: Spot): void {
  const b = engine.getBlock(blockId);
  if (!b) return;
  lineInput(r, '캡션', b.caption ?? '', `${captionKind(engine, blockId) ?? '그림'} 설명 — Enter 저장 · Esc 그만 · 비우면 지움`, (v) => setBlockCaption(engine, blockId, v));
}

/** 사진 대체 텍스트 고치기 (블록 메뉴) — 캡션과 같은 입력 칸 */
export function editImageAlt(engine: Engine, blockId: Id, r: Spot): void {
  const c = engine.contentsOf(blockId).find(isImageContent);
  if (!c) return;
  lineInput(r, '대체 텍스트', c.alt ?? '', '사진 설명(대체 텍스트) — 화면 낭독 · 내보내기에 쓰여요. Enter 저장 · 비우면 지움', (v) => setImageAlt(engine, c.id, v));
}

/** 한 줄 입력 칸: Enter · 바깥 누르기 = 저장(바뀌었으면), Esc = 그만 */
function lineInput(r: Spot, label: string, value: string, placeholder: string, save: (v: string) => void): void {
  document.querySelector('.dn-caption-input')?.remove();
  const input = document.createElement('input');
  input.className = 'dn-caption-input dn-editor-pop';
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute('aria-label', label);
  Object.assign(input.style, { left: `${Math.max(8, r.left)}px`, top: `${Math.min(r.top, innerHeight - 40)}px`, width: `${Math.max(260, r.width)}px` });
  document.body.append(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (ok: boolean) => { if (done) return; done = true; input.remove(); if (ok && input.value !== value) save(input.value); };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('blur', () => finish(true));
}
