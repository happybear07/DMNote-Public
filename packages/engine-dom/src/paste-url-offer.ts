// 빈 캔버스에 주소만 붙여넣으면 (AT-012): 링크 글 상자를 만들고 바로 아래에 '링크로 두기 · 언급 · 북마크 · 임베드' 고르기 —
// 글 상자 안 빈 줄에 붙일 때(text-pm paste-url.ts)와 같은 메뉴. 언급은 그 상자 글을 칩 하나로, 북마크 · 임베드는 그 상자 자리에 웹 블록으로.
// ↑↓ · Enter로 고르기, Esc · 바깥 누르기 · 다른 키 · 화면 옮기기는 링크 그대로.
import { createWebBlock, deleteEntities, editText, isTextContent, type Engine, type Id, type TextDoc, type TextNode, type WebView } from '@dn/engine-core';
import { docReplaceSteps, iconElement, menuItem, pasteUrlChoices, type PasteUrlChoice } from '@dn/text-pm';
import type { CanvasView } from './canvas-view';

export function offerPasteUrl(view: CanvasView, blockId: Id, url: string): void {
  const items = pasteUrlChoices(url);
  const el = document.createElement('div');
  el.className = 'dn-paste-url dn-ui';
  el.setAttribute('role', 'listbox');
  el.setAttribute('aria-label', '붙여넣은 주소');
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  const ac = new AbortController(), signal = ac.signal;
  let index = 0;
  const close = () => { ac.abort(); el.remove(); };
  const choose = (c: PasteUrlChoice) => {
    close();
    const b = view.engine.getBlock(blockId);
    if (c.id === 'link' || !b) return;
    if (c.id === 'mention') { mentionBox(view, blockId, url); return; }
    let made: Id | null = null;
    view.engine.transact(() => {
      deleteEntities(view.engine, [blockId]);
      const r = createWebBlock(view.engine, { x: b.x, y: b.y }, url, c.id as WebView);
      if (r.ok) made = r.value.blockId;
    }, { origin: 'user', label: c.id === 'embed' ? '웹 임베드' : '웹 북마크' });
    if (made) view.select([made]);
  };
  const render = () => {
    el.replaceChildren(Object.assign(document.createElement('div'), { className: 'dn-slash-head', textContent: '붙여넣은 주소' }));
    items.forEach((c, i) => {
      const row = menuItem({ icon: iconElement(c.icon, 16), label: c.label, hint: c.hint }, i === index);
      row.addEventListener('mousemove', () => { if (index !== i) { index = i; render(); } });
      row.addEventListener('click', () => choose(c));
      el.append(row);
    });
  };
  render();
  view.root.append(el);
  // 새 상자가 그려진 뒤 그 바로 아래에
  requestAnimationFrame(() => {
    const r = view.mounted.get(blockId)?.el.getBoundingClientRect(), o = view.root.getBoundingClientRect();
    if (!r || !el.isConnected) { close(); return; }
    el.style.left = `${Math.max(8, Math.min(r.left - o.left, o.width - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.min(r.bottom - o.top + 6, o.height - el.offsetHeight - 8)}px`;
  });
  window.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { index = (index + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; render(); }
    else if (e.key === 'Enter') choose(items[index]!);
    else if (e.key === 'Escape') close();
    else { close(); return; } // 다른 키는 링크로 두고 그 키는 그대로
    e.preventDefault();
    e.stopPropagation();
  }, { capture: true, signal });
  window.addEventListener('pointerdown', (e) => { if (!el.contains(e.target as Node)) close(); }, { capture: true, signal });
  view.root.addEventListener('wheel', close, { signal, passive: true });
}

/** 상자 글 → 링크 언급 칩 하나, 사이트 제목이 모이면 채운다(그새 고쳤으면 그대로) */
function mentionBox(view: CanvasView, blockId: Id, url: string): void {
  const set = (e: Engine, attrs: Record<string, string>, only?: (n: TextNode) => boolean) => {
    const t = e.contentsOf(blockId).find(isTextContent);
    const cur = t?.doc.content[0]?.content?.[0];
    if (!t || (only && (t.doc.content.length !== 1 || !cur || !only(cur)))) return;
    const doc: TextDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'link_mention', attrs: { href: url, title: '', site: '', ...attrs } }] }] };
    editText(e, t.id, docReplaceSteps(t.doc, doc));
  };
  set(view.engine, {});
  void view.host.web?.unfurl?.(url).then((m) => {
    const title = m?.title?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '', site = m?.site?.replace(/\s+/g, ' ').trim().slice(0, 60) ?? '';
    if (title || site) set(view.engine, { title, site }, (n) => n.type === 'link_mention' && n.attrs?.href === url && !n.attrs?.title);
  }, () => {});
}
