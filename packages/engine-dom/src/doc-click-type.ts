// 문서 뷰 '클릭하여 입력' (워드): 글 아래 빈 곳을 두 번 누르면 그 높이까지 빈 줄을 채우고 그 자리에 커서.
// 항목 사이 틈을 두 번 누르면 그 자리에 새 내용 상자 (gapInsert).
// 가로 자리로 맞춤 — 가운데 띠는 가운데, 오른쪽 끝 띠는 오른쪽, 왼쪽은 누른 자리만큼 들여쓰기(24px 단계).
// 첫 번째 누르기가 맨 끝에 연 빈 초안(DocWord.pageDown)은 닫으면서 사라지고, 빈 줄을 채운 초안 하나를 새로 연다.
// 글을 치지 않고 떠나면 그 초안도 사라진다(discardIfEmpty). 실행 취소 한 번에 되돌아간다.
import { appendTextBox, endBlock, insertDraftBelow, isTextContent, MAX_INDENT, setBlockTextStyle, setText, type Block, type BlockAlign } from '@dn/engine-core';
import type { DocView } from './doc-view';

const STEP = 24;

/** 맞춤 · 들여쓰기: 글 영역 왼쪽에서 x (px) · 폭 w */
export function clickTypeAlign(x: number, w: number): { align: BlockAlign | null; indent: number } {
  if (Math.abs(x - w / 2) < w * 0.12) return { align: 'center', indent: 0 };
  if (x > w * 0.85) return { align: 'right', indent: 0 };
  return { align: null, indent: x < STEP * 1.5 ? 0 : Math.min(MAX_INDENT, Math.round(x / STEP)) };
}

/** 빈 줄 하나의 높이 · 다음 줄까지 간격(문단 사이 여백 포함) · 항목 안쪽 위 여백 — 보이지 않는 빈 문단 둘을 잠깐 넣어 잰다 */
function blankLine(dv: DocView): { line: number; advance: number; pad: number } {
  const item = document.createElement('div');
  item.className = 'dn-doc-item';
  item.style.cssText = 'position:absolute;visibility:hidden;left:0;right:0;top:0';
  const probe = Object.assign(document.createElement('div'), { className: 'dn-text dn-doc-text' });
  probe.append(...[0, 1].map(() => { const p = document.createElement('p'); p.append(document.createElement('br')); return p; }));
  item.append(probe);
  dv.page.append(item);
  const [a, b] = [...probe.querySelectorAll('p')].map((p) => p.getBoundingClientRect());
  const out = { line: a?.height || STEP, advance: (b && a ? b.top - a.top : 0) || STEP, pad: (a ? a.top - item.getBoundingClientRect().top : 0) };
  item.remove();
  return out;
}

