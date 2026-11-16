// 탭 블록 그리기 · 고치기 (GAP #17 — engine-core tabs.ts): 위에 탭 줄(누르면 그 탭, 두 번 누르면 이름 고치기, + 탭 추가, × 지우기),
// 아래에 지금 탭의 글. 캔버스에서는 글을 두 번 누르면 그 탭 글을 그 자리에서 고친다(표 칸 편집처럼 — editing.ts · keyboard.ts).
// 지금 탭은 화면 상태(이 모듈의 표) — 캔버스 · 문서 뷰가 같은 탭을 보이고, 저장 · 실행 취소 대상이 아니다.
import { addTab, deleteTab, isTabsContent, renameTab, setTabDoc, type Engine, type Id, type TabsContent } from '@dn/engine-core';
import { renderStatic, TextEditor } from '@dn/text-pm';
import type { CanvasView } from './canvas-view';

const active = new Map<Id, Id>();
/** 지금 보이는 탭 (없거나 지워졌으면 첫 탭) */
export function activeTab(c: TabsContent): Id {
  const a = active.get(c.id);
  return a && c.tabs.some((t) => t.id === a) ? a : c.tabs[0]!.id;
}

export interface TabsOpts {
  engine: Engine;
  /** 탭 추가 · 이름 · 지우기를 막는다 (탭 바꿔 보기는 된다) */
  readOnly: boolean;
  /** 탭을 바꾸기 전에 (캔버스: 고치던 탭 글을 닫는다) */
  onSwitch?(): void;
  /** 고치는 중이면 글 칸은 그대로 두고 탭 줄만 다시 그린다 */
  editing?: boolean;
}

export function renderTabs(c: TabsContent, el: HTMLElement, o: TabsOpts): void {
  const cur = activeTab(c);
  el.className = 'dn-tabs';
  const strip = document.createElement('div');
  strip.className = 'dn-tabs-strip dn-ui';
  strip.setAttribute('role', 'tablist');
  const again = () => { const n = o.engine.getContent(c.id); if (isTabsContent(n)) renderTabs(n, el, { ...o, editing: false }); };
  for (const t of c.tabs) {
    const b = document.createElement('button');
    b.className = `dn-tab${t.id === cur ? ' on' : ''}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t.id === cur));
    b.textContent = t.label;
    b.title = o.readOnly ? t.label : `${t.label} — 두 번 누르면 이름 고치기`;
    b.addEventListener('click', (e) => { e.stopPropagation(); if (t.id === activeTab(c)) return; o.onSwitch?.(); active.set(c.id, t.id); again(); });
    if (!o.readOnly) b.addEventListener('dblclick', (e) => { e.stopPropagation(); renameInPlace(b, (name) => renameTab(o.engine, c.id, t.id, name)); });
    strip.append(b);
    if (!o.readOnly && t.id === cur && c.tabs.length > 1) {
      const x = document.createElement('button');
      x.className = 'dn-tab-x';
      x.textContent = '×';
      x.title = `'${t.label}' 탭 지우기`;
      x.setAttribute('aria-label', x.title);
      x.addEventListener('click', (e) => { e.stopPropagation(); o.onSwitch?.(); deleteTab(o.engine, c.id, t.id); });
      strip.append(x);
    }
  }
  if (!o.readOnly) {
    const add = document.createElement('button');
    add.className = 'dn-tab-add';
    add.textContent = '+';
    add.title = '탭 추가';
    add.setAttribute('aria-label', '탭 추가');
    add.addEventListener('click', (e) => { e.stopPropagation(); o.onSwitch?.(); const r = addTab(o.engine, c.id); if (r.ok) active.set(c.id, r.value); });
    strip.append(add);
  }
  const old = el.querySelector<HTMLElement>(':scope > .dn-tabs-body');
  if (o.editing && old) { el.querySelector(':scope > .dn-tabs-strip')?.replaceWith(strip); return; }
  const body = document.createElement('div');
  body.className = 'dn-tabs-body dn-text';
  body.dataset.tab = cur;
  body.setAttribute('role', 'tabpanel');
  renderStatic(c.tabs.find((t) => t.id === cur)!.doc, body);
  el.replaceChildren(strip, body);
}

/** 탭 이름을 그 자리에서 — Enter · 바깥 누르기 = 저장, Esc = 그만 */
function renameInPlace(b: HTMLElement, save: (name: string) => void): void {
  const inp = document.createElement('input');
  inp.className = 'dn-tab-name';
  inp.value = b.textContent ?? '';
  inp.setAttribute('aria-label', '탭 이름');
  let done = false;
  const finish = (ok: boolean) => { if (done) return; done = true; if (ok && inp.value.trim() && inp.value !== b.textContent) save(inp.value); else inp.replaceWith(b); };
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.isComposing) return; if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.replaceWith(inp);
  inp.focus();
  inp.select();
}

/** 캔버스: 지금 탭 글 고치기 */
export interface TabEdit { blockId: Id; contentId: Id; tabId: Id; editor: TextEditor }

export function startTabEdit(view: CanvasView, blockId: Id, contentId: Id): void {
  const c = view.engine.getContent(contentId);
  if (view.readOnly || !isTabsContent(c)) return;
  const tabId = activeTab(c);
  const body = view.mounted.get(blockId)?.el.querySelector<HTMLElement>(`[data-part="${contentId}"] .dn-tabs-body`);
  if (!body) return;
  if (view.editingId) view.endEditing();
  view.engine.breakUndoMerge();
  view.select([blockId]);
  view.editingId = blockId;
  const editor = new TextEditor({
    mount: body, mode: 'body', doc: c.tabs.find((t) => t.id === tabId)!.doc, overlay: view.root, at: 'end',
    onSteps: () => setTabDoc(view.engine, contentId, tabId, editor.doc),
    onUndo: () => { view.engine.undo(); },
    onRedo: () => { view.engine.redo(); },
    onEscape: () => { view.endEditing(); view.root.focus({ preventScroll: true }); },
  });
  body.classList.add('dn-tab-editing');
  view.tabEdit = { blockId, contentId, tabId, editor };
  view.mounted.get(blockId)?.el.classList.add('dn-editing');
  view.schedule();
  view.notifyUi();
}

export function endTabEdit(view: CanvasView): void {
  const te = view.tabEdit;
  if (!te) return;
  view.tabEdit = null;
  te.editor.destroy();
  view.engine.breakUndoMerge();
  const p = view.mounted.get(te.blockId)?.parts.find((x) => x.contentId === te.contentId);
  if (p) p.rendered = null; // 다음 그리기에서 정적 글로
}
