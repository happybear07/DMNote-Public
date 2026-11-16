// 잉크 (FR-034 · 036): 점열 인코딩 무손실 · 판정 · 올가미 포함 규칙 · 커맨드와 실행 취소 · 직렬화 왕복
import { describe, expect, it } from 'vitest';
import {
  addStroke, bindStrokes, clearCanvas, clearTargets, createTextBlock, decodePoints, deleteStrokes, deserialize, encodePoints, Engine, freeStrokes, isStroke,
  lassoStrokes, moveStrokes, recolorStrokes, scaleStrokes, serialize, strokeBounds, strokeHit, type Stroke,
} from '../src';

const line = (x0: number, y0: number, x1: number, y1: number, n = 10) => {
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) pts.push(x0 + ((x1 - x0) * i) / n - x0, y0 + ((y1 - y0) * i) / n - y0, 0.5 + i / (n * 4), i * 8);
  return { origin: { x: x0, y: y0 }, points: pts };
};

describe('점열 인코딩', () => {
  it('1/64 px · 필압 10bit · 시간 ms 무손실 왕복 (음수 · 큰 값 포함)', () => {
    const pts = [0, 0, 0, 0, 12.5, -3.25, 0.5, 8, -1000.015625, 20000.5, 1, 16, 7.03125, 7.03125, 0.25, 4000];
    const back = decodePoints(encodePoints(pts));
    expect([...back].map((v, i) => (i % 4 === 2 ? Math.round(v * 1023) : v))).toEqual(
      pts.map((v, i) => (i % 4 === 2 ? Math.round(v * 1023) : i % 4 === 3 ? v : Math.round(v * 64) / 64)));
  });
  it('점당 몇 바이트 (델타 · varint)', () => {
    const l = line(0, 0, 300, 120, 200);
    const enc = encodePoints(l.points);
    expect((enc.length * 3) / 4 / 201).toBeLessThan(8);
  });
});

describe('잉크 커맨드', () => {
  const setup = () => {
    const e = new Engine();
    const a = addStroke(e, { tool: 'pen', color: '#000', width: 2, ...line(0, 0, 100, 0) });
    const b = addStroke(e, { tool: 'highlighter', color: '#ff0', width: 12, ...line(0, 200, 100, 300) });
    return { e, a: a.ok ? a.value : '', b: b.ok ? b.value : '' };
  };

  it('만들기 · 경계 · 지우개 판정', () => {
    const { e, a } = setup();
    const s = e.getStroke(a) as Stroke;
    expect(isStroke(s) && s.parent.kind === 'layer').toBe(true);
    const r = strokeBounds(s);
    expect(r.x).toBeLessThan(0); expect(r.w).toBeGreaterThan(100);
    expect(strokeHit(s, { x: 50, y: 3 }, 2)).toBe(true);
    expect(strokeHit(s, { x: 50, y: 20 }, 2)).toBe(false);
  });

  it('올가미: 점의 절반 이상이 안에 있으면 선택', () => {
    const { e, a, b } = setup();
    const box = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    expect(lassoStrokes(e, box(-10, -10, 110, 10))).toEqual([a]);
    expect(lassoStrokes(e, box(-10, -10, 60, 10))).toEqual([a]); // 6/11 안
    expect(lassoStrokes(e, box(-10, -10, 30, 10))).toEqual([]); // 4/11 안
    expect(lassoStrokes(e, box(-10, -10, 200, 400)).sort()).toEqual([a, b].sort());
  });

  it('이동 · 크기 · 색 · 지우기 — 각각 실행 취소 한 번', () => {
    const { e, a, b } = setup();
    moveStrokes(e, [a, b], 10.3, -5);
    expect((e.getStroke(a) as Stroke).origin).toEqual({ x: Math.round(10.3 * 64) / 64, y: -5 });
    e.undo();
    expect((e.getStroke(a) as Stroke).origin).toEqual({ x: 0, y: 0 });
    scaleStrokes(e, [a], 2, { x: 0, y: 0 });
    expect((e.getStroke(a) as Stroke).scale).toBe(2);
    expect(strokeHit(e.getStroke(a) as Stroke, { x: 190, y: 0 }, 2)).toBe(true);
    recolorStrokes(e, [a, b], '#f00');
    expect((e.getStroke(b) as Stroke).color).toBe('#f00');
    deleteStrokes(e, [a]);
    expect(freeStrokes(e).map((s) => s.id)).toEqual([b]);
    e.undo(); e.undo(); e.undo();
    expect((e.getStroke(a) as Stroke).scale).toBe(1);
    expect((e.getStroke(b) as Stroke).color).toBe('#ff0');
  });

  it('직렬화 왕복', () => {
    const { e, a } = setup();
    const r = deserialize(serialize(e));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = new Engine(r.data);
    expect(back.getStroke(a)).toEqual(e.getStroke(a));
  });
});

