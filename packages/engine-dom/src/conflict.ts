// 동기화 충돌 표시 (FR-097): 다른 기기와 합칠 때 한쪽이 지우고 다른 쪽이 고친 블록은 되살린 채 위에 안내 · 남기기 · 지우기.
import { resolveConflict, type Block } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import type { Mounted } from './types';

const TEXT = {
  'remote-deleted': '다른 기기에서 지운 블록이에요 — 여기서 고친 내용이 있어 남겨 두었어요',
  'local-deleted': '이 기기에서 지운 블록을 다른 기기에서 고쳤어요 — 고친 내용으로 되살렸어요',
} as const;

export function conflictBadge(view: CanvasView, b: Block, m: Mounted): void {
  let el = m.el.querySelector<HTMLElement>(':scope > .dn-conflict');
  m.el.classList.toggle('dn-has-conflict', !!b.conflict);
  if (!b.conflict) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.className = 'dn-conflict dn-ui';
    el.setAttribute('role', 'alert');
    const msg = document.createElement('span');
    msg.className = 'dn-conflict-msg';
    const btn = (text: string, cls: string, keep: boolean) => {
      const x = document.createElement('button');
      x.textContent = text;
      x.className = cls;
      x.addEventListener('click', (e) => { e.stopPropagation(); resolveConflict(view.engine, b.id, keep); });
      return x;
    };
    el.append(msg, btn('남기기', 'dn-conflict-keep', true), btn('지우기', 'dn-conflict-drop', false));
  }
  if (el.parentElement !== m.el || m.el.lastElementChild !== el) m.el.append(el);
  el.querySelector('.dn-conflict-msg')!.textContent = TEXT[b.conflict.kind];
}
