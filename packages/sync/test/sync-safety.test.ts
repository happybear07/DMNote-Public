// 동기화 안전 (SYNC.md 13 · 21.2 OD-10): 원격 변경이 조용히 버려지지 않는다 · 묶음 이름 · 댓글 · 데이터베이스 행처럼
// 한 필드에 모아 둔 목록도 서로 다른 항목의 동시 편집이 둘 다 남는다 · 저장된 Y 기록을 이어 붙일 때 엔진에 아직 안 들어간 변경을 지우지 않는다
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addComment, addDbRow, blockComments, bodyDoc, createArrow, createDatabaseBlock, createTextBlock, dbRows, deleteEntities, Engine, groupBlocks, isDatabaseContent, newId,
  reconnectArrow, renameGroup, setDbValue, setText, type DatabaseContent, type Id,
} from '@dn/engine-core';
import { attach, knownIds } from '../src';

const val = <T,>(r: { ok: boolean; value?: T }) => r.value as T;

/** 같은 노트를 가진 두 기기 — 처음엔 같은 상태, link.on = false면 끊긴 채 따로 고친다 */
function twoDevices(setup: (e: Engine) => void = () => {}) {
  const id = newId();
  const a = new Engine({ note: { id, title: '공유', createdAt: 1, updatedAt: 1 } });
  setup(a);
  const da = new Y.Doc(), db = new Y.Doc();
  attach(a, da);
  const b = new Engine({ note: { id, title: '', createdAt: 1, updatedAt: 1 } });
  Y.applyUpdate(db, Y.encodeStateAsUpdate(da));
  const rejected: number[] = [];
  attach(b, db, { onRemote: (_n, r) => { if (r) rejected.push(r); } });
  const sync = () => {
    Y.applyUpdate(db, Y.encodeStateAsUpdate(da, Y.encodeStateVector(db)), 'peer');
    Y.applyUpdate(da, Y.encodeStateAsUpdate(db, Y.encodeStateVector(da)), 'peer');
  };
  return { a, b, da, db, sync, rejected };
}

describe('원격 변경 반영', () => {
  it('병합 결과가 엔진 규칙에 어긋나도(제목 상자에 문단 여럿) 한 줄로 펴서 반영하고, 같은 트랜잭션의 다른 변경도 버리지 않는다', () => {
    let title = '', other = '';
    const { b, db, rejected } = twoDevices((e) => {
      title = val(createTextBlock(e, { x: 0, y: 0 }, { kind: 'title', title: '제목' })).blockId;
      other = val(createTextBlock(e, { x: 400, y: 0 }, { body: '다른 상자' })).blockId;
    });
    const titleContent = [...b.contentsOf(title)][0]!.id;
    // 다른 기기들의 동시 편집이 합쳐진 결과를 흉내 낸다: 제목 상자의 글에 문단이 둘 + 다른 상자 옮김
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(db));
    remote.transact(() => {
      const frag = remote.getMap<Y.Map<unknown>>('contents').get(titleContent)!.get('doc') as Y.XmlFragment;
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText(); t.insert(0, '둘째 줄');
      p.insert(0, [t]);
      frag.insert(frag.length, [p]);
      remote.getMap<Y.Map<unknown>>('blocks').get(other)!.set('x', 800);
    });
    Y.applyUpdate(db, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(db)), 'peer');
    expect(b.getBlock(other)!.x).toBe(800);
    const doc = [...b.contentsOf(title)][0] as unknown as { doc: { content: unknown[] } };
    expect(doc.doc.content.length).toBe(1); // 한 줄 제목
    expect(JSON.stringify(doc.doc)).toContain('둘째 줄');
    expect(rejected).toEqual([]);
  });

  it('자기 자신을 가리키는 화살표는 엔진에 넣지 않고, 나머지 변경은 반영한다', () => {
    let b1 = '', b2 = '';
    const { b, db } = twoDevices((e) => {
      b1 = val(createTextBlock(e, { x: 0, y: 0 }, { body: 'A' })).blockId;
      b2 = val(createTextBlock(e, { x: 400, y: 0 }, { body: 'B' })).blockId;
    });
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(db));
    remote.transact(() => {
      const m = new Y.Map<unknown>();
      m.set('from', { blockId: b1, side: 'auto', t: 0.5 }); m.set('to', { blockId: b1, side: 'auto', t: 0.5 });
      remote.getMap<Y.Map<unknown>>('arrows').set(newId(), m);
      remote.getMap<Y.Map<unknown>>('blocks').get(b2)!.set('y', 300);
    });
    Y.applyUpdate(db, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(db)), 'peer');
    expect([...b.arrows()].length).toBe(0);
    expect(b.getBlock(b2)!.y).toBe(300);
  });
});