describe('펜 · 형광펜 종류 (10/30)', () => {
  it('고른 종류를 획에 저장 — 기본(볼펜 · 납작 촉)은 비워 둠, 펜 종류는 펜에만 · 형광펜 종류는 형광펜에만, 저장 왕복', () => {
    const e = new Engine();
    const ok = <T,>(r: { ok: boolean; value?: T }) => r.value as T;
    const pencil = ok<string>(addStroke(e, { tool: 'pen', color: '#000', width: 2.5, pen: 'pencil', hl: 'round', ...line(0, 0, 50, 0) }));
    const ball = ok<string>(addStroke(e, { tool: 'pen', color: '#000', width: 3, pen: 'ball', ...line(0, 10, 50, 10) }));
    const round = ok<string>(addStroke(e, { tool: 'highlighter', color: '#ffe066', width: 18, hl: 'round', pen: 'brush', ...line(0, 20, 50, 20) }));
    const chisel = ok<string>(addStroke(e, { tool: 'highlighter', color: '#ffe066', width: 18, hl: 'chisel', ...line(0, 30, 50, 30) }));
    const g = (id: string) => e.getStroke(id) as Stroke;
    expect([g(pencil).pen, g(pencil).hl, g(pencil).width]).toEqual(['pencil', undefined, 2.5]);
    expect('pen' in g(ball)).toBe(false);
    expect([g(round).hl, g(round).pen]).toEqual(['round', undefined]);
    expect('hl' in g(chisel)).toBe(false);
    const r = deserialize(serialize(e));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = new Engine(r.data);
    expect((back.getStroke(pencil) as Stroke).pen).toBe('pencil');
    expect((back.getStroke(round) as Stroke).hl).toBe('round');
  });
});

describe('지우개 막대 지우기 (알파 10/31)', () => {
  // 자유 필기 하나 · 손글씨만 든 상자 하나 · 글 상자에 묶인 손글씨 하나 · 화살표 하나
  const setup = () => {
    const e = new Engine();
    const v = <T,>(r: { ok: boolean; value?: T | null }) => r.value as T;
    v<string>(addStroke(e, { tool: 'pen', color: '#000', width: 2, ...line(0, 0, 100, 0) }));
    const inkOnly = v<string>(addStroke(e, { tool: 'pen', color: '#000', width: 2, ...line(1000, 1000, 1100, 1000) }));
    const inkBlock = v<string>(bindStrokes(e, [inkOnly]));
    const text = v<{ blockId: string }>(createTextBlock(e, { x: 500, y: 500 }, { body: '글 상자' })).blockId;
    const onText = v<string>(addStroke(e, { tool: 'pen', color: '#f00', width: 2, ...line(510, 510, 560, 520) }));
    v(bindStrokes(e, [onText]));
    e.transact((tx) => tx.createArrow({ from: { blockId: text, side: 'auto' }, to: { blockId: inkBlock, side: 'auto' } }), { origin: 'user' });
    return { e, inkBlock, text };
  };

  // 되살린 순서는 달라도 된다 — id 순으로 맞춰 비교
  const dump = (e: Engine) => JSON.stringify([[...e.blocks()], [...e.contents()], [...e.strokes()], [...e.arrows()]].map((xs) => [...xs].sort((a, b) => (a.id < b.id ? -1 : 1))));

  it('필기만: 모든 획 · 잉크 콘텐츠 · 손글씨만 든 상자(와 그 화살표)를 지우고 글 상자는 글만 남긴다 — 실행 취소 한 번', () => {
    const { e, inkBlock, text } = setup();
    const before = dump(e);
    expect(clearTargets(e, 'ink')).toEqual({ blocks: [inkBlock], strokes: expect.any(Array) });
    expect(clearCanvas(e, 'ink').ok).toBe(true);
    expect([...e.strokes()].length).toBe(0);
    expect(e.getBlock(inkBlock)).toBeUndefined();
    expect(e.contentsOf(text).map((c) => c.type)).toEqual(['text']);
    expect([...e.arrows()].length).toBe(0);
    expect(e.undo()).toBe(true);
    expect(dump(e)).toBe(before);
  });

  it('모두: 상자 · 화살표 · 필기 전부 — 실행 취소 한 번에 되살림', () => {
    const { e } = setup();
    const n = [e.blockCount, [...e.strokes()].length];
    expect(clearCanvas(e, 'all').ok).toBe(true);
    expect([e.blockCount, [...e.contents()].length, [...e.strokes()].length, [...e.arrows()].length]).toEqual([0, 0, 0, 0]);
    e.undo();
    expect([e.blockCount, [...e.strokes()].length]).toEqual(n);
  });
});
