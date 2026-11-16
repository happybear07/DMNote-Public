// 합성 노트 생성기 (FR-008 "100/1,000/10,000 합성 노트 생성기 (혼합 비율 지정)", ENGINE 14.1 · 18절 "생성기 단위 테스트 (결정성)").
import { describe, expect, it } from 'vitest';
import { synthNote } from '../../../bench/synth';
import { deserialize, Engine, isId, isOrderKey, serialize, docText, type TextContent } from '../src';

describe('합성 노트 생성기 (FR-008)', () => {
  it('같은 시드는 같은 노트, 다른 시드는 다른 노트', () => {
    expect(JSON.stringify(synthNote({ blocks: 300, seed: 9 }))).toBe(JSON.stringify(synthNote({ blocks: 300, seed: 9 })));
    expect(JSON.stringify(synthNote({ blocks: 300, seed: 9 }))).not.toBe(JSON.stringify(synthNote({ blocks: 300, seed: 10 })));
  });

  it.each([100, 1000])('블록 %i개: 혼합 비율 · 텍스트 길이 · 유효한 스냅샷', (n) => {
    const s = synthNote({ blocks: n, seed: 3 });
    const blocks = Object.values(s.blocks), contents = Object.values(s.contents);
    expect(blocks).toHaveLength(n);
    expect(Object.keys(s.arrows)).toHaveLength(n / 2);
    expect(Object.keys(s.strokes)).toHaveLength(n);
    // 블록당 텍스트 상자 하나 (약 20% 제목 상자), 내용 상자 평균 200자 안팎
    expect(contents).toHaveLength(n);
    const titles = contents.filter((c) => (c as TextContent).role === 'title').length / n;
    expect(titles).toBeGreaterThan(0.1);
    expect(titles).toBeLessThan(0.3);
    const chars = contents.filter((c) => (c as TextContent).role === 'body').map((c) => docText((c as TextContent).doc).length);
    const avg = chars.reduce((a, b) => a + b, 0) / chars.length;
    expect(avg).toBeGreaterThan(150);
    expect(avg).toBeLessThan(260);
    for (const b of blocks) expect(isId(b.id) && isOrderKey(b.z) && b.w >= 24 && b.h >= 24).toBe(true);

    const r = deserialize(JSON.parse(JSON.stringify(s)));
    if (!r.ok) throw new Error(JSON.stringify(r));
    const e = new Engine(r.data);
    expect(e.blockCount).toBe(n);
    expect(serialize(e)).toEqual(s); // 무손실 왕복 (생성기 출력이 이미 정렬된 정규형)
  });

  it('비율 · 분포는 인자로 바꾼다', () => {
    const s = synthNote({ blocks: 200, seed: 1, arrowRatio: 0, strokeRatio: 0.25, dist: 'uniform' });
    expect(Object.keys(s.arrows)).toHaveLength(0);
    expect(Object.keys(s.strokes)).toHaveLength(50);
  });
});
