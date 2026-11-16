// 문서 순서 = 캔버스의 논리 구조: 화살표 흐름 차례 · 한 줄 흐름은 단계 번호 · 갈래 흐름은 들여쓰기 · 화살표 없는 블록은 자리 순서 · 순환도 빠짐없이
import { describe, expect, it } from 'vitest';
import { createTextBlock, documentOrder, Engine, type TextDoc, type TxResult } from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;
function note(boxes: Record<string, [number, number]>, arrows: ([string, string] | [string, string, string])[], kinds: Record<string, string> = {}) {
  const e = new Engine();
  const id: Record<string, string> = {};
  for (const [k, [x, y]] of Object.entries(boxes)) id[k] = val(createTextBlock(e, { x, y }, { doc: doc(k) })).blockId;
  for (const [k, kind] of Object.entries(kinds)) e.transact((tx) => tx.set('block', id[k]!, { nodeKind: kind }), { origin: 'user' });
  for (const [a, b, relation] of arrows) e.transact((tx) => tx.createArrow({ from: { blockId: id[a]!, side: 'auto' }, to: { blockId: id[b]!, side: 'auto' }, ...(relation ? { relation } : {}) }), { origin: 'user' });
  const name = Object.fromEntries(Object.entries(id).map(([k, v]) => [v, k]));
  return documentOrder(e).map((it) => [name[it.block.id], it.step ?? null, it.depth ?? null]);
}

describe('문서 순서 (논리 구조)', () => {
  it('한 줄 흐름: 자리와 상관없이 화살표 차례 + 단계 번호, 제목은 자리 순서 그대로 앞', () => {
    // 캔버스 예제: 제목 위, 1단계 위, 2 · 3단계는 같은 줄 나란히, 4단계 아래
    const r = note({ 제목: [120, 24], 분석: [120, 90], 프롬프트: [120, 280], 검증: [500, 280], 반영: [500, 470] },
      [['검증', '반영'], ['프롬프트', '검증'], ['분석', '프롬프트']]);
    expect(r).toEqual([['제목', null, null], ['분석', 1, null], ['프롬프트', 2, null], ['검증', 3, null], ['반영', 4, null]]);
  });

  it('거꾸로 놓인 흐름도 화살표 차례 (자리보다 흐름)', () => {
    expect(note({ 끝: [0, 0], 중간: [0, 200], 시작: [0, 400] }, [['시작', '중간'], ['중간', '끝']]).map((x) => x[0])).toEqual(['시작', '중간', '끝']);
  });

  it('갈래 흐름(마인드맵): 가지를 끝까지 따라간 뒤 다음 가지 · 들여쓰기 단계', () => {
    const r = note({ 중심: [300, 0], 왼쪽: [0, 200], 오른쪽: [600, 200], 왼쪽아래: [0, 400] }, [['중심', '왼쪽'], ['중심', '오른쪽'], ['왼쪽', '왼쪽아래']]);
    expect(r).toEqual([['중심', null, 0], ['왼쪽', null, 1], ['왼쪽아래', null, 2], ['오른쪽', null, 1]]);
  });

  it('화살표 없는 블록은 자리 순서, 순환 흐름도 빠짐없이 한 번씩', () => {
    const r = note({ 가: [0, 0], 나: [0, 200], 다: [0, 400], 메모: [600, 600] }, [['가', '나'], ['나', '다'], ['다', '가']]);
    expect(r.map((x) => x[0])).toEqual(['가', '나', '다', '메모']);
    expect(note({ 위: [0, 0], 아래: [0, 300] }, [])).toEqual([['위', null, null], ['아래', null, null]]);
  });
});

