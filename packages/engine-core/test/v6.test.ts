// 노트 저장 형식 v6 (docs/review/V6-SCHEMA-REVIEW.md): v5 → v6 항등 변환 · 의미 · 출처 · 모양 필드 왕복 · 관계 → 기본 모양 표.
import { describe, expect, it } from 'vitest';
import {
  createArrow, createTextBlock, deserialize, diffBlocks, effectiveStyle, Engine, isKnownRelation, NODE_KINDS, RELATION_SPEC, RELATIONS, RELATIONS_V1, relationSpec, SCHEMA_VERSION, serialize,
  type Arrow, type Block, type TextDoc, type TxResult,
} from '../src';

const val = <T,>(r: TxResult<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as TextDoc;

function note() {
  const e = new Engine();
  const a = val(createTextBlock(e, { x: 0, y: 0 }, { doc: doc('가') })).blockId;
  const b = val(createTextBlock(e, { x: 0, y: 200 }, { doc: doc('나') })).blockId;
  return { e, a, b };
}

describe('v5 → v6', () => {
  it('항등 변환 — 점선(dash) · AI 출처를 그대로 두고, 읽을 때 점선 · claude로 본다', () => {
    const { e, a, b } = note();
    e.transact((tx) => {
      tx.set('block', a, { ai: { generated: true, runId: 'r1' } });
      tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' }, label: '예시', style: { dash: true } });
    }, { origin: 'user' });
    const v5 = JSON.parse(JSON.stringify(serialize(e, {}, 5)));
    const r = deserialize(v5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(5);
    const e2 = new Engine(r.data);
    const arrow = [...e2.arrows()][0]!;
    expect(arrow.style).toEqual({ dash: true });
    expect(arrow.relation).toBeUndefined();
    expect(effectiveStyle(arrow).line).toBe('dashed');
    expect(e2.getBlock(a)!.ai).toEqual({ generated: true, runId: 'r1' });
    expect(serialize(e2).schemaVersion).toBe(6);
    // 두 번 변환해도 같다
    const again = deserialize(JSON.parse(JSON.stringify(serialize(e2))));
    expect(again.ok && JSON.stringify(serialize(new Engine(again.data)).arrows)).toBe(JSON.stringify(serialize(e2).arrows));
  });

  it('v6 왕복 — 관계(모르는 값 포함) · 노드 종류 · 상태 · 묶음 끝 · 출처 · 기호 필드 보존', () => {
    const { e, a, b } = note();
    const meta: Partial<Block> = { nodeKind: 'claim', status: 'deferred', role: '가설', speaker: '민수', due: '금요일', group: 'g1', ai: { generated: true, runId: 'r', origin: 'open_teacher', model: 'qwen', editedAt: 123 } };
    const arrowExtra: Partial<Arrow> = { relation: 'implies', symbol: '∴', negated: true, sign: '-', order: 2, style: { line: 'wavy', head: 'bar', tail: 'dot', width: 2, route: 'curve' } };
    e.transact((tx) => {
      tx.set('block', a, meta as Record<string, unknown>);
      tx.set('block', b, { group: 'g1', nodeKind: 'something-new' });
      tx.createArrow({ from: { blockId: a, side: 'auto', groupId: 'g1' }, to: { blockId: b, side: 'auto' }, ...arrowExtra });
      tx.createArrow({ from: { blockId: b, side: 'auto' }, to: { blockId: a, side: 'auto' }, relation: 'future-relation' });
      tx.setNote({ groups: { g1: { name: '전제', kind: 'premises', bracket: 'brace' } } });
    }, { origin: 'load' }); // 사람 출처면 AI 블록 의미를 고친 것으로 보고 editedAt을 새로 찍는다 (provenance.ts)
    const r = deserialize(JSON.parse(JSON.stringify(serialize(e))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e2 = new Engine(r.data);
    expect(e2.getBlock(a)).toMatchObject(meta);
    expect(e2.getBlock(b)!.nodeKind).toBe('something-new');
    const arrows = [...e2.arrows()];
    expect(arrows.find((x) => x.relation === 'implies')).toMatchObject({ ...arrowExtra, from: { groupId: 'g1' } });
    expect(arrows.find((x) => x.relation === 'future-relation')).toBeDefined();
    expect(e2.note.groups?.g1).toEqual({ name: '전제', kind: 'premises', bracket: 'brace' });
  });

  it('더 새 버전(v7)은 newer-version', () => {
    const { e } = note();
    const r = deserialize({ ...JSON.parse(JSON.stringify(serialize(e))), schemaVersion: SCHEMA_VERSION + 1 });
    expect(r).toMatchObject({ ok: false, reason: 'newer-version' });
  });
});

describe('관계 → 기본 모양 (relations.ts)', () => {
  it('알려진 관계 28개 · 노드 종류 24개, 전부 모양이 있다', () => {
    expect(RELATIONS).toHaveLength(28);
    expect(new Set(RELATIONS).size).toBe(28);
    expect(NODE_KINDS).toHaveLength(24);
    for (const r of RELATIONS) expect(RELATION_SPEC[r], r).toBeDefined();
    expect(isKnownRelation('causes')).toBe(true);
    expect(isKnownRelation('toString')).toBe(false);
    expect(isKnownRelation('future-relation')).toBe(false);
  });

  it('v1 8개는 예전 AI 반영의 점선 여부와 같다 (실선 ↔ dash 없음)', () => {
    const oldDash: Record<string, boolean> = { causes: false, 'leads-to': false, 'part-of': false, 'example-of': true, contrasts: true, supports: false, 'depends-on': true, next: false };
    for (const r of RELATIONS_V1) expect(RELATION_SPEC[r].line !== 'solid', r).toBe(oldDash[r]);
    expect(RELATION_SPEC.contrasts.head).toBe('none');
  });

  it('그릴 모양: 사용자 모양 > v5 dash > 관계 기본 > 미정 기본', () => {
    expect(effectiveStyle({})).toMatchObject({ line: 'solid', head: 'triangle', tail: 'none', width: 1.5, route: 'straight' });
    expect(effectiveStyle({ relation: 'depends-on' }).line).toBe('dotted');
    expect(effectiveStyle({ relation: 'causes', style: { dash: true } }).line).toBe('dashed');
    expect(effectiveStyle({ relation: 'causes', style: { dash: true, line: 'spring' } }).line).toBe('spring');
    expect(effectiveStyle({ relation: 'equivalent' })).toMatchObject({ line: 'double', head: 'chevron', tail: 'chevron' });
    expect(effectiveStyle({ relation: 'future-relation', style: { color: 'red' } })).toMatchObject({ line: 'solid', color: 'red', tone: 'secondary' });
    expect(relationSpec(undefined)).toBe(relationSpec('nope'));
  });

  it('새 화살표 모양(도구 막대): createArrow에 고른 모양 — 사본으로 저장 · 실행 취소 한 번 · 없으면 관계 기본 · 저장 왕복', () => {
    const e = new Engine();
    const a = val(createTextBlock(e, { x: 0, y: 0 }, { doc: doc('가') })).blockId;
    const b = val(createTextBlock(e, { x: 400, y: 0 }, { doc: doc('나') })).blockId;
    const pick = { line: 'curl' as const };
    const id = val(createArrow(e, { blockId: a, side: 'auto' }, { blockId: b, side: 'auto' }, undefined, pick));
    expect(e.getArrow(id)!.style).toEqual({ line: 'curl' });
    expect(e.getArrow(id)!.style).not.toBe(pick);
    expect(effectiveStyle(e.getArrow(id)!).line).toBe('curl');
    const back = deserialize(serialize(e));
    expect(back.ok && [...back.data.arrows].find((x) => x.id === id)?.style).toEqual({ line: 'curl' });
    e.undo();
    expect(e.getArrow(id)).toBeUndefined();
    const plain = val(createArrow(e, { blockId: b, side: 'auto' }, { blockId: a, side: 'auto' }));
    expect(e.getArrow(plain)!.style).toBeUndefined();
  });
});

describe('버전 비교 (diffBlocks) · v6', () => {
  it('노드 종류를 바꾸면 고친 블록, 관계를 바꾸면 한쪽에만 있는 연결', () => {
    const { e, a, b } = note();
    e.transact((tx) => { tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' }, relation: 'causes' }); }, { origin: 'user' });
    const r0 = deserialize(JSON.parse(JSON.stringify(serialize(e))));
    if (!r0.ok) throw new Error('deserialize');
    const old = new Engine(r0.data);
    e.transact((tx) => { tx.set('block', a, { nodeKind: 'claim' }); for (const x of [...e.arrows()]) tx.set('arrow', x.id, { relation: 'supports' }); }, { origin: 'user' });
    const d = diffBlocks(old, e);
    expect(d.changed).toEqual([a]);
    expect([d.arrowsA, d.arrowsB]).toEqual([1, 1]);
  });
});
