import { describe, expect, it } from 'vitest';
import { createTextBlock, Engine, makeTable } from '@dn/engine-core';
import { extractSearchDoc, SearchIndex, snippet, terms } from '../src';

function note(id: string, texts: string[]): Engine {
  const e = new Engine({ note: { id, title: '', createdAt: 0, updatedAt: 0 } });
  texts.forEach((t, i) => createTextBlock(e, { x: 0, y: i * 400 }, { body: t }));
  return e;
}

describe('검색 (FR-121)', () => {
  it('블록별 글자를 모으고, 표 데이터 글자도 넣는다', () => {
    const e = note('n1', ['첫 블록 내용']);
    e.transact((tx) => {
      const b = tx.createBlock({ x: 900, y: 0, w: 200, h: 100 });
      tx.createContent({ blockId: b, type: 'table', ...makeTable(['플랜', '가격'], [['기본', '9900원']], '요금 비교') } as never);
    }, { origin: 'user' });
    const d = extractSearchDoc(e, 1);
    expect(d.blocks.map((b) => b.text).sort()).toEqual(['요금 비교\n플랜 · 가격\n기본 · 9900원', '첫 블록 내용']);
  });

  it('모든 낱말이 들어 있는 블록 · 제목 일치 우선 · 목록에 없는 노트(휴지통)는 대상 밖', () => {
    const idx = new SearchIndex();
    idx.put(extractSearchDoc(note('a', ['캔버스 엔진 설계', '렌더러는 DOM']), 1));
    idx.put(extractSearchDoc(note('b', ['엔진 오일 교체']), 2));
    idx.put(extractSearchDoc(note('c', ['캔버스 엔진']), 3));
    const notes = [{ id: 'a', title: '설계 노트', updatedAt: 1 }, { id: 'b', title: '엔진', updatedAt: 2 }];
    expect(idx.query('엔진', notes).map((h) => h.noteId)).toEqual(['b', 'a']);
    expect(idx.query('캔버스 엔진', notes).map((h) => h.noteId)).toEqual(['a']);
    expect(idx.query('캔버스 오일', notes)).toEqual([]);
    expect(idx.query('dom', notes)[0]!.blocks[0]!.snippet).toBe('렌더러는 DOM');
    // 제목에 있는 낱말 + 본문 낱말
    expect(idx.query('설계 렌더러', notes).map((h) => h.noteId)).toEqual(['a']);
  });

  it('문맥 자르기 · 걸린 구간', () => {
    const long = '가'.repeat(50) + '찾는말' + '나'.repeat(50);
    const s = snippet(long, terms('찾는말'));
    expect(s.snippet.startsWith('…') && s.snippet.endsWith('…')).toBe(true);
    const [a, b] = s.ranges[0]!;
    expect(s.snippet.slice(a, b)).toBe('찾는말');
  });
});

describe('백링크 (FR-081)', () => {
  const linked = (id: string, to: string, text: string): Engine => {
    const e = new Engine({ note: { id, title: '', createdAt: 0, updatedAt: 0 } });
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }, { type: 'note_link', attrs: { id: to, title: '대상' } }] }] };
    createTextBlock(e, { x: 0, y: 0 }, { doc: doc as never });
    return e;
  };

  it('블록이 가리키는 노트를 모으고, 대상 노트를 링크한 노트를 최근 수정 순으로', () => {
    const idx = new SearchIndex();
    const a = extractSearchDoc(linked('a', 't', '참고 '), 1);
    expect(a.blocks[0]!.links).toEqual(['t']);
    idx.put(a);
    idx.put(extractSearchDoc(linked('b', 't', '또 참고 '), 2));
    idx.put(extractSearchDoc(linked('c', 'x', '무관 '), 3));
    idx.put(extractSearchDoc(note('t', ['대상 노트']), 4));
    const notes = [{ id: 'a', title: 'A', updatedAt: 1 }, { id: 'b', title: 'B', updatedAt: 2 }, { id: 'c', title: 'C', updatedAt: 3 }, { id: 't', title: 'T', updatedAt: 4 }];
    const bl = idx.backlinks('t', notes);
    expect(bl.map((x) => x.noteId)).toEqual(['b', 'a']);
    expect(bl[1]!.blocks[0]!.text).toBe('참고 대상');
    // 휴지통(목록 밖) 노트는 빠진다
    expect(idx.backlinks('t', notes.filter((n) => n.id !== 'b')).map((x) => x.noteId)).toEqual(['a']);
  });
});

describe('검색 필터 (FR-122)', () => {
  const e = new Engine({ note: { id: 'f', title: '필터 노트', createdAt: 0, updatedAt: 0 } });
  createTextBlock(e, { x: 0, y: 0 }, { body: '그냥 글' });
  createTextBlock(e, { x: 0, y: 400 }, { doc: { type: 'doc', content: [{ type: 'task_list', content: [{ type: 'task_item', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '우유 사기' }] }] }] }] } as never });
  e.transact((tx) => {
    const b = tx.createBlock({ x: 0, y: 800, w: 200, h: 100, ai: { generated: true, runId: 'r1' } } as never);
    tx.createContent({ blockId: b, type: 'table', ...makeTable(['a'], [['1']], '가격표') } as never);
  }, { origin: 'user' });
  const d = extractSearchDoc(e, 1);
  const idx = new SearchIndex();
  idx.put(d);
  const notes = [{ id: 'f', title: '필터 노트', updatedAt: 1 }];

  it('블록 종류 · AI 표시 · 형식 버전', () => {
    expect(d.v).toBe(4);
    expect(d.blocks.map((b) => b.kinds?.join()).sort()).toEqual(['table', 'text', 'text,todo']);
    expect(d.blocks.filter((b) => b.ai).length).toBe(1);
  });

  it('검색어 없이 종류 · AI 조건만으로도 찾고, 검색어와 함께 쓰면 모두 만족', () => {
    expect(idx.query('', notes, 50, { kind: 'todo' })[0]!.blocks[0]!.snippet).toContain('우유');
    expect(idx.query('', notes, 50, { ai: true })[0]!.blockCount).toBe(1);
    expect(idx.query('우유', notes, 50, { kind: 'table' })).toEqual([]);
    expect(idx.query('', notes)).toEqual([]);
    expect(idx.query('', notes, 50, { all: true }).map((h) => h.noteId)).toEqual(['f']);
  });
});
