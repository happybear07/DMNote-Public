// 편집 중이 아닌 블록의 정적 렌더: ProseMirror 스키마의 toDOM을 그대로 쓴다 (에디터 인스턴스 없이).
import type { TextDoc } from '@dn/engine-core';
import { DOMSerializer } from 'prosemirror-model';
import { toNode } from './codec';
import { schema } from './schema';
import { renderMath } from './math';
import { highlightElement } from './highlight';
import { installCodeCopy } from './code-copy';

let serializer: DOMSerializer | null = null;

export function renderStatic(doc: TextDoc, el: HTMLElement): void {
  serializer ??= DOMSerializer.fromSchema(schema);
  const node = toNode(doc);
  el.replaceChildren(serializer.serializeFragment(node.content));
  // 수식은 KaTeX로 (FR-018)
  if (el.querySelector('[data-tex]')) renderMath(el);
  // 코드 구문 강조 (FR-026)
  for (const pre of el.querySelectorAll<HTMLElement>('pre[data-language]')) { const code = pre.querySelector('code'); if (code) highlightElement(code, pre.dataset.language!); }
  if (el.querySelector('pre')) installCodeCopy(); // 코드 '복사' 단추
  // 빈 첫 제목은 자리표시자를 보여 준다
  const first = el.firstElementChild;
  if (first && /^H[1-3]$/.test(first.tagName) && !first.textContent) first.classList.add('dn-empty');
  // 토글 · 할 일은 편집하지 않고도 누를 수 있다 — 문서 위치를 달아 두면 캔버스가 flipAttrSteps로 바꾼다.
  // DOM 순서와 문서 순서(전위 순회)는 같다.
  const toggles = el.querySelectorAll<HTMLElement>('[data-type="toggle"], li[data-checked]');
  if (!toggles.length) return;
  let i = 0;
  node.descendants((n, pos) => {
    if (n.type.name === 'toggle' || n.type.name === 'task_item') { const t = toggles[i++]; if (t) t.dataset.pos = String(pos); }
    return true;
  });
}
