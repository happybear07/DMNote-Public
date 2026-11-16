// 여러 칸에 걸친 고르기: 단위 ↔ 문서 위치 왕복, 지우기 = a 앞부분 + b 뒷부분 (제목이면 b의 첫 줄만 붙이고 나머지는 b에)
import { describe, expect, it } from 'vitest';
import type { TextDoc } from '@dn/engine-core';
import { Step } from 'prosemirror-transform';
import { crossDeleteSteps, deleteRangeSteps, posAtUnits, unitsAtPos } from '../src/cross';
import { toJSON, toNode } from '../src/codec';
import { schema } from '../src/schema';

const p = (text?: string) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });
const doc = (...content: object[]) => ({ type: 'doc', content }) as TextDoc;
const apply = (d: TextDoc, steps: unknown[]) => toJSON(steps.reduce<ReturnType<typeof toNode>>((n, s) => Step.fromJSON(schema, s).apply(n).doc!, toNode(d)));
const text = (d: TextDoc) => toNode(d).content.content.map((n) => n.textContent);

describe('단위 ↔ 위치', () => {
  it('글자 · 문단 시작 · 원자를 같은 수로 세어 왕복한다', () => {
    const d = doc(p('가나다'), { type: 'paragraph', content: [{ type: 'text', text: 'x' }, { type: 'math_inline', attrs: { tex: 'a^2' } }, { type: 'text', text: 'yz' }] }, p());
    const n = toNode(d);
    for (let pos = 1; pos < n.content.size; pos++) {
      const $p = n.resolve(pos);
      if (!$p.parent.isTextblock) continue;
      expect(posAtUnits(d, unitsAtPos(d, pos))).toBe(pos);
    }
  });
});

describe('지우기', () => {
  it('본문: a의 "가|나다" ~ b의 "라마|바" → "가바", b는 지움', () => {
    const a = doc(p('가나다'), p('둘째')), b = doc(p('첫'), p('라마바'));
    const r = crossDeleteSteps(a, 2, b, 6, false);
    expect(text(apply(a, r.aSteps))).toEqual(['가바']);
    expect(r.bSteps).toBeNull();
  });
  it('제목: b의 첫 줄 남은 글만 붙이고 다음 줄은 b에 남긴다', () => {
    const a = doc(p('제목글')), b = doc(p('하나둘'), p('셋째 줄'));
    const r = crossDeleteSteps(a, 3, b, 3, true);
    expect(text(apply(a, r.aSteps))).toEqual(['제목둘']);
    expect(text(apply(b, r.bSteps!))).toEqual(['셋째 줄']);
  });
  it('같은 칸 안 범위', () => {
    const d = doc(p('가나다라'));
    expect(text(apply(d, deleteRangeSteps(d, 2, 4)))).toEqual(['가라']);
  });
});
