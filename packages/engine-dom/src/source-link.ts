// 원문 출처 연결 (FR-111): AI 상자 · 원문에서 꺼낸 상자(source) 하나를 고르면 원문 상자에서 그 상자가 나온 구절을 강조한다 — CSS Custom Highlight라 글 · DOM은 그대로.
// 원문(출처 콘텐츠)을 지웠으면 그 상자에 '출처 없음'(dn-nosrc — 종류 태그 뒤에 CSS로). 그리기마다 부르되, 고른 것 · 원문 글이 바뀔 때만 다시 찾는다.
import { sourceOf, type Block, type Id } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';

const NAME = 'dn-source';
const last = new WeakMap<CanvasView, string>();

/** 이 상자가 나온 원문 상자 (출처가 있고 그 콘텐츠가 아직 있으면) */
export function sourceBlockOf(view: CanvasView, id: Id): Id | null {
  const cid = sourceOf(view.engine.getBlock(id))?.contentId;
  return (cid && view.engine.getContent(cid)?.blockId) || null;
}

/** 출처가 있었는데 원문을 지웠나 */
const sourceGone = (view: CanvasView, b: Block | undefined) => { const cid = sourceOf(b)?.contentId; return !!cid && !view.engine.getContent(cid); };

export function syncSourceLink(view: CanvasView): void {
  for (const [id, m] of view.mounted) m.el.classList.toggle('dn-nosrc', sourceGone(view, view.engine.getBlock(id)));
  const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
  const Hl = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!reg || !Hl) return;
  const sel = view.selectedBlocks;
  const b = sel.length === 1 ? view.engine.getBlock(sel[0]!) : undefined;
  const s = sourceOf(b), src = b ? sourceBlockOf(view, b.id) : null;
  const el = src ? view.mounted.get(src)?.el : undefined;
  const key = el && s?.excerpt ? `${b!.id}|${src}|${s.excerpt}|${el.textContent?.length}` : '';
  if (key === last.get(view)) return;
  last.set(view, key);
  const range = el && s?.excerpt ? findText(el, s.excerpt) : null;
  if (range) reg.set(NAME, new Hl(range)); else reg.delete(NAME);
}

/** 상자 DOM의 글에서 구절을 찾아 Range로 (태그 · 캡션 밖 글만, 공백 차이는 무시) */
function findText(root: HTMLElement, excerpt: string): Range | null {
  const nodes: Text[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('.dn-kind-tag') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n as Text);
  // 공백을 뺀 글자 줄과, 그 글자가 어느 노드 몇 번째인지
  let flat = '';
  const at: [Text, number][] = [];
  for (const t of nodes) for (let i = 0; i < t.data.length; i++) if (!/\s/.test(t.data[i]!)) { flat += t.data[i]; at.push([t, i]); }
  const want = excerpt.replace(/\s+/g, '');
  const i = want ? flat.indexOf(want) : -1;
  if (i < 0) return null;
  const r = document.createRange();
  const [sn, so] = at[i]!, [en, eo] = at[i + want.length - 1]!;
  r.setStart(sn, so);
  r.setEnd(en, eo + 1);
  return r;
}
