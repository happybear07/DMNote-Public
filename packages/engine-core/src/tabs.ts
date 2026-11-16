// 탭 블록 (GAP #17 — 노션 /tabs, 2026-03): 블록 하나 안에 탭 여러 개, 탭마다 글 한 문서. 한 번에 한 탭만 보인다.
// 어느 탭을 보고 있는지는 화면 상태(engine-dom tabs-render.ts) — 탭을 바꿔 보는 것은 고치기가 아니라 저장 · 실행 취소 대상이 아니다.
// 글은 탭마다 통째로 저장한다(표 칸처럼, 같은 탭을 이어 치면 실행 취소 한 번). 내보내기 · 검색은 모든 탭을 차례로.
import type { Engine, TxResult } from './engine';
import { newId } from './id';
import type { Content, Id, TextDoc } from './model';
import type { Vec2 } from './geom';

export interface TabItem { readonly id: Id; readonly label: string; readonly doc: TextDoc }
export interface TabsData { readonly tabs: readonly TabItem[] }
export type TabsContent = Content & TabsData & { readonly type: 'tabs' };

export function isTabsContent(c: Content | undefined): c is TabsContent {
  return !!c && c.type === 'tabs' && Array.isArray((c as TabsContent).tabs) && (c as TabsContent).tabs.length > 0;
}

const emptyDoc = (): TextDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] });
const tabsOf = (engine: Engine, cid: Id): TabsContent | null => { const c = engine.getContent(cid); return isTabsContent(c) ? c : null; };

export function createTabsBlock(engine: Engine, at: Vec2, labels: readonly string[] = ['탭 1', '탭 2']): TxResult<Id> {
  return engine.transact((tx) => {
    const blockId = tx.createBlock({ x: Math.round(at.x), y: Math.round(at.y), w: 420, h: 120 });
    tx.createContent({ blockId, type: 'tabs', tabs: labels.map((label) => ({ id: newId(), label, doc: emptyDoc() })) } as never);
    return blockId;
  }, { origin: 'user', label: '탭 넣기' });
}

/** 탭 하나 더 (맨 끝) — 새 탭 id */
export function addTab(engine: Engine, cid: Id, label?: string): TxResult<Id> {
  return engine.transact((tx) => {
    const c = tabsOf(engine, cid);
    if (!c) return tx.fail('탭 블록이 아니에요');
    const id = newId();
    tx.set('content', cid, { tabs: [...c.tabs, { id, label: label ?? `탭 ${c.tabs.length + 1}`, doc: emptyDoc() }] });
    return id;
  }, { origin: 'user', label: '탭 추가' });
}

export function renameTab(engine: Engine, cid: Id, tabId: Id, label: string): TxResult<void> {
  return engine.transact((tx) => {
    const c = tabsOf(engine, cid);
    const name = label.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!c || !name) return tx.fail('이름이 비었어요');
    tx.set('content', cid, { tabs: c.tabs.map((t) => (t.id === tabId ? { ...t, label: name } : t)) });
  }, { origin: 'user', label: '탭 이름' });
}

/** 탭 지우기 — 하나 남으면 지우지 않는다 */
export function deleteTab(engine: Engine, cid: Id, tabId: Id): TxResult<void> {
  return engine.transact((tx) => {
    const c = tabsOf(engine, cid);
    if (!c || c.tabs.length < 2) return tx.fail('탭이 하나뿐이에요');
    tx.set('content', cid, { tabs: c.tabs.filter((t) => t.id !== tabId) });
  }, { origin: 'user', label: '탭 지우기' });
}

/** 탭 글 저장 — 같은 탭을 이어 고치면 실행 취소 한 번으로 묶인다 */
export function setTabDoc(engine: Engine, cid: Id, tabId: Id, doc: TextDoc): TxResult<void> {
  return engine.transact((tx) => {
    const c = tabsOf(engine, cid);
    if (!c?.tabs.some((t) => t.id === tabId)) return tx.fail('탭이 없어요');
    tx.set('content', cid, { tabs: c.tabs.map((t) => (t.id === tabId ? { ...t, doc } : t)) });
  }, { origin: 'text', label: '탭 글', mergeKey: `tab:${cid}:${tabId}` });
}
