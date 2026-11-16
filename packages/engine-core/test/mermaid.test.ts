// 머메이드 순서도 ↔ 캔버스 도식 (GAP #18): 읽기(모양 · 선 · 라벨 · 이어 쓰기 · & · subgraph · 주석) · 층 배치 · 넣기(실행 취소 한 번) · 글로 쓰기 왕복
import { describe, expect, it } from 'vitest';
import { diagramToMermaid, Engine, insertMermaid, layoutMermaid, mermaidOfBlock, parseMermaid, textLines, type TxResult } from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const SRC = `flowchart TD
  %% 주문 처리
  A([시작]) --> B{"재고 있음?"}
  B -->|예| C[포장]
  B -- 아니요 --> D[주문 취소]
  C & D --> E((끝))
  C -.-> F[알림]:::note
  subgraph 창고 [창고 일]
    H[검수] --> G[[입고]]
    G ==> C
  end
  classDef note fill:#eee`;

describe('머메이드 읽기', () => {
  it('노드 모양 · 이름 · 선 종류 · 라벨 · & · subgraph', () => {
    const g = parseMermaid(SRC)!;
    expect(g.dir).toBe('TD');
    expect(g.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ['A', '시작', 'stadium'], ['B', '재고 있음?', 'diamond'], ['C', '포장', 'rect'], ['D', '주문 취소', 'rect'], ['E', '끝', 'circle'], ['F', '알림', 'rect'], ['H', '검수', 'rect'], ['G', '입고', 'subroutine'],
    ]);
    expect(g.edges.map((e) => `${e.from}${e.line === 'dotted' ? '-.' : e.line === 'thick' ? '==' : '--'}${e.head ? '>' : '-'}${e.to}${e.label ? `:${e.label}` : ''}`)).toEqual([
      'A-->B', 'B-->C:예', 'B-->D:아니요', 'C-->E', 'D-->E', 'C-.>F', 'H-->G', 'G==>C',
    ]);
    expect(g.groups).toEqual([{ title: '창고 일', nodes: ['H', 'G'] }]);
  });

  it('flowchart가 아니면 null · 방향 LR · 이어 쓰기 · 머리 없는 선 · 양방향', () => {
    expect(parseMermaid('sequenceDiagram\n A->>B: hi')).toBeNull();
    const g = parseMermaid('graph LR; a --> b --> c; c --- d; d <--> a')!;
    expect(g.dir).toBe('LR');
    expect(g.edges.map((e) => [e.from, e.to, e.head, !!e.both])).toEqual([['a', 'b', true, false], ['b', 'c', true, false], ['c', 'd', false, false], ['d', 'a', true, true]]);
  });
});

describe('층 배치', () => {
  it('TD: 앞 층이 위, 같은 층은 겹치지 않음 · 고리가 있어도 끝남', () => {
    const g = parseMermaid('flowchart TD\n a-->b\n a-->c\n b-->d\n c-->d\n d-->a')!;
    const r = layoutMermaid(g);
    expect(r[0]!.y).toBeLessThan(r[1]!.y);
    expect(r[1]!.y).toBe(r[2]!.y);
    expect(r[1]!.x + r[1]!.w <= r[2]!.x || r[2]!.x + r[2]!.w <= r[1]!.x).toBe(true);
    expect(r[3]!.y).toBeGreaterThan(r[1]!.y);
  });
  it('LR: 앞 층이 왼쪽', () => {
    const r = layoutMermaid(parseMermaid('flowchart LR\n a-->b')!);
    expect(r[0]!.x + r[0]!.w).toBeLessThan(r[1]!.x);
    expect(r[0]!.y).toBe(r[1]!.y);
  });
});

describe('넣기 · 글로 쓰기', () => {
  it('코드 블록 → 그 아래 상자 · 화살표 · 묶음, 실행 취소 한 번', () => {
    const e = new Engine();
    const src = val(e.transact((tx) => {
      const b = tx.createBlock({ x: 0, y: 0, w: 400, h: 200 });
      tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'code_block', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: SRC }] }] } });
      return b;
    }, { origin: 'user' }));
    const code = mermaidOfBlock(e, src)!;
    expect(code).toContain('flowchart TD');
    const ids = val(insertMermaid(e, src, code));
    expect(ids).toHaveLength(8);
    expect([...e.arrows()]).toHaveLength(8);
    const all = [...e.blocks()];
    expect(all.filter((b) => b.id !== src).every((b) => b.y >= 216)).toBe(true);
    expect(all.filter((b) => b.group)).toHaveLength(2);
    expect(e.getBlock(ids[1]!)?.nodeKind).toBe('decision');
    const dotted = [...e.arrows()].find((a) => a.style?.line === 'dotted');
    expect(dotted && textLines(e.contentsOf(dotted.to.blockId!)[0]!.doc as never)).toEqual(['알림']);
    e.undo();
    expect(e.blockCount).toBe(1);
    expect(insertMermaid(e, src, 'pie\n "a": 1').ok).toBe(false);
  });

  it('상자 · 화살표 → flowchart 글 → 다시 읽으면 같은 이름 · 선 · 묶음', () => {
    const e = new Engine();
    const ids = val(insertMermaid(e, null, SRC));
    const text = diagramToMermaid(e, ids);
    expect(text.startsWith('flowchart ')).toBe(true);
    const g = parseMermaid(text)!;
    expect(g.nodes.map((n) => n.label).sort()).toEqual(['끝', '알림', '입고', '검수', '재고 있음?', '시작', '주문 취소', '포장'].sort());
    expect(g.nodes.find((n) => n.label === '재고 있음?')!.shape).toBe('diamond');
    expect(g.edges).toHaveLength(8);
    expect(g.edges.filter((e2) => e2.label).map((e2) => e2.label).sort()).toEqual(['아니요', '예']);
    expect(g.edges.filter((e2) => e2.line === 'dotted')).toHaveLength(1);
    expect(g.groups.map((x) => [x.title, x.nodes.length])).toEqual([['창고 일', 2]]);
  });
});
