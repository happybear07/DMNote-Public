// 두 · 세 기기 수렴 속성 시험 하네스 (SYNC.md 19.2): bridge.test.ts의 pair()를 일반화.
// 기기 = Engine + Y.Doc + attach, 서버 = Y 구조만 다루는 메모리 방(방 DO 흉내 — 필드를 읽지 않음),
// 네트워크 = 기기마다 보낼 · 받을 프레임 큐(protocol.ts 프레임 그대로) — 순서 섞기 · 중복 · 끊김(큐 유실) · 다시 붙기(step 1/2).
// 결정성: 난수(id) · 시각 · Y clientID를 고정해 fast-check가 같은 명령 열을 같은 결과로 다시 돌리고 줄일 수 있게 한다.
import { vi } from 'vitest';
import * as Y from 'yjs';
import {
  blockTextParts, bodyDoc, convertBoxes, createArrow, createTextBlock, deleteEntities, docText, duplicateBlocks, Engine, groupBlocks,
  moveBlocks, reconnectArrow, serialize, setText, ungroupBlocks, type Id,
} from '@dn/engine-core';
import { attach, decodeFrame, encodeFrame } from '../src';

const NET = 'net';

/** 기기 하나에서 하는 일 — 고를 대상은 번호(지금 가진 것 중 id 순으로 나머지), 글자는 짧은 조각 */
export type Action =
  | { k: 'create'; r: number; x: number; y: number; text: string; title: boolean }
  | { k: 'move'; r: number; pick: number; dx: number; dy: number }
  | { k: 'delete'; r: number; pick: number }
  | { k: 'dup'; r: number; pick: number }
  | { k: 'type'; r: number; pick: number; at: number; text: string }
  | { k: 'erase'; r: number; pick: number; at: number; len: number }
  | { k: 'convert'; r: number; pick: number }
  | { k: 'arrow'; r: number; pick: number; pick2: number }
  | { k: 'unarrow'; r: number; pick: number }
  | { k: 'rewire'; r: number; pick: number; pick2: number }
  | { k: 'group'; r: number; pick: number; pick2: number }
  | { k: 'ungroup'; r: number; pick: number }
  | { k: 'undo'; r: number }
  | { k: 'redo'; r: number }
  | { k: 'send'; r: number; pick: number; dup: boolean }
  | { k: 'recv'; r: number; pick: number; dup: boolean }
  | { k: 'drop'; r: number }
  | { k: 'rejoin'; r: number };

interface Replica {
  i: number; engine: Engine; doc: Y.Doc; device: string; online: boolean;
  outbox: Uint8Array[]; inbox: Uint8Array[]; rejected: number;
}

/** 무손실(P-S3) 판정용 — 지움마다 지운 기기의 지우기 직전 Y 상태 */
interface Del { block: Id; state: Uint8Array }
const val = <T,>(r: { ok: boolean; value?: T }) => r.value as T;

/** 키 순서와 무관한 JSON — 기기마다 필드가 들어온 순서가 다르다 (Y 맵 → 엔진) */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** 결정적 난수 · 시각 — 시험 하나(run)마다 처음부터 */
export function determinism(seed = 1) {
  let s = seed >>> 0, t = 1_700_000_000_000;
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0); };
  const rnd = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    const u = new Uint8Array((buf as unknown as ArrayBufferView).buffer, (buf as unknown as ArrayBufferView).byteOffset, (buf as unknown as ArrayBufferView).byteLength);
    for (let i = 0; i < u.length; i++) u[i] = next() & 0xff;
    return buf;
  });
  const now = vi.spyOn(Date, 'now').mockImplementation(() => (t += 7));
  return () => { rnd.mockRestore(); now.mockRestore(); };
}

export class World {
  readonly server = new Y.Doc();
  readonly replicas: Replica[] = [];
  readonly dels: Del[] = [];
  /** 명령 직전 그 기기의 Y 상태 — 지울 때 무엇을 보고 지웠는지 */
  private before: Uint8Array = new Uint8Array();