describe('관계 읽는 방향 (STRUCTURE-GUIDE 4.11)', () => {
  it('분류 트리(kind-of · 하위 → 상위 화살표): 상위가 먼저, 하위는 들여쓰기 — 자리가 거꾸로여도', () => {
    const r = note({ 어류: [0, 0], 조류: [300, 0], 척추동물: [150, 300] }, [['어류', '척추동물', 'kind-of'], ['조류', '척추동물', 'kind-of']]);
    expect(r).toEqual([['척추동물', null, 0], ['어류', null, 1], ['조류', null, 1]]);
  });

  it('논증(주장 노드로 가는 supports · refutes): 주장이 먼저(두괄식), 근거 · 반박은 그 아래 들여쓰기', () => {
    const r = note({ 근거: [0, 0], 주장: [400, 0], 반박: [400, 300] }, [['근거', '주장', 'supports'], ['반박', '주장', 'refutes']], { 주장: 'claim' });
    expect(r[0]).toEqual(['주장', null, 0]);
    expect(r.slice(1).map((x) => x[2])).toEqual([1, 1]);
  });

  it('인과 사슬 끝의 뒷받침(받는 쪽이 주장이 아님)은 화살표 차례 그대로', () => {
    const r = note({ 원화: [0, 0], 수입물가: [300, 0], 물가안정: [600, 0] }, [['원화', '수입물가', 'causes'], ['수입물가', '물가안정', 'supports']], { 물가안정: 'goal' });
    expect(r.map((x) => x[0])).toEqual(['원화', '수입물가', '물가안정']);
  });

  it('위계는 한 줄이어도 들여쓰기 (전체 ⊃ 부분 ⊃ 더 작은 부분)', () => {
    const r = note({ 작은: [0, 0], 부분: [300, 0], 전체: [600, 0] }, [['작은', '부분', 'part-of'], ['부분', '전체', 'part-of']]);
    expect(r).toEqual([['전체', null, 0], ['부분', null, 1], ['작은', null, 2]]);
  });

  it('인과 사슬(causes)은 차례만 — 번호 단계(next 사슬 전용) · 들여쓰기 없음', () => {
    const r = note({ 금리: [0, 0], 이자: [300, 0], 소비: [600, 0] }, [['금리', '이자', 'causes'], ['이자', '소비', 'causes']]);
    expect(r).toEqual([['금리', null, null], ['이자', null, null], ['소비', null, null]]);
  });

  it('next 사슬은 번호 단계 그대로', () => {
    const r = note({ 하나: [0, 0], 둘: [0, 200], 셋: [0, 400] }, [['하나', '둘', 'next'], ['둘', '셋', 'next']]);
    expect(r).toEqual([['하나', 1, null], ['둘', 2, null], ['셋', 3, null]]);
  });
});

describe('묶음 안의 흐름', () => {
  it('흐름도를 통째로 묶어도 화살표 차례 · 단계 번호 (나란한 단계가 컬럼이 되지 않게)', () => {
    const e = new Engine();
    const id: Record<string, string> = {};
    for (const [k, [x, y]] of Object.entries({ 제목: [120, 24], 분석: [120, 90], 프롬프트: [120, 280], 검증: [500, 280], 반영: [500, 470] } as Record<string, [number, number]>)) id[k] = val(createTextBlock(e, { x, y }, { doc: doc(k) })).blockId;
    for (const [a, b] of [['분석', '프롬프트'], ['프롬프트', '검증'], ['검증', '반영']] as const) e.transact((tx) => tx.createArrow({ from: { blockId: id[a]!, side: 'auto' }, to: { blockId: id[b]!, side: 'auto' } }), { origin: 'user' });
    e.transact((tx) => { for (const k of Object.keys(id)) tx.set('block', id[k]!, { group: 'g1' }); }, { origin: 'user' });
    const name = Object.fromEntries(Object.entries(id).map(([k, v]) => [v, k]));
    expect(documentOrder(e).map((it) => [name[it.block.id], it.step ?? null])).toEqual([['제목', null], ['분석', 1], ['프롬프트', 2], ['검증', 3], ['반영', 4]]);
  });
});