/** 두 번 누르기 (DocView 'dblclick') — 처리했으면 true */
export function clickAndType(dv: DocView, ev: MouseEvent): boolean {
  const t = ev.target instanceof Element ? ev.target : null;
  const e = dv.opts.engine, host = dv.opts.word;
  if (!t || !host || dv.opts.readOnly || t.closest('.dn-ui, .dn-editor-pop, .dn-doc-header')) return false;
  const cs = getComputedStyle(dv.page), pr = dv.page.getBoundingClientRect();
  const left = pr.left + parseFloat(cs.paddingLeft), w = pr.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const { align, indent } = clickTypeAlign(ev.clientX - left, w);
  const style = { align, indent: indent || null };
  // 글 없는 초안: 첫 누르기가 연 것 — 곧 사라지므로 높이를 잴 때 뺀다
  const emptyDraft = (el: HTMLElement) => {
    const b = e.getBlock(el.dataset.id!), c = b ? e.contentsOf(b.id)[0] : undefined;
    return !!b?.draft && !!c && isTextContent(c) && !c.doc.content.some((n) => n.content?.length);
  };
  const items = [...dv.page.querySelectorAll<HTMLElement>('.dn-doc-item[data-id]')];
  const item = t.closest<HTMLElement>('.dn-doc-item[data-id]');
  if (item) {
    // 첫 누르기가 바로 그 자리에 연 빈 문단을 한 번 더 누른 것 — 빈 줄은 필요 없고 맞춤만 (고치던 문단은 그대로)
    if (item !== items[items.length - 1] || !emptyDraft(item)) return false;
    ev.preventDefault();
    setBlockTextStyle(e, [item.dataset.id!], style);
    return true;
  }
  const solid = items.filter((el) => !emptyDraft(el));
  const ref = solid[solid.length - 1];
  const gap = parseFloat(cs.rowGap) || 10;
  const top = ref ? ref.getBoundingClientRect().bottom + gap : pr.top + parseFloat(cs.paddingTop);
  const { line, advance, pad } = blankLine(dv);
  if (ev.clientY < top - line / 2) return gapInsert(dv, ev);
  const lines = Math.max(0, Math.min(80, Math.round((ev.clientY - top - pad - line / 2) / advance)));
  ev.preventDefault();
  dv.word.close(false);
  const r = e.transact(() => {
    const box = appendTextBox(e, host.measure({ type: 'doc', content: [{ type: 'paragraph' }] }, 600, 'text'));
    if (!box.ok) return null;
    setText(e, box.value.contentId, { type: 'doc', content: Array.from({ length: lines + 1 }, () => ({ type: 'paragraph' })) });
    setBlockTextStyle(e, [box.value.blockId], style);
    return box.value.contentId;
  }, { origin: 'user', label: '클릭하여 입력' });
  dv.render();
  const id = r.ok ? r.value : null;
  const el = id ? dv.page.querySelector<HTMLElement>(`.dn-doc-text[data-part="${id}"]`) : null;
  if (el) dv.word.open(el, 'end');
  return true;
}

/**
 * 항목 사이 틈(제목과 첫 항목 사이 · 쪽 끝 빈 곳 포함): 위 항목 바로 아래에 새 내용 상자(초안)를 열어 거기서 쓴다.
 * 틈이 묶음 · 흐름 단계 안이면 새 상자도 그 안으로. 맞춤 · 들여쓰기는 없이(좁은 틈이라 가로 자리는 우연). 항목 옆 여백이면 false — 첫 누르기가 가까운 글을 열었다.
 */
function gapInsert(dv: DocView, ev: MouseEvent): boolean {
  const e = dv.opts.engine, host = dv.opts.word!;
  const tops = [...dv.page.querySelectorAll<HTMLElement>(':scope > .dn-doc-header, :scope > .dn-doc-item, :scope > .dn-doc-row')];
  let i = 0;
  for (; i < tops.length; i++) {
    const r = tops[i]!.getBoundingClientRect();
    if (ev.clientY < r.top) break;
    if (ev.clientY <= r.bottom) return false;
  }
  // 위 블록: 틈 바로 위 항목(컬럼 줄이면 가장 아래로 내려온 칸). 손그림 · 제목뿐이면 그 위로 거슬러, 없으면 문서 맨 위
  const blockOf = (el?: HTMLElement): Block | undefined => {
    const els = !el ? [] : el.matches('[data-id]') ? [el] : [...el.querySelectorAll<HTMLElement>('.dn-doc-item[data-id]')];
    return els.map((x) => e.getBlock(x.dataset.id!)).filter((b): b is Block => !!b).sort((a, b) => b.y + b.h - (a.y + a.h))[0];
  };
  let above: Block | undefined;
  for (let k = i - 1; k >= 0 && !above; k--) above = blockOf(tops[k]);
  const below = blockOf(tops[i]);
  const join = !!above && !!below && ((!!above.group && above.group === below.group) || e.arrowsOf(above.id).some((a) => endBlock(a.to) === below.id || endBlock(a.from) === below.id));
  ev.preventDefault();
  dv.word.close(false);
  const r = insertDraftBelow(e, above?.id ?? null, host.measure({ type: 'doc', content: [{ type: 'paragraph' }] }, 600, 'text'), join);
  if (r.ok) dv.word.openNew(r.value.contentId, 'start', r.value.room);
  return true;
}