describe('노트 필드 지우기', () => {
  it('한쪽이 노트 필드를 지우면(편집 잠금 풀기 → page 빠짐) 다른 쪽에서도 빠진다', () => {
    const { a, b, sync } = twoDevices((e) => e.transact((tx) => tx.setNote({ page: { editLock: true } }), { origin: 'user' }));
    expect(b.note.page).toEqual({ editLock: true });
    a.transact((tx) => tx.setNote({ page: undefined }), { origin: 'user' });
    sync();
    expect(b.note.page).toBeUndefined();
  });
});

describe('목록 필드의 동시 편집', () => {
  it('두 기기가 같은 블록에 따로 단 댓글이 둘 다 남는다', () => {
    let blk = '';
    const { a, b, sync } = twoDevices((e) => { blk = val(createTextBlock(e, { x: 0, y: 0 }, { body: '본문' })).blockId; });
    addComment(a, blk, 'A의 댓글');
    addComment(b, blk, 'B의 댓글');
    sync();
    for (const e of [a, b]) expect(blockComments(e.getBlock(blk)).map((c) => c.text).sort()).toEqual(['A의 댓글', 'B의 댓글']);
  });

  it('두 기기가 서로 다른 묶음 이름을 동시에 바꾸면 둘 다 남는다', () => {
    let g1: Id | null = null, g2: Id | null = null;
    const { a, b, sync } = twoDevices((e) => {
      const x = [0, 1, 2, 3].map((i) => val(createTextBlock(e, { x: i * 300, y: 0 }, { body: `상자 ${i}` })).blockId);
      g1 = val(groupBlocks(e, [x[0]!, x[1]!]));
      g2 = val(groupBlocks(e, [x[2]!, x[3]!]));
    });
    renameGroup(a, g1!, '첫 묶음');
    renameGroup(b, g2!, '둘째 묶음');
    sync();
    for (const e of [a, b]) {
      expect(e.note.groups?.[g1!]?.name).toBe('첫 묶음');
      expect(e.note.groups?.[g2!]?.name).toBe('둘째 묶음');
    }
  });

  it('데이터베이스: 서로 다른 행 · 같은 행의 다른 칸을 동시에 고치면 둘 다 남고, 따로 더한 행도 둘 다 남는다', () => {
    let cid = '';
    const { a, b, sync } = twoDevices((e) => {
      const blockId = val(createDatabaseBlock(e, { x: 0, y: 0 }, '할 일'));
      cid = [...e.contentsOf(blockId)][0]!.id;
    });
    const db = (e: Engine) => e.getContent(cid) as DatabaseContent;
    const [r0, r1] = dbRows(db(a));
    const [p0, p1] = db(a).properties;
    setDbValue(a, cid, r0!.id, p0!.id, 'A가 쓴 칸');
    setDbValue(b, cid, r1!.id, p0!.id, 'B가 쓴 칸');
    setDbValue(b, cid, r0!.id, p1!.id, null as never); // 같은 행의 다른 칸
    addDbRow(a, cid);
    addDbRow(b, cid);
    sync();
    for (const e of [a, b]) {
      const c = db(e);
      expect(isDatabaseContent(c)).toBe(true);
      const rows = dbRows(c);
      expect(rows.find((r) => r.id === r0!.id)!.values[p0!.id]).toBe('A가 쓴 칸');
      expect(rows.find((r) => r.id === r1!.id)!.values[p0!.id]).toBe('B가 쓴 칸');
      expect(rows.length).toBe(5);
    }
    expect(JSON.stringify(dbRows(db(a)))).toBe(JSON.stringify(dbRows(db(b))));
  });
});

