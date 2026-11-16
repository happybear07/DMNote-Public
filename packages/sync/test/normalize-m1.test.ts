// SYNC.md M1 남은 것: normalize N5 · N6 · N8 · N10 (13.4), layout 마스크 (13.3 #20 · OD-11), Y meta 스키마 버전 (10.5), 동기화 파일 v4 schema (OD-15),
// 다리로 들어온 모르는 필드 보존 (10.5 "M1에서 테스트").
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addStroke, applyMeasuredHeights, bindStrokes, createTextBlock, deleteEntities, Engine, groupBlocks, groupMembers, newId, setText, bodyDoc, type Id,
} from '@dn/engine-core';
import { attach, docSchema, isSyncFile, type AttachOptions } from '../src';

const val = <T,>(r: { ok: boolean; value?: T }) => r.value as T;

/** 같은 노트를 가진 두 기기 (bOpts: 두 번째 기기의 attach 옵션) */
function twoDevices(setup: (e: Engine) => void = () => {}, aOpts: AttachOptions = {}, bOpts: AttachOptions = {}) {
  const id = newId();
  const a = new Engine({ note: { id, title: '공유', createdAt: 1, updatedAt: 1 } });
  setup(a);
  const da = new Y.Doc(), db = new Y.Doc();
  attach(a, da, aOpts);
  const b = new Engine({ note: { id, title: '', createdAt: 1, updatedAt: 1 } });
  Y.applyUpdate(db, Y.encodeStateAsUpdate(da));
  const bridgeB = attach(b, db, bOpts);
  const sync = () => {
    Y.applyUpdate(db, Y.encodeStateAsUpdate(da, Y.encodeStateVector(db)), 'peer');
    Y.applyUpdate(da, Y.encodeStateAsUpdate(db, Y.encodeStateVector(da)), 'peer');
  };
  /** 다른 기기(가짜)가 Y에 직접 쓴 변경을 b에 들인다 */
  const remote = (fn: (d: Y.Doc) => void) => {
    const r = new Y.Doc();
    Y.applyUpdate(r, Y.encodeStateAsUpdate(db));
    r.transact(() => fn(r));
    Y.applyUpdate(db, Y.encodeStateAsUpdate(r, Y.encodeStateVector(db)), 'peer');
  };
  return { a, b, da, db, sync, remote, bridgeB };
}
const ymap = (d: Y.Doc, kind: string, id: Id) => d.getMap<Y.Map<unknown>>(kind).get(id)!;
const stroke = (e: Engine, x = 10) => val(addStroke(e, { tool: 'pen', color: '#000', width: 2, origin: { x, y: 10 }, points: [0, 0, 0.5, 0, 20, 5, 0.5, 10] }));

describe('normalize N5 · N6 · N8 · N10', () => {
  it('N5: 잉크가 아닌 콘텐츠에 묶인 획은 숨긴다', () => {
    let blk = '', s = '';
    const { b, remote } = twoDevices((e) => { blk = val(createTextBlock(e, { x: 0, y: 0 }, { body: '글' })).blockId; s = stroke(e, 600); });
    expect(b.getStroke(s)).toBeTruthy();
    const text = [...b.contentsOf(blk)][0]!.id;
    remote((d) => ymap(d, 'strokes', s).set('parent', { kind: 'content', contentId: text }));
    expect(b.getStroke(s)).toBeUndefined();
    expect(b.getContent(text)).toBeTruthy(); // 글 상자는 그대로
  });

  it('N6: 살아 있는 획이 없는 잉크 콘텐츠는 숨기고, 다른 곳에서 획이 묶이면 다시 보인다', () => {
    let s1 = '', ink = '';
    const { a, b, sync } = twoDevices((e) => {
      s1 = stroke(e);
      const blk = val(bindStrokes(e, [s1]))!;
      ink = [...e.contentsOf(blk)].find((c) => c.type === 'ink')!.id;
    });
    expect(b.getContent(ink)?.type).toBe('ink');
    // a가 (예전 앱처럼) 획만 지워 빈 잉크가 Y에 남음
    a.transact((tx) => tx.delete('stroke', s1), { origin: 'user' });
    sync();
    expect(b.getContent(ink)).toBeUndefined();
    // a가 새 획을 그 잉크에 묶으면 b에서도 잉크가 돌아온다
    const s2 = stroke(a, 40);
    a.transact((tx) => tx.set('stroke', s2, { parent: { kind: 'content', contentId: ink }, origin: { x: 0, y: 0 } }), { origin: 'user' });
    sync();
    expect(b.getContent(ink)?.type).toBe('ink');
    expect(b.getStroke(s2)).toBeTruthy();
  });

  it('N8: 다른 종류 맵에 같은 id가 있으면 앞 종류(block > content > arrow > stroke)만 보인다', () => {
    let blk = '', other = '';
    const { b, remote } = twoDevices((e) => {
      blk = val(createTextBlock(e, { x: 0, y: 0 }, { body: '하나' })).blockId;
      other = val(createTextBlock(e, { x: 400, y: 0 }, { body: '둘' })).blockId;
    });
    remote((d) => {
      const m = new Y.Map<unknown>();
      d.getMap<Y.Map<unknown>>('contents').set(blk, m); // 블록 id와 같은 id의 콘텐츠
      m.set('type', 'text'); m.set('blockId', other); m.set('order', 'a5'); m.set('role', 'body');
      m.set('x', 1);
    });
    expect(b.getBlock(blk)).toBeTruthy();
    expect(b.getContent(blk)).toBeUndefined();
    expect([...b.contentsOf(other)].length).toBe(1);
  });

  it('N10: 서로 다른 묶기가 같은 상자를 동시에 가져가 구성원이 하나 남은 묶음은 두 기기 모두 묶음이 아니다 (groups.ts 읽기 규칙, 필드는 그대로)', () => {
    let x = '', y = '', z = '';
    const { a, b, sync } = twoDevices((e) => {
      x = val(createTextBlock(e, { x: 0, y: 0 }, { body: '가' })).blockId;
      y = val(createTextBlock(e, { x: 400, y: 0 }, { body: '나' })).blockId;
      z = val(createTextBlock(e, { x: 800, y: 0 }, { body: '다' })).blockId;
    });
    groupBlocks(a, [x, y]);
    groupBlocks(b, [y, z]);
    sync();
    const ga = groupMembers(a), gb = groupMembers(b);
    expect(ga.size).toBe(1); // y를 가져간 쪽만 묶음, 남은 하나짜리는 묶음 아님
    expect([...ga.entries()]).toEqual([...gb.entries()]);
    for (const id of [x, y, z]) expect(a.getBlock(id)!.group).toBe(b.getBlock(id)!.group);
    // 지운 상자의 묶음: 구성원이 하나 남으면 묶음 아님 (묶음 정보는 남지만 읽을 때 묶음으로 치지 않는다)
    const [gid, ids] = [...ga.entries()][0]!;
    deleteEntities(a, [ids[0]!]);
    sync();
    expect(groupMembers(a).has(gid)).toBe(false);
    expect(groupMembers(b).has(gid)).toBe(false);
  });
});

