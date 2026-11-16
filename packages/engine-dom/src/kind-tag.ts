// 노드 종류 · 상태 표시 (노트 v6 3단계, STRUCTURE-GUIDE 4.1 · 4.5 · 4.12): 색만으로 구분하지 않게 블록 바로 위 왼쪽에 태그
// "역할 · kind"(경고면 앞에 ⚠, 조건 ◇ · 결정 ✓ · 할 일 ☐ · 목표 ◎ · 위험 △ · 행위자 ●)와 발화자 칩 "● 갑설",
// 원문의 시점 · 담당 · 기한 · 기간 칩(사건은 시점이 머리 "1876 · event", Figma S-04 · S-57).
// 테두리 · 바탕은 CSS가 data-kind · data-state · dn-hedge로 칠한다. 태그는 블록 밖에 떠 있어 글 높이 측정에 영향이 없다.
import { NODE_KIND_LABEL, type Block, type KnownNodeKind } from '@dn/engine-core';

const MARK: Partial<Record<KnownNodeKind, string>> = { condition: '◇', decision: '✓', action: '☐', goal: '◎', risk: '△', actor: '●' };

/** 한 블록의 상태 하나: 경고 > 흐림 > 강조 (가이드 4.5). 불확실은 따로 겹친다 */
export function blockState(b: Pick<Block, 'status' | 'emphasis'>): '' | 'warning' | 'dim' | 'strong' {
  return b.emphasis === 'warning' ? 'warning' : b.status ? 'dim' : b.emphasis === 'strong' ? 'strong' : '';
}

/** 태그 글자 (역할이 없으면 사건은 시점, 그 밖은 종류의 한글 이름) */
export function kindTagText(b: Pick<Block, 'nodeKind' | 'role' | 'emphasis' | 'time'>): string {
  const k = b.nodeKind;
  if (!k && !b.role) return '';
  const known = k ? NODE_KIND_LABEL[k as KnownNodeKind] : undefined;
  const mark = k ? MARK[k as KnownNodeKind] : undefined;
  const head = b.role || (k === 'event' && b.time) || known || k || '';
  return [b.emphasis === 'warning' ? '⚠' : '', mark ?? '', k ? `${head} · ${k}` : head].filter(Boolean).join(' ');
}

/** 원문 그대로의 시점 · 담당 · 기한 · 기간 칩 (계산하지 않는다) — 사건의 시점은 머리에 있으니 빼고 */
export function metaChips(b: Pick<Block, 'nodeKind' | 'role' | 'time' | 'owner' | 'due' | 'start' | 'end'>): string[] {
  const timeInHead = b.nodeKind === 'event' && !b.role;
  return [
    b.time && !timeInHead ? b.time : '',
    b.start || b.end ? `${b.start ?? ''}~${b.end ?? ''}` : '',
    b.owner ? `담당 ${b.owner}` : '',
    b.due ? `기한 ${b.due}` : '',
  ].filter(Boolean);
}

export function kindTag(b: Block, m: { el: HTMLElement }): void {
  const el = m.el;
  if (b.nodeKind) el.dataset.kind = b.nodeKind; else delete el.dataset.kind;
  const st = blockState(b);
  if (st) el.dataset.state = st; else delete el.dataset.state;
  el.classList.toggle('dn-hedge', !!b.hedge && b.nodeKind !== 'assumption'); // 가정에는 불확실을 얹지 않는다 (4.5)
  // 카드 안(노트형)에서는 종류 꼬리표를 숨긴다 — 값은 그대로, 원문의 시점 · 담당 · 기한 칩은 남긴다
  const text = el.classList.contains('dn-in-card') ? '' : kindTagText(b), chips = metaChips(b);
  let tag = el.querySelector<HTMLElement>(':scope > .dn-kind-tag');
  if (!text && !b.speaker && !chips.length) { tag?.remove(); return; }
  if (!tag) { tag = Object.assign(document.createElement('div'), { className: 'dn-kind-tag' }); tag.setAttribute('aria-hidden', 'true'); }
  const parts: HTMLElement[] = [];
  if (text) parts.push(Object.assign(document.createElement('span'), { textContent: text }));
  if (b.speaker) parts.push(Object.assign(document.createElement('span'), { className: 'dn-speaker', textContent: `● ${b.speaker}` }));
  for (const c of chips) parts.push(Object.assign(document.createElement('span'), { className: 'dn-meta-chip', textContent: c }));
  tag.replaceChildren(...parts);
  if (tag.parentElement !== el) el.prepend(tag);
}
