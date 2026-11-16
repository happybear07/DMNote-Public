// 댓글 표시 (FR-132): 열린 댓글이 있는 블록 오른쪽 위에 말풍선 · 개수 — 누르면 앱이 댓글 창을 연다.
// 글 일부에 단 댓글은 글 속 표시(comment mark)로도 보인다. 해결 · 지우기 때 그 표시를 지우는 스텝은 commentMarkEdits가 만든다.
import { blockTextParts, openComments, type Block, type CommentTextEdit, type Engine, type Id } from '@dn/engine-core';
import { removeCommentSteps } from '@dn/text-pm';
import type { CanvasView } from './canvas-view';
import { svg } from './rich-render';
import type { Mounted } from './types';

const BUBBLE = 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z';

export function commentBadge(view: CanvasView, b: Block, m: Mounted): void {
  const n = openComments(b).length;
  let el = m.el.querySelector<HTMLButtonElement>(':scope > .dn-comment-badge');
  if (!n || !view.host.onComments) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('button');
    el.type = 'button';
    el.className = 'dn-comment-badge dn-ui';
    const icon = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    icon.append(svg('path', { d: BUBBLE }));
    el.append(icon, document.createElement('span'));
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = el!.getBoundingClientRect();
      view.select([b.id]);
      view.host.onComments?.({ blockId: b.id, x: r.left, y: r.bottom + 6 });
    });
  }
  el.querySelector('span')!.textContent = String(n);
  el.setAttribute('aria-label', `댓글 ${n}개 보기`);
  el.title = `댓글 ${n}개`;
  if (el.parentElement !== m.el) m.el.append(el);
}

/** 이 블록 글 속의 댓글 표시(anchor)를 지우는 편집 — 해결 · 지우기에 함께 넘긴다 */
export function commentMarkEdits(engine: Engine, blockId: Id, anchor: Id | undefined): CommentTextEdit[] {
  if (!anchor) return [];
  const { title, bodies } = blockTextParts(engine.contentsOf(blockId));
  const out: CommentTextEdit[] = [];
  for (const c of [title, ...bodies]) {
    if (!c || !JSON.stringify(c.doc).includes(anchor)) continue;
    const steps = removeCommentSteps(c.doc, anchor);
    if (steps.length) out.push({ contentId: c.id, steps });
  }
  return out;
}
