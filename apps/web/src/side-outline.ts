// 사이드바 '이 노트' 나무 (11/09): 지금 노트의 블록(콘텐츠 묶음) ▸ 그 안 콘텐츠(상자), 묶이지 않은 상자는 그대로 한 줄.
// 순서는 캔버스에서 읽는 순서(readingOrder — 묶음은 한 덩어리). 표지 안 · 아직 빈 초안 상자는 뺀다.
import { blockTextParts, coverItems, groupName, readingOrder, textLines, type Content, type Engine } from '@dn/engine-core';
import type { IconName } from '@dn/text-pm';

export interface OutlineItem { id: string; label: string; icon: IconName }
export type OutlineRow =
  | { kind: 'block'; id: string; name: string; items: OutlineItem[] }
  | ({ kind: 'box' } & OutlineItem);

/** 너무 긴 노트에서 사이드바가 무거워지지 않게 — 넘으면 끝에 '…외 N개' */
export const OUTLINE_MAX = 300;

const TYPE_ICON: Record<string, IconName> = {
  table: 'table', chart: 'chart', image: 'image', file: 'paperclip', database: 'database', toc: 'list', embed: 'external', web: 'globe', ink: 'pencil',
  button: 'target', divider: 'divider', tabs: 'columns',
};
const TYPE_NAME: Record<string, string> = {
  table: '표', chart: '그래프', image: '그림', file: '첨부 파일', database: '데이터베이스', toc: '목차', embed: '임베드', web: '웹 카드', ink: '손글씨',
  button: '버튼', divider: '구분선', tabs: '탭',
};

/** 상자 한 줄: 첫 글 줄(제목이 있으면 제목) — 글이 없으면 콘텐츠 종류 */
function boxItem(id: string, contents: readonly Content[]): OutlineItem {
  const { title, bodies } = blockTextParts(contents);
  const text = [title, ...bodies].flatMap((c) => (c ? textLines(c.doc) : [])).find((l) => l.trim())?.trim().slice(0, 60);
  const other = contents.find((c) => c.type !== 'text');
  if (text) return { id, label: text, icon: title ? 'heading' : other ? TYPE_ICON[other.type] ?? 'text' : 'text' };
  if (other) return { id, label: TYPE_NAME[other.type] ?? other.type, icon: TYPE_ICON[other.type] ?? 'block' };
  return { id, label: '빈 상자', icon: 'text' };
}

export function noteOutline(engine: Engine): { rows: OutlineRow[]; more: number } {
  const cover = new Set(coverItems(engine).blocks);
  const blocks = readingOrder([...engine.blocks()].filter((b) => !cover.has(b.id) && !b.draft));
  const rows: OutlineRow[] = [];
  const groupRow = new Map<string, Extract<OutlineRow, { kind: 'block' }>>();
  let n = 0, more = 0;
  for (const b of blocks) {
    if (n >= OUTLINE_MAX) { more++; continue; }
    const item = boxItem(b.id, engine.contentsOf(b.id));
    n++;
    if (!b.group) { rows.push({ kind: 'box', ...item }); continue; }
    let g = groupRow.get(b.group);
    if (!g) {
      g = { kind: 'block', id: b.group, name: groupName(engine, b.group), items: [] }; groupRow.set(b.group, g); rows.push(g);
      if (item.label === g.name) continue; // 이름을 따온 첫 제목 상자는 블록 줄과 겹치므로 한 번만 (누르면 블록 줄로 그 자리에)
    }
    g.items.push(item);
  }
  return { rows, more };
}