describe('예전 기록과의 호환', () => {
  it('목록 필드를 통째 값으로 둔 예전 Y 기록도 읽고, 다음에 쓸 때 항목 키로 바꾼다', () => {
    const id = newId();
    const old = new Y.Doc();
    // 예전 다리가 만든 모양: blocks/<id>.comments = 배열 통째
    old.transact(() => {
      old.getMap<unknown>('note').set('id', id);
      old.getMap<unknown>('note').set('title', '예전');
      const m = new Y.Map<unknown>();
      old.getMap<Y.Map<unknown>>('blocks').set('blk', m);
      for (const [k, v] of Object.entries({ x: 0, y: 0, w: 200, h: 80, sizing: 'auto', layout: 'flow', z: 'a0', comments: [{ id: 'c1', text: '예전 댓글', at: 1 }] })) m.set(k, v);
    });
    const e = new Engine({ note: { id, title: '', createdAt: 1, updatedAt: 1 } });
    attach(e, old);
    expect(blockComments(e.getBlock('blk')).map((c) => c.text)).toEqual(['예전 댓글']);
    addComment(e, 'blk', '새 댓글');
    const m = old.getMap<Y.Map<unknown>>('blocks').get('blk')!;
    expect(m.has('comments')).toBe(false);
    expect([...m.keys()].filter((k) => k.startsWith('comments/')).length).toBe(2);
    expect(blockComments(e.getBlock('blk')).map((c) => c.text)).toEqual(['예전 댓글', '새 댓글']);
  });
});

describe('저장된 Y 기록 이어 붙이기', () => {
  it('Y에는 왔지만 엔진에 저장되기 전이던 블록을 지우지 않고 엔진으로 들인다', () => {
    let keep = '';
    const id = newId();
    const disk = new Engine({ note: { id, title: '노트', createdAt: 1, updatedAt: 1 } });
    keep = val(createTextBlock(disk, { x: 0, y: 0 }, { body: '원래 있던 상자' })).blockId;
    const stored = new Y.Doc();
    attach(disk, stored).detach();
    const known = knownIds(disk, stored);
    // 다른 기기에서 온 상자가 Y 기록에는 들어갔지만, 엔진 로그는 저장되기 전에 앱이 닫혔다
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(stored));
    const other = new Engine({ note: { id, title: '', createdAt: 1, updatedAt: 1 } });
    attach(other, remote);
    const arrived = val(createTextBlock(other, { x: 400, y: 0 }, { body: '다른 기기 상자' })).blockId;
    Y.applyUpdate(stored, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(stored)), 'peer');
    // 다시 열기: 디스크의 엔진(arrived 없음) + 저장된 Y(arrived 있음)
    const reload = new Y.Doc();
    Y.applyUpdate(reload, Y.encodeStateAsUpdate(stored));
    attach(disk, reload, { prefer: 'engine', known: known });
    expect(disk.getBlock(arrived)).toBeTruthy();
    expect(reload.getMap('blocks').has(arrived)).toBe(true);
    expect(disk.getBlock(keep)).toBeTruthy();
  });

  it('이 기기에서 지운 상자(마지막 기록 때 알던 것)는 Y에서도 지운다', () => {
    const id = newId();
    const e = new Engine({ note: { id, title: '노트', createdAt: 1, updatedAt: 1 } });
    const gone = val(createTextBlock(e, { x: 0, y: 0 }, { body: '지울 상자' })).blockId;
    const stored = new Y.Doc();
    attach(e, stored).detach();
    const known = knownIds(e, stored);
    // 다리 없이 지움 (예: 동기화를 붙이기 전 편집)
    e.transact((tx) => { for (const c of [...e.contentsOf(gone)]) tx.delete('content', c.id); tx.delete('block', gone); }, { origin: 'user' });
    attach(e, stored, { prefer: 'engine', known: known });
    // 키는 남고 이 기기의 묘비가 붙는다(SYNC 13.2) — 다시 이으면 엔진에 없다
    const m = stored.getMap<Y.Map<unknown>>('blocks').get(gone)!;
    expect([...m.keys()].some((k) => k.startsWith('_del:'))).toBe(true);
    const fresh = new Engine({ note: { id, title: '', createdAt: 1, updatedAt: 1 } });
    attach(fresh, stored);
    expect(fresh.getBlock(gone)).toBeUndefined();
  });

  it('기록이 없던 예전 동기화 상태(known 없음)는 지우는 대신 엔진으로 들인다', () => {
    const id = newId();
    const disk = new Engine({ note: { id, title: '노트', createdAt: 1, updatedAt: 1 } });
    const stored = new Y.Doc();
    attach(disk, stored).detach();
    const other = new Engine({ note: { id, title: '', createdAt: 1, updatedAt: 1 } });
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(stored));
    attach(other, remote);
    const arrived = val(createTextBlock(other, { x: 0, y: 0 }, { body: '온 상자' })).blockId;
    Y.applyUpdate(stored, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(stored)));
    attach(disk, stored, { prefer: 'engine' });
    expect(disk.getBlock(arrived)).toBeTruthy();
  });
});

