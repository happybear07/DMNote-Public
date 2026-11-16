// Markdown 내보내기 — 노트형(NS-19): 번호 켠 카드는 '### 번호. 이름', 구분선은 --- (가운데 글이 있으면 보이게), 세로선은 건너뜀
import { describe, expect, it } from 'vitest';
import { createDivider, createTextBlock, Engine, groupBlocks, setGroupMeta } from '@dn/engine-core';
import { noteToMarkdown } from '../src/export';

const meta = { id: 'n', title: '시트', createdAt: 1, updatedAt: 1, schemaVersion: 1 } as const;
const ctx = { noteTitle: () => null };

describe('Markdown 내보내기 — 노트형', () => {
  it('카드 소제목 번호 · 구분선', () => {
    const e = new Engine();
    const box = (y: number, body: string) => createTextBlock(e, { x: 0, y }, { body }).value!.blockId;
    const g1 = groupBlocks(e, [box(0, '소속감'), box(60, '인정')], '핵심 욕구').value!;
    setGroupMeta(e, g1, { bracket: 'card', numbered: true });
    createDivider(e, { x: 0, y: 200 }, 'h', { label: '정리' });
    createDivider(e, { x: 600, y: 0 }, 'v');
    const g2 = groupBlocks(e, [box(300, '거리 두기'), box(360, '확인')]).value!;
    setGroupMeta(e, g2, { bracket: 'card', numbered: true });
    const md = noteToMarkdown(e, meta as never, ctx as never);
    expect(md).toContain('### 1. 핵심 욕구');
    expect(md).toContain('### 2.');
    expect(md).toContain('--- 정리 ---');
    expect(md.indexOf('### 1. 핵심 욕구')).toBeLessThan(md.indexOf('--- 정리 ---'));
  });
});
