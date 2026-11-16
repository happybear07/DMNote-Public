// 다시 구조화할 구간 (FR-110, ai.ts restructureSource): 같은 실행의 AI 상자만 · 원문 출처 구절이 든 문단 · 원문이 없으면 상자 글과 사이 화살표
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, setDefaultTextCodec, type TextDoc } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm/headless';
import { normalizeSource } from '@dn/ai-pipeline';
import { blockText, restructureSource } from '../src/ai';

beforeAll(() => setDefaultTextCodec(pmCodec));

const para = (...ts: string[]): TextDoc => ({ type: 'doc', content: ts.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) });
const SRC = ['첫 문단은 배경입니다.', '금리 인상은 대출 감소로 이어집니다.', '대출 감소는 소비 위축을 낳습니다.', '끝 문단은 결론입니다.'];

function setup() {
  const e = new Engine();
  const ids: Record<string, string> = {};
  e.transact((tx) => {
    ids.src = tx.createBlock({ x: 0, y: 0, w: 400, h: 200 });
    ids.srcC = tx.createContent({ type: 'text', blockId: ids.src, role: 'body', doc: para(...SRC) } as never);
  }, { origin: 'user' });
  const text = normalizeSource(blockText(e, ids.src!));
  const src = (q: string) => ({ contentId: ids.srcC!, from: text.indexOf(q), to: text.indexOf(q) + q.length, excerpt: q });
  e.transact((tx) => {
    const box = (k: string, x: number, title: string, run: string, s?: ReturnType<typeof src>) => {
      ids[k] = tx.createBlock({ x, y: 300, w: 200, h: 44, ai: { generated: true, runId: run, ...(s ? { source: s } : {}) } } as never);
      tx.createContent({ type: 'text', blockId: ids[k]!, role: 'title', doc: para(title), ai: { generated: true, runId: run } } as never);
    };
    box('a', 0, '금리 인상', 'r1', src('금리 인상'));
    box('b', 300, '대출 감소', 'r1', src('대출 감소는'));
    box('c', 600, '소비 위축', 'r1');
    box('o', 900, '다른 실행', 'r2');
    tx.createArrow({ from: { blockId: ids.b!, side: 'auto' }, to: { blockId: ids.c!, side: 'auto' }, label: '낳음' });
  }, { origin: 'ai' });
  return { e, ids, text };
}

describe('restructureSource', () => {
  it('출처 구절이 든 문단 처음부터 끝까지 보내고, 자리는 고른 상자 왼쪽 위 · 출처 위치는 원문 기준', () => {
    const { e, ids, text } = setup();
    const s = restructureSource(e, [ids.a!, ids.b!]);
    if ('error' in s) throw new Error(s.error);
    expect(s.text).toBe(`${SRC[1]}\n${SRC[2]}`);
    expect(s.replace).toEqual([ids.a, ids.b]);
    expect(s.at).toEqual({ x: 0, y: 300 });
    expect(s.sourceContentId).toBe(ids.srcC);
    expect(text.slice(s.offset!, s.offset! + s.text.length)).toBe(s.text);
  });

  it('다른 실행의 상자가 섞이면 · AI 상자가 아니면 안내', () => {
    const { e, ids } = setup();
    expect(restructureSource(e, [ids.a!, ids.o!])).toEqual({ error: '같은 구조화 결과에서 나온 상자만 골라 주세요.' });
    expect('error' in restructureSource(e, [ids.src!])).toBe(true);
  });

  it('원문을 지웠으면 고른 상자의 글과 그 사이 화살표로', () => {
    const { e, ids } = setup();
    e.transact((tx) => { tx.delete('content', ids.srcC!); tx.delete('block', ids.src!); }, { origin: 'user' });
    const s = restructureSource(e, [ids.b!, ids.c!]);
    if ('error' in s) throw new Error(s.error);
    expect(s.text).toContain('대출 감소');
    expect(s.text).toContain('소비 위축');
    expect(s.text).toContain('- 대출 감소 → 소비 위축 (낳음)');
    expect(s.sourceContentId).toBeUndefined();
  });
});
