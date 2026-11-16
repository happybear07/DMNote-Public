// 손글씨 → 글 상자 (FR-038): 인식한 줄을 글 상자로 — "- "는 글머리 목록, "[ ] " · "[x] "는 할 일, 나머지는 문단.
// 필기가 있던 자리에 상자를 놓고, 고르면 필기는 지운다(바꾸기) 또는 남긴다(추가). 트랜잭션 하나 = 실행 취소 한 번.
import type { Engine, TxResult } from './engine';
import { q, type Rect } from './geom';
import type { Id, TextDoc, TextNode } from './model';

const para = (text: string): TextNode => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });

/** 인식한 줄 → 글 문서 */
export function ocrLinesDoc(lines: readonly string[]): TextDoc {
  const out: TextNode[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const task = /^\[( |x|X)\]\s?(.*)$/.exec(line), bullet = /^[-•·]\s+(.*)$/.exec(line);
    const last = out[out.length - 1];
    if (task) {
      const item: TextNode = { type: 'task_item', attrs: { checked: task[1] !== ' ' }, content: [para(task[2]!)] };
      if (last?.type === 'task_list') (last.content as TextNode[]).push(item); else out.push({ type: 'task_list', content: [item] });
    } else if (bullet) {
      const item: TextNode = { type: 'list_item', content: [para(bullet[1]!)] };
      if (last?.type === 'bullet_list') (last.content as TextNode[]).push(item); else out.push({ type: 'bullet_list', content: [item] });
    } else out.push(para(line));
  }
  return { type: 'doc', content: out.length ? out : [para('')] };
}

/** 필기 자리에 글 상자 (removeInk면 그 필기를 지운다). 결과: 새 블록 id */
export function inkToText(engine: Engine, strokeIds: readonly Id[], lines: readonly string[], at: Rect, opts: { removeInk: boolean; h?: number }): TxResult<Id> {
  return engine.transact((tx) => {
    const blockId = tx.createBlock({ x: q(at.x), y: q(at.y), w: q(Math.max(160, at.w)), h: q(opts.h ?? Math.max(40, at.h)) });
    tx.createContent({ blockId, type: 'text', role: 'body', doc: ocrLinesDoc(lines) });
    if (opts.removeInk) for (const id of strokeIds) if (engine.getStroke(id)) tx.delete('stroke', id);
    return blockId;
  }, { origin: 'user', label: opts.removeInk ? '손글씨를 글로 바꾸기' : '손글씨를 글로 추가' });
}
