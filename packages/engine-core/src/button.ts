// 버튼 블록 (GAP #17 — 노션 /button의 '블록 넣기'): 누르면 정해 둔 상자들(사이 화살표째)을 이 버튼 바로 아래에 새로 넣는다.
// 넣을 내용은 블록 묶음(clip.ts) — 캔버스에서 고른 상자로 만들거나 바꾼다(블록 메뉴 › 이 상자들로 버튼 만들기 · 버튼 ⋯ › 고른 상자로 바꾸기).
// /버튼으로 만들면 빈 할 일 한 줄. 아래 상자는 밀어 내리고 문서 순서도 버튼 바로 뒤(doc-edit.ts insertClipBelow — 문서 뷰와 같은 길).
import type { Engine, TxResult } from './engine';
import type { Content, Id } from './model';
import type { Vec2 } from './geom';
import { blockClip, isBlockClip, type BlockClip } from './clip';
import { insertClipBelow, makeRoomBelow } from './doc-edit';

export interface ButtonData { readonly label: string; readonly clip: BlockClip }
export type ButtonContent = Content & ButtonData & { readonly type: 'button' };

export function isButtonContent(c: Content | undefined): c is ButtonContent {
  return !!c && c.type === 'button' && typeof (c as ButtonContent).label === 'string' && isBlockClip((c as ButtonContent).clip);
}

/** 버튼 블록은 크기 고정 — 글처럼 자라면 바로 아래 상자와 겹쳐 누를 때 자리를 못 낸다 */
export const BUTTON_SIZE = { w: 220, h: 40 } as const;

/** 기본 넣을 내용: 빈 할 일 한 줄 (노션 버튼 기본 '할 일 추가'와 같은 쓰임) */
export function defaultButtonClip(): BlockClip {
  const doc = { type: 'doc', content: [{ type: 'task_list', content: [{ type: 'task_item', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] }] };
  return { kind: 'dn-blocks', v: 2, arrows: [], blocks: [{ dx: 0, dy: 0, w: 320, h: 34, sizing: 'auto', layout: 'flow', contents: [{ type: 'text', role: 'body', doc }] }] };
}

/** 넣을 내용 한 줄 설명 — 상자 수 · 첫 글 */
export function buttonSummary(c: ButtonData): string {
  const first = JSON.stringify(c.clip.blocks[0]?.contents[0] ?? {}).match(/"text":"([^"]{1,40})/)?.[1];
  return `상자 ${c.clip.blocks.length}개${first ? ` — ${first}` : ''}`;
}

export function createButtonBlock(engine: Engine, at: Vec2, label = '버튼', clip: BlockClip = defaultButtonClip()): TxResult<Id> {
  return engine.transact((tx) => {
    const blockId = tx.createBlock({ x: Math.round(at.x), y: Math.round(at.y), w: BUTTON_SIZE.w, h: BUTTON_SIZE.h, sizing: 'fixed' });
    tx.createContent({ blockId, type: 'button', label, clip } as never);
    return blockId;
  }, { origin: 'user', label: '버튼 넣기' });
}

/** 고른 상자들로 버튼 — 그 상자들 바로 아래(아래 상자는 내림), 원래 상자는 그대로 */
export function buttonFromBlocks(engine: Engine, ids: readonly Id[], label = '버튼'): TxResult<Id> {
  return engine.transact((tx) => {
    const bs = ids.map((id) => engine.getBlock(id)).filter((b) => !!b);
    if (!bs.length) return tx.fail('고른 상자가 없어요');
    const low = bs.reduce((a, b) => (b!.y + b!.h > a!.y + a!.h ? b : a))!;
    const room = makeRoomBelow(engine, low.id, BUTTON_SIZE.h);
    if (!room.ok) return tx.fail(room.reason);
    const blockId = tx.createBlock({ x: Math.min(...bs.map((b) => b!.x)), y: room.value.y, w: BUTTON_SIZE.w, h: BUTTON_SIZE.h, sizing: 'fixed' });
    tx.createContent({ blockId, type: 'button', label, clip: blockClip(engine, bs.map((b) => b!.id)) } as never);
    return blockId;
  }, { origin: 'user', label: '버튼 만들기' });
}

export function setButtonLabel(engine: Engine, contentId: Id, label: string): TxResult<void> {
  return engine.transact((tx) => {
    if (!isButtonContent(engine.getContent(contentId))) return tx.fail('버튼이 아니에요');
    tx.set('content', contentId, { label: label.trim().slice(0, 60) || '버튼' });
  }, { origin: 'user', label: '버튼 이름' });
}

/** 넣을 내용을 이 상자들로 바꾸기 */
export function setButtonBlocks(engine: Engine, contentId: Id, ids: readonly Id[]): TxResult<void> {
  return engine.transact((tx) => {
    const c = engine.getContent(contentId);
    const live = ids.filter((id) => id !== c?.blockId && engine.getBlock(id));
    if (!isButtonContent(c) || !live.length) return tx.fail('바꿀 상자가 없어요');
    tx.set('content', contentId, { clip: blockClip(engine, live) });
  }, { origin: 'user', label: '버튼 내용 바꾸기' });
}

/** 누르기 — 넣을 내용을 이 버튼 바로 아래에. 새 블록 id들 (실행 취소 한 번) */
export function pressButton(engine: Engine, blockId: Id): TxResult<Id[]> {
  const c = engine.contentsOf(blockId).find(isButtonContent);
  if (!c) return engine.transact((tx) => tx.fail('버튼이 아니에요'), { origin: 'user' });
  return insertClipBelow(engine, blockId, c.clip, `'${c.label}' 버튼`);
}
