// 녹음 받아쓰기 (FR-044): 조용한 곳에서 30초 안쪽으로 자르기 · 거의 조용한 구간 빼기 · 구간 → 문단(재생 시각 칩) · 내보내기 · 엔진에 넣기
import { beforeAll, describe, expect, it } from 'vitest';
import { createTextBlock, Engine, insertTextBelow, setDefaultTextCodec, type TextNode } from '@dn/engine-core';
import { docToMarkdown, mediaClock } from '@dn/text-pm';
import { pmCodec } from '@dn/text-pm/headless';
import { cutWindows, segmentsToDoc, STT_RATE } from '../src/stt';

beforeAll(() => setDefaultTextCodec(pmCodec));

/** 소리(0.3) · 쉼(0) 구간을 이어 붙인 가짜 녹음 — [초, 소리?][] */
const tone = (parts: [number, boolean][]) => {
  const out = new Float32Array(Math.round(parts.reduce((s, [sec]) => s + sec, 0) * STT_RATE));
  let at = 0;
  for (const [sec, on] of parts) { const n = Math.round(sec * STT_RATE); if (on) for (let i = 0; i < n; i++) out[at + i] = 0.3 * Math.sin(i / 8); at += n; }
  return out;
};

describe('cutWindows — 받아쓸 구간', () => {
  it('28초 안쪽, 끝은 마지막 3초 안의 쉬는 곳 · 구간이 빈틈없이 이어짐', () => {
    const a = tone([[26, true], [1, false], [20, true]]); // 26초에서 쉼
    const w = cutWindows(a);
    expect(w.length).toBe(2);
    expect(w[0]![0]).toBe(0);
    expect(w[0]![1] / STT_RATE).toBeGreaterThan(26);
    expect(w[0]![1] / STT_RATE).toBeLessThanOrEqual(27);
    expect(w[1]![0]).toBe(w[0]![1]);
    expect(w[1]![1]).toBe(a.length);
    for (const [s, e] of w) expect((e - s) / STT_RATE).toBeLessThanOrEqual(28);
  });
  it('거의 조용한 구간은 뺀다 (무음에 지어낸 말이 붙지 않게) · 아주 짧은 꼬리도 뺀다', () => {
    const a = tone([[10, true], [40, false], [5, true]]);
    const w = cutWindows(a);
    expect(w.every(([s, e]) => e - s >= STT_RATE / 4)).toBe(true);
    const covered = w.reduce((s, [x, y]) => s + (y - x), 0) / STT_RATE;
    expect(covered).toBeLessThan(40); // 40초 쉼의 대부분은 빠짐
    expect(cutWindows(new Float32Array(STT_RATE * 5))).toEqual([]);
  });
});

describe('segmentsToDoc — 받아쓴 글', () => {
  const segs = [
    { start: 0.4, end: 3, text: ' 회의를 시작하겠습니다.' },
    { start: 3.2, end: 6, text: ' 첫 안건은 예산입니다.' },
    { start: 6.1, end: 7, text: ' 첫 안건은 예산입니다.' }, // 바로 앞과 같은 말 — 버림
    { start: 9.5, end: 12, text: ' 다음은 일정 이야기예요. OK?' },
  ];
  it('맨 위 제목3, 쉼 1.5초 이상이면 새 문단, 문단 앞에 재생 시각 칩(내림 초) · 녹음 콘텐츠 id', () => {
    const d = segmentsToDoc(segs, 'rec-1', '받아쓴 글 — 회의');
    expect(d.content[0]).toMatchObject({ type: 'heading', attrs: { level: 3 } });
    const paras = d.content.slice(1) as TextNode[];
    expect(paras.length).toBe(2);
    expect(paras[0]!.content![0]).toEqual({ type: 'media_time', attrs: { t: 0, ref: 'rec-1' } });
    expect(paras[0]!.content![1]!.text).toBe(' 회의를 시작하겠습니다. 첫 안건은 예산입니다.');
    expect(paras[1]!.content![0]!.attrs).toEqual({ t: 9, ref: 'rec-1' });
    expect(pmCodec.validate(d)).toBeNull();
  });
  it('알아들을 말이 없으면 그렇게 적는다', () => {
    const d = segmentsToDoc([{ start: 0, end: 1, text: '  ' }], 'r', '받아쓴 글');
    expect(JSON.stringify(d)).toContain('알아들을 말이 없었어요');
  });
  it('Markdown은 [분:초] · 1시간 넘으면 시:분:초', () => {
    expect(docToMarkdown(segmentsToDoc(segs, 'r', '받아쓴 글'))).toContain('[0:09] 다음은 일정 이야기예요.');
    expect(mediaClock(3725.9)).toBe('1:02:05');
    expect(mediaClock(65)).toBe('1:05');
  });
});

describe('insertTextBelow — 녹음 블록 바로 아래', () => {
  it('끝없는 캔버스: 아무것도 옮기지 않고 바로 아래(폭 480 이상) · 실행 취소 한 번', () => {
    const e = new Engine();
    const rec = createTextBlock(e, { x: 40, y: 40 }, { w: 300, h: 60 }).value!.blockId;
    const other = createTextBlock(e, { x: 40, y: 116 }, { w: 300, h: 60 }).value!.blockId; // 바로 아래가 막힘
    const r = insertTextBelow(e, rec, segmentsToDoc([{ start: 0, end: 1, text: '안녕' }], 'c', '받아쓴 글'), () => 80);
    expect(r.ok).toBe(true);
    const b = e.getBlock(r.ok ? r.value.blockId : '')!;
    expect(b.w).toBeGreaterThanOrEqual(480);
    expect(e.getBlock(other)!.y).toBe(116);
    const o = e.getBlock(other)!;
    expect(b.x >= o.x + o.w || b.x + b.w <= o.x || b.y >= o.y + o.h || b.y + b.h <= o.y).toBe(true); // 겹치지 않음
    e.undo();
    expect([...e.blocks()].length).toBe(2);
  });
});
