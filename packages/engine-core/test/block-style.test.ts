// 블록 글자 모양: 크기 배율 단계 · 기본값은 지워서 저장 · 여러 블록 한 번에 · 배경색과 서로 지우지 않음
import { describe, expect, it } from 'vitest';
import { createTextBlock, Engine, setBlockColor, setBlockTextStyle, stepFontScale } from '../src';

describe('블록 글자 모양', () => {
  it('한 칸씩 키우기는 블록마다 제 크기에서', () => {
    const e = new Engine();
    const a = createTextBlock(e, { x: 0, y: 0 }), b = createTextBlock(e, { x: 0, y: 200 });
    if (!a.ok || !b.ok) throw new Error('setup');
    setBlockTextStyle(e, [b.value.blockId], { fontScale: 2.5 });
    setBlockTextStyle(e, [a.value.blockId, b.value.blockId], { fontStep: 1 });
    expect([e.getBlock(a.value.blockId)!.fontScale, e.getBlock(b.value.blockId)!.fontScale]).toEqual([1.15, 3]);
  });

  it('크기 한 칸씩 (끝에서 멈춤)', () => {
    expect(stepFontScale(undefined, 1)).toBe(1.15);
    expect(stepFontScale(1, -1)).toBe(0.875);
    expect(stepFontScale(3, 1)).toBe(3);
    expect(stepFontScale(0.75, -1)).toBe(0.75);
    expect(stepFontScale(1.2, 1)).toBe(1.3); // 단계 사이 값이면 다음 단계로
  });

  it('여러 블록 한 번에 · 기본값은 지움 · 배경색과 따로 · 실행 취소 한 번', () => {
    const e = new Engine();
    const a = createTextBlock(e, { x: 0, y: 0 }), b = createTextBlock(e, { x: 0, y: 200 });
    if (!a.ok || !b.ok) throw new Error('setup');
    const ids = [a.value.blockId, b.value.blockId];
    expect(setBlockTextStyle(e, ids, { fontScale: 1.5, textColor: 'blue', align: 'center' }).ok).toBe(true);
    const look = (i: number) => { const b = e.getBlock(ids[i]!)!; return { fontScale: b.fontScale, textColor: b.textColor, align: b.align }; };
    expect(look(1)).toEqual({ fontScale: 1.5, textColor: 'blue', align: 'center' });
    setBlockColor(e, ids, 'yellow');
    setBlockColor(e, ids, undefined);
    expect(look(0)).toEqual({ fontScale: 1.5, textColor: 'blue', align: 'center' });
    setBlockTextStyle(e, ids, { fontScale: 1, textColor: null, align: 'left' });
    expect(look(0)).toEqual({ fontScale: undefined, textColor: undefined, align: undefined });
    e.undo();
    expect(look(0)).toEqual({ fontScale: 1.5, textColor: 'blue', align: 'center' });
    setBlockTextStyle(e, ids, { textColor: 'nope' as string });
    expect(e.getBlock(ids[0]!)!.textColor).toBeUndefined();
  });
});

describe('줄 간격 · 들여쓰기', () => {
  it('줄 간격 1(기본) · null은 지우고, 들여쓰기는 0~8 한 단계씩', () => {
    const e = new Engine();
    const a = createTextBlock(e, { x: 0, y: 0 });
    if (!a.ok) throw new Error('setup');
    const id = a.value.blockId, b = () => e.getBlock(id)!;
    setBlockTextStyle(e, [id], { lineHeight: 1.5 });
    expect(b().lineHeight).toBe(1.5);
    setBlockTextStyle(e, [id], { lineHeight: 1 });
    expect(b().lineHeight).toBeUndefined();
    setBlockTextStyle(e, [id], { indentStep: -1 });
    expect(b().indent).toBeUndefined();
    for (let i = 0; i < 10; i++) setBlockTextStyle(e, [id], { indentStep: 1 });
    expect(b().indent).toBe(8);
    for (let i = 0; i < 8; i++) setBlockTextStyle(e, [id], { indentStep: -1 });
    expect(b().indent).toBeUndefined();
  });
});

describe('글자 색 — 팔레트 · 직접 고른 색 (#rrggbb)', () => {
  it('normalizeTextColor: 이름 · #rgb · #RRGGBB는 받고 나머지는 버린다', async () => {
    const { normalizeTextColor } = await import('../src');
    expect(normalizeTextColor('blue')).toBe('blue');
    expect(normalizeTextColor('#3366FF')).toBe('#3366ff');
    expect(normalizeTextColor('#36f')).toBe('#3366ff');
    for (const bad of ['navy', '#12345', 'rgb(0,0,0)', 'url(x)', '', null, undefined]) expect(normalizeTextColor(bad as string)).toBeUndefined();
  });
  it('setBlockTextStyle: 직접 고른 색을 저장하고, 이상한 값이면 지운다', async () => {
    const { normalizeTextColor: _n, setBlockTextStyle: set, createTextBlock: mk, Engine: E } = await import('../src');
    void _n;
    const e = new E();
    const r = mk(e, { x: 0, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    const id = r.value.blockId;
    expect(set(e, [id], { textColor: '#AbC' }).ok).toBe(true);
    expect(e.getBlock(id)!.textColor).toBe('#aabbcc');
    set(e, [id], { textColor: 'javascript:alert(1)' });
    expect(e.getBlock(id)!.textColor).toBeUndefined();
  });
});

describe('글꼴 (명조 · 고정폭)', () => {
  it('상자 글꼴을 걸고 기본으로 되돌리면 필드가 없어진다 · 모르는 값은 기본', () => {
    const e = new Engine();
    const r = createTextBlock(e, { x: 0, y: 0 }, { title: '글꼴' });
    if (!r.ok) throw new Error('setup');
    const id = r.value.blockId;
    setBlockTextStyle(e, [id], { fontFamily: 'serif' });
    expect(e.getBlock(id)!.fontFamily).toBe('serif');
    setBlockTextStyle(e, [id], { fontFamily: 'cursive' as never });
    expect(e.getBlock(id)!.fontFamily).toBeUndefined();
    setBlockTextStyle(e, [id], { fontFamily: 'mono' });
    setBlockTextStyle(e, [id], { fontFamily: null });
    expect('fontFamily' in e.getBlock(id)!).toBe(false);
  });
});

describe('첫 줄 · 문단 간격 (워드)', () => {
  it('첫 줄 들여쓰기 · 내어쓰기 · 앞뒤 간격 — 0 · null이면 지우고, 범위 밖은 자른다', () => {
    const e = new Engine();
    const r = createTextBlock(e, { x: 0, y: 0 }, { title: '문단' });
    if (!r.ok) throw new Error('setup');
    const id = r.value.blockId;
    setBlockTextStyle(e, [id], { firstLine: 2, spaceBefore: 12, spaceAfter: 6 });
    expect(e.getBlock(id)).toMatchObject({ firstLine: 2, spaceBefore: 12, spaceAfter: 6 });
    setBlockTextStyle(e, [id], { firstLine: -9, spaceBefore: 500 });
    expect(e.getBlock(id)).toMatchObject({ firstLine: -4, spaceBefore: 72 });
    setBlockTextStyle(e, [id], { firstLine: 0, spaceBefore: null, spaceAfter: 0 });
    const b = e.getBlock(id)!;
    expect(['firstLine', 'spaceBefore', 'spaceAfter'].filter((k) => k in b)).toEqual([]);
  });
});