  constructor(n: number) {
    this.server.clientID = 1;
    const id = 'note-' + n;
    for (let i = 0; i < n; i++) {
      const engine = new Engine({ note: { id, title: i === 0 ? '공유' : '', createdAt: 1, updatedAt: 1 } });
      const doc = new Y.Doc();
      doc.clientID = 100 + i;
      const r: Replica = { i, engine, doc, device: `dev-${i}`, online: true, outbox: [], inbox: [], rejected: 0 };
      if (i === 0) {
        // 처음 상태: 상자 둘 + 화살표 하나 — 시작부터 고칠 것이 있게
        const a = val(createTextBlock(engine, { x: 0, y: 0 }, { body: '첫 문단' })).blockId;
        const b = val(createTextBlock(engine, { x: 400, y: 0 }, { body: '둘째' })).blockId;
        createArrow(engine, { blockId: a, side: 'auto' }, { blockId: b, side: 'auto' });
        attach(engine, doc, { device: r.device, onRemote: (_c, rej) => { r.rejected += rej; } });
        Y.applyUpdate(this.server, Y.encodeStateAsUpdate(doc), NET);
      } else {
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(this.server), NET);
        attach(engine, doc, { device: r.device, onRemote: (_c, rej) => { r.rejected += rej; } });
      }
      doc.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== NET) r.outbox.push(encodeFrame({ t: 'update', update: u })); });
      engine.subscribe((e) => {
        if (e.origin === 'remote' || e.origin === 'load') return;
        for (const op of e.ops) if (op.e === 'block' && op.k === 'delete') this.dels.push({ block: op.id, state: this.before });
      });
      this.replicas.push(r);
    }
  }

  private rep(r: number) { return this.replicas[r % this.replicas.length]!; }
  private pickBlock(e: Engine, n: number): Id | null { const ids = [...e.blocks()].map((b) => b.id).sort(); return ids.length ? ids[n % ids.length]! : null; }
  private pickArrow(e: Engine, n: number): Id | null { const ids = [...e.arrows()].map((a) => a.id).sort(); return ids.length ? ids[n % ids.length]! : null; }

  run(a: Action): void {
    const r = this.rep(a.r), e = r.engine;
    this.before = Y.encodeStateAsUpdate(r.doc);
    switch (a.k) {
      case 'create': createTextBlock(e, { x: a.x * 40, y: a.y * 40 }, a.title ? { kind: 'title', title: a.text } : { body: a.text }); break;
      case 'move': { const b = this.pickBlock(e, a.pick); if (b) moveBlocks(e, [b], a.dx * 16, a.dy * 16); break; }
      case 'delete': { const b = this.pickBlock(e, a.pick); if (b) deleteEntities(e, [b]); break; }
      case 'dup': { const b = this.pickBlock(e, a.pick); if (b) duplicateBlocks(e, [b]); break; }
      case 'type': case 'erase': {
        const b = this.pickBlock(e, a.pick);
        const parts = b ? blockTextParts([...e.contentsOf(b)]) : null;
        const c = parts?.title ?? parts?.bodies[0];
        if (!c) break;
        const t = docText(c.doc);
        const at = a.at % (t.length + 1);
        const next = a.k === 'type' ? t.slice(0, at) + a.text + t.slice(at) : t.slice(0, at) + t.slice(at + a.len);
        // 제목 상자는 한 줄 — 줄바꿈이 든 글은 엔진이 거절한다(로컬 거절은 정상)
        setText(e, c.id, bodyDoc(next));
        break;
      }
      case 'convert': {
        const b = this.pickBlock(e, a.pick);
        const c = b ? blockTextParts([...e.contentsOf(b)]) : null;
        if (b && c) convertBoxes(e, [b], c.title ? 'text' : 'title');
        break;
      }
      case 'arrow': { const x = this.pickBlock(e, a.pick), y = this.pickBlock(e, a.pick2); if (x && y && x !== y) createArrow(e, { blockId: x, side: 'auto' }, { blockId: y, side: 'auto' }); break; }
      case 'unarrow': { const ar = this.pickArrow(e, a.pick); if (ar) deleteEntities(e, [], [ar]); break; }
      case 'rewire': {
        const ar = this.pickArrow(e, a.pick), b = this.pickBlock(e, a.pick2);
        if (ar && b) reconnectArrow(e, ar, a.pick2 % 2 ? 'from' : 'to', { blockId: b, side: 'auto' });
        break;
      }
      case 'group': { const x = this.pickBlock(e, a.pick), y = this.pickBlock(e, a.pick2); if (x && y && x !== y) groupBlocks(e, [x, y]); break; }
      case 'ungroup': { const b = this.pickBlock(e, a.pick); if (b) ungroupBlocks(e, [b]); break; }
      case 'undo': e.undo(); break;
      case 'redo': e.redo(); break;
      case 'send': {
        if (!r.online || !r.outbox.length) break;
        const at = a.pick % r.outbox.length;
        const frame = a.dup ? r.outbox[at]! : r.outbox.splice(at, 1)[0]!;
        this.serverIngest(r, frame);
        break;
      }
      case 'recv': {
        if (!r.online || !r.inbox.length) break;
        const at = a.pick % r.inbox.length;
        const frame = a.dup ? r.inbox[at]! : r.inbox.splice(at, 1)[0]!;
        const f = decodeFrame(frame);
        if (f.t === 'update' || f.t === 'step2') Y.applyUpdate(r.doc, f.update, NET);
        break;
      }
      case 'drop': r.online = false; r.inbox = []; break; // 끊김: 받을 것은 잃는다. 보낼 것은 다시 붙을 때 step 2로
      case 'rejoin': if (!r.online) this.rejoin(r); break;
    }
  }

  /** 서버가 update · step 2를 받음 → 저장하고 다른 온라인 기기에 같은 update를 보냄 */
  private serverIngest(from: Replica, frame: Uint8Array) {
    const f = decodeFrame(frame);
    if (f.t !== 'update' && f.t !== 'step2') return;
    Y.applyUpdate(this.server, f.update, NET);
    const out = encodeFrame({ t: 'update', update: f.update });
    for (const o of this.replicas) if (o !== from && o.online) o.inbox.push(out);
  }

  /** 다시 붙기: step 1/2 양방향 (클라 → 서버에 없는 것, 서버 → 클라에 없는 것) */
  private rejoin(r: Replica) {
    r.online = true;
    r.outbox = [];
    this.serverIngest(r, encodeFrame({ t: 'step2', update: Y.encodeStateAsUpdate(r.doc, Y.encodeStateVector(this.server)) }));
    const f = decodeFrame(encodeFrame({ t: 'step2', update: Y.encodeStateAsUpdate(this.server, Y.encodeStateVector(r.doc)) }));
    if (f.t === 'step2') Y.applyUpdate(r.doc, f.update, NET);
  }

  /** 끝: 모두 다시 붙고 서로 다 주고받는다 */
  settle(): void {
    for (const r of this.replicas) { r.online = false; this.rejoin(r); }
    for (const r of this.replicas) this.rejoin(r);
    for (const r of this.replicas) r.inbox = [];
  }

  /** 비교용 스냅샷 — 기기마다 다른 것(시각 · 충돌 표시 투영 · 높이 자동 블록의 잰 높이 = layout 마스크 13.3 #20)은 뺀다 */
  static masked(e: Engine): string {
    const s = JSON.parse(JSON.stringify(serialize(e))) as { note: Record<string, unknown>; blocks: Record<string, Record<string, unknown>> };
    delete s.note.updatedAt;
    for (const b of Object.values(s.blocks)) { delete b.conflict; if (b.sizing === 'auto') delete b.h; }
    return canonical(s);
  }

  /** P-S4: 이 기기의 엔진 = 이 기기 Y를 빈 엔진에 다시 비춘 것 */
  reprojected(r: Replica): string {
    const d = new Y.Doc();
    d.clientID = 9000 + r.i;
    Y.applyUpdate(d, Y.encodeStateAsUpdate(r.doc), NET);
    const e = new Engine({ note: { id: r.engine.note.id, title: '', createdAt: 1, updatedAt: 1 } });
    attach(e, d, { device: r.device });
    return World.masked(e);
  }

  /** 블록별 내용(콘텐츠 레코드) — 위치 · 크기는 고침이 아니다 (OD-2) */
  static contents(e: Engine): Map<Id, string> {
    const out = new Map<Id, string>();
    for (const b of e.blocks()) out.set(b.id, canonical([...e.contentsOf(b.id)].sort((x, y) => (x.id < y.id ? -1 : 1))));
    return out;
  }

  /**
   * 끝에 살아 있어야 하는 블록 (13.2 R1을 해시가 아니라 내용으로 따로 계산) — 최종 Y에서 묘비만 걷어 낸 그 블록 내용이
   * 그 블록의 모든 지움 d가 지우기 직전에 본 내용과 다르다 = 지운 쪽이 모르는 고침이 최종 결과에 남아 있다.
   * 뒤처진 기기 · 실행 취소로 되돌린 고침 · 같은 필드 동시 쓰기에서 진 고침은 최종 내용이 d가 본 것과 같아 세지 않는다
   */
  private mustSurvive(): Set<Id> {
    const out = new Set<Id>();
    if (!this.dels.length) return out;
    const raw = World.contents(project([Y.encodeStateAsUpdate(this.server)], true));
    for (const [block, ds] of groupBy(this.dels)) {
      const final = raw.get(block);
      if (final !== undefined && ds.every((d) => World.contents(project([d.state])).get(block) !== final)) out.add(block);
    }
    return out;
  }

  /** 하네스가 어려운 경우를 밟는지 — 지운 쪽이 모르는 고침이 있는 블록 수 · 충돌 표시가 남은 블록 수 · 엔진 블록 수 */
  coverage(): { unseenEdits: number; conflicts: number; blocks: number } {
    const e = this.replicas[0]!.engine;
    return { unseenEdits: this.mustSurvive().size, conflicts: [...e.blocks()].filter((x) => (x as { conflict?: unknown }).conflict).length, blocks: [...e.blocks()].length };
  }

  /** P-S3: 살아 있어야 하는데 사라진 블록 */
  lostEdits(): Id[] {
    const must = [...this.mustSurvive()];
    return this.replicas.flatMap((r) => must.filter((id) => !r.engine.getBlock(id)).map((id) => `${id}@기기${r.i}`));
  }
}

/** Y 상태들을 합쳐 빈 엔진에 비춘다 (판정용 — 충돌 표시는 상관없음). raw면 묘비를 걷어 내고 비춘다 */
function project(states: readonly Uint8Array[], raw = false): Engine {
  const d = new Y.Doc();
  d.clientID = 9999;
  for (const u of states) Y.applyUpdate(d, u, NET);
  if (raw) d.transact(() => {
    for (const name of ['blocks', 'contents', 'arrows', 'strokes']) {
      for (const m of d.getMap<unknown>(name).values()) if (m instanceof Y.Map) for (const k of [...m.keys()]) if (k.startsWith('_del:')) m.delete(k);
    }
  });
  const e = new Engine({ note: { id: 'probe', title: '', createdAt: 1, updatedAt: 1 } });
  attach(e, d, { device: 'probe' });
  return e;
}

function groupBy(dels: readonly Del[]): Map<Id, Del[]> {
  const m = new Map<Id, Del[]>();
  for (const d of dels) m.set(d.block, [...(m.get(d.block) ?? []), d]);
  return m;
}
