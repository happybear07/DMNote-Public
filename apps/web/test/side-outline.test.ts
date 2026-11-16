// 사이드바 '이 노트' 나무 (11/09): 블록(묶음) ▸ 콘텐츠, 묶이지 않은 상자는 한 줄 · 읽는 순서 · 이름을 따온 제목은 한 번만 · 표지 · 빈 초안 빼기
import { describe, expect, it } from 'vitest';
import { addCoverPage, Engine, type Id, type TextDoc } from '@dn/engine-core';
import { noteOutline, OUTLINE_MAX } from '../src/side-outline';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;

function note(build: (mk: (x: number, y: number, text: string, o?: { group?: string; role?: 'title' | 'body'; draft?: boolean }) => Id) => void) {
  const e = new Engine();
  e.transact((tx) => build((x, y, text, o = {}) => {
    const b = tx.createBlock({ x, y, w: 200, h: 50, ...(o.group ? { group: o.group } : {}), ...(o.draft ? { draft: true } : {}) });
    tx.createContent({ blockId: b, type: 'text', role: o.role ?? 'body', doc: doc(text) });
    return b;
  }), { origin: 'user' });
  return e;
}

describe('noteOutline', () => {
  it('묶음은 블록 줄 아래 콘텐츠로, 따로 있는 상자는 한 줄 — 읽는 순서', () => {
    const e = note((mk) => {
      mk(0, 400, '맨 아래 메모');
      mk(0, 0, '회의', { group: 'g1', role: 'title' });
      mk(0, 70, '안건 하나', { group: 'g1' });
      mk(0, 140, '안건 둘', { group: 'g1' });
    });
    const { rows } = noteOutline(e);
    expect(rows.map((r) => r.kind)).toEqual(['block', 'box']);
    const g = rows[0]!;
    if (g.kind !== 'block') throw new Error('block');
    expect(g.name).toBe('회의');
    expect(g.items.map((i) => i.label)).toEqual(['안건 하나', '안건 둘']); // 이름을 따온 제목 상자는 블록 줄과 겹쳐 한 번만
    expect(rows[1]).toMatchObject({ kind: 'box', label: '맨 아래 메모', icon: 'text' });
  });

  it('표지 안 상자와 아직 빈 초안 상자는 뺀다', () => {
    const e = note((mk) => { mk(40, 40, '본문'); mk(40, 200, '', { draft: true }); });
    const cover = addCoverPage(e);
    if (!cover.ok) throw new Error(cover.reason);
    e.transact((tx) => { const b = tx.createBlock({ x: cover.value.x + 40, y: cover.value.y + 40, w: 200, h: 50 }); tx.createContent({ blockId: b, type: 'text', role: 'body', doc: doc('표지 글') }); }, { origin: 'user' });
    expect(noteOutline(e).rows.map((r) => (r.kind === 'box' ? r.label : r.name))).toEqual(['본문']);
  });

  it('너무 많으면 앞의 OUTLINE_MAX개만 · 나머지는 개수로', () => {
    const e = note((mk) => { for (let i = 0; i < OUTLINE_MAX + 5; i++) mk(0, i * 60, `상자 ${i}`); });
    const { rows, more } = noteOutline(e);
    expect(rows).toHaveLength(OUTLINE_MAX);
    expect(more).toBe(5);
  });
});