describe('묘비 (SYNC 13.2)', () => {
  const textOf = (e: Engine, blockId: string) => JSON.stringify([...e.contentsOf(blockId)]);
  it('서버 순서 — 오프라인 기기의 삭제가 다른 기기가 고치고 한참 뒤에 와도 고친 내용은 남는다(13.2.1)', () => {
    let x = '';
    const { a, b, da, db } = twoDevices((e) => { x = val(createTextBlock(e, { x: 0, y: 0 }, { body: '원래' })).blockId; });
    deleteEntities(a, [x]); // A는 오프라인 — 아직 못 보냄
    setText(b, [...b.contentsOf(x)][0]!.id, bodyDoc('B가 고침'));
    Y.applyUpdate(da, Y.encodeStateAsUpdate(db, Y.encodeStateVector(da)), 'peer'); // A가 B 편집을 받고
    Y.applyUpdate(db, Y.encodeStateAsUpdate(da, Y.encodeStateVector(db)), 'peer'); // A의 삭제가 B에 도착
    for (const e of [a, b]) {
      expect(e.getBlock(x)?.conflict).toBeTruthy();
      expect(textOf(e, x)).toContain('B가 고침');
    }
  });

  it('지운 뒤 실행 취소로 되살리면, 그사이 다른 기기가 그 블록에 한 편집도 함께 남는다(#14)', () => {
    let x = '';
    const { a, b, sync } = twoDevices((e) => { x = val(createTextBlock(e, { x: 0, y: 0 }, { body: '원래' })).blockId; });
    deleteEntities(a, [x]);
    b.transact((tx) => tx.set('block', x, { style: { color: 'blue' } }), { origin: 'user' });
    a.undo();
    sync();
    for (const e of [a, b]) {
      expect(e.getBlock(x)).toBeDefined();
      expect(e.getBlock(x)!.style).toEqual({ color: 'blue' });
      expect(e.getBlock(x)!.conflict).toBeUndefined();
    }
  });

  it('고치지 않은 것을 지우면 양쪽에서 사라지고, 지운 블록에 걸린 화살표도 숨는다', () => {
    let x = '', y = '';
    const { a, b, sync } = twoDevices((e) => {
      x = val(createTextBlock(e, { x: 0, y: 0 }, { body: 'X' })).blockId;
      y = val(createTextBlock(e, { x: 400, y: 0 }, { body: 'Y' })).blockId;
      createArrow(e, { blockId: x, side: 'auto' }, { blockId: y, side: 'auto' });
    });
    expect([...b.arrows()].length).toBe(1);
    deleteEntities(a, [x]);
    sync();
    expect(b.getBlock(x)).toBeUndefined();
    expect(b.getBlock(y)).toBeDefined();
    expect([...b.arrows()].length).toBe(0);
  });
});

describe('한꺼번에 들어온 다시 잇기 + 지우기 (S4 반례 s4-01)', () => {
  it('화살표를 다른 블록으로 다시 잇고 원래 블록을 지운 변경이 한 번에 와도 화살표는 새 자리로 옮겨 남는다', () => {
    let x = '', y = '', z = '';
    const { a, b, da, db } = twoDevices((e) => {
      x = val(createTextBlock(e, { x: 0, y: 0 }, { body: 'X' })).blockId;
      y = val(createTextBlock(e, { x: 400, y: 0 }, { body: 'Y' })).blockId;
      z = val(createTextBlock(e, { x: 800, y: 0 }, { body: 'Z' })).blockId;
      createArrow(e, { blockId: x, side: 'auto' }, { blockId: y, side: 'auto' });
    });
    const sv = Y.encodeStateVector(db);
    const arrow = [...a.arrows()][0]!.id;
    reconnectArrow(a, arrow, 'from', { blockId: z, side: 'auto' });
    deleteEntities(a, [x]);
    Y.applyUpdate(db, Y.encodeStateAsUpdate(da, sv), 'peer'); // 두 변경이 한 업데이트로
    expect(b.getBlock(x)).toBeUndefined();
    const ar = b.getArrow(arrow);
    expect(ar?.from.blockId).toBe(z);
    expect(ar?.to.blockId).toBe(y);
  });
});