describe('layout 마스크 (13.3 #20)', () => {
  it('높이 측정(layout)은 Y에 쓰지 않고, 다른 곳이 쓴 높이 자동 블록의 h로 이 기기 값을 덮지 않는다 — 고정 높이는 그대로 맞춘다', () => {
    let blk = '';
    const { a, b, da, remote } = twoDevices((e) => { blk = val(createTextBlock(e, { x: 0, y: 0 }, { body: '글' })).blockId; });
    expect(a.getBlock(blk)!.sizing).toBe('auto');
    const h0 = ymap(da, 'blocks', blk).get('h');
    applyMeasuredHeights(a, new Map([[blk, 333]]));
    expect(a.getBlock(blk)!.h).toBe(333);
    expect(ymap(da, 'blocks', blk).get('h')).toBe(h0);
    const bh = b.getBlock(blk)!.h;
    remote((d) => ymap(d, 'blocks', blk).set('h', 999));
    expect(b.getBlock(blk)!.h).toBe(bh);
    // 고정 높이로 바뀐 블록은 h를 맞춘다
    remote((d) => { ymap(d, 'blocks', blk).set('sizing', 'fixed'); ymap(d, 'blocks', blk).set('h', 420); });
    expect(b.getBlock(blk)!.sizing).toBe('fixed');
    expect(b.getBlock(blk)!.h).toBe(420);
  });
});

describe('스키마 버전 (10.5)', () => {
  it('쓰는 기기는 meta v:버전을 남기고, 문서가 더 새 버전이면 받기만 하고 로컬 변경은 Y에 쓰지 않는다', () => {
    let blk = '';
    const seen: number[] = [];
    const { a, b, da, db, sync, bridgeB } = twoDevices((e) => { blk = val(createTextBlock(e, { x: 0, y: 0 }, { body: '처음' })).blockId; }, { schema: 7 }, { schema: 6, onNewerSchema: (v) => seen.push(v) });
    expect(docSchema(da)).toBe(7); // 처음 쓴 기기(새 앱)
    expect(seen).toEqual([7]);
    expect(bridgeB.newerSchema()).toBe(7);
    // b의 로컬 편집은 Y에 가지 않는다 (보기 전용 — 앱이 편집을 막고 안내)
    const before = Y.encodeStateVector(db);
    const c = [...b.contentsOf(blk)][0]!.id;
    setText(b, c, bodyDoc('b가 고침'));
    expect(Y.encodeStateVector(db)).toEqual(before);
    // 받기는 계속된다
    const ca = [...a.contentsOf(blk)][0]!.id;
    setText(a, ca, bodyDoc('a가 고침'));
    sync();
    expect(JSON.stringify(b.getContent(c))).toContain('a가 고침');
  });

  it('표시가 없는 예전 기록에 이 앱이 쓰면 이 앱 버전이 남는다 (예전 앱은 그 뒤 보기 전용)', () => {
    let blk = '';
    const { b, db } = twoDevices((e) => { blk = val(createTextBlock(e, { x: 0, y: 0 }, { body: '처음' })).blockId; }, { schema: 5 }, { schema: 6 });
    expect(docSchema(db)).toBe(5);
    setText(b, [...b.contentsOf(blk)][0]!.id, bodyDoc('고침'));
    expect(docSchema(db)).toBe(6);
  });

  it('다리로 들어온 모르는 필드(새 버전 앱의 필드)는 엔진이 그대로 둔다', () => {
    let blk = '';
    const { b, remote } = twoDevices((e) => { blk = val(createTextBlock(e, { x: 0, y: 0 }, { body: '글' })).blockId; });
    remote((d) => ymap(d, 'blocks', blk).set('futureField', { a: 1 }));
    expect((b.getBlock(blk) as unknown as Record<string, unknown>).futureField).toEqual({ a: 1 });
  });

  it('동기화 파일 v4(schema 필드)를 알아본다', () => {
    expect(isSyncFile({ app: 'DamianNote', kind: 'sync', v: 4, schema: 6, device: 'Windows', exportedAt: '', notes: [] })).toBe(true);
    expect(isSyncFile({ app: 'DamianNote', kind: 'sync', v: 5, device: 'Windows', exportedAt: '', notes: [] })).toBe(false);
  });
});
