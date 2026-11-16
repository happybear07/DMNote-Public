// 서버 동기화 프레임 (SYNC.md 10.3): 서버(방 DO) · 클라이언트(RoomClient) 공용, Y를 해석하지 않는 순수 함수.
// 0번대는 y-protocols의 sync 메시지 모양 그대로(0 = sync, 그 안의 0 · 1 · 2 = step 1 · step 2 · update), 100번대가 우리 메시지.
// 정수 · 글 · 바이트 묶음은 lib0 인코딩과 같다 — varuint(7비트씩, 이어지면 0x80) · varstring(utf-8 길이 + 바이트) · varUint8Array(길이 + 바이트).
// 512KB를 넘는 update · step 2는 그 프레임 바이트 전체를 잘라 chunk(103)로 보내고, 받는 쪽은 다 모이면 원래 프레임으로 다시 읽는다.

/** 프로토콜 버전 — hello · welcome · 서브프로토콜 이름 */
export const PROTO = 1;
export const SUBPROTOCOL = `dn-sync.${PROTO}`;
/** 프레임 상한 (Workers WebSocket 메시지 상한 1MiB 가정의 반) */
export const FRAME_MAX = 512 * 1024;
/** 청크 하나에 싣는 바이트 — 머리(종류 · id · 번호)를 빼고도 FRAME_MAX 안 */
const CHUNK_BODY = FRAME_MAX - 256;
/** 청크가 다 모이기를 기다리는 시간 (17절 — 넘으면 버리고 chunk-timeout) */
export const CHUNK_TIMEOUT_MS = 60_000;

/** 소켓 종료 코드 (API 5.3 + 10.3) */
export const CLOSE = {
  auth: 4401, revoked: 4403, replaced: 4409, deleted: 4410, tooLarge: 4413, outdated: 4426,
} as const;

export type ErrorCode = 'bad-update' | 'doc-too-large' | 'frame-too-large' | 'chunk-timeout' | 'quota' | 'rate';

export type Frame =
  | { t: 'step1'; sv: Uint8Array }
  | { t: 'step2'; update: Uint8Array }
  | { t: 'update'; update: Uint8Array }
  | { t: 'awareness' } // 쓰지 않는다 — 받으면 무시 (같은 사용자 기기뿐, 커서 공유는 범위 밖)
  | { t: 'ack'; seq: number }
  | { t: 'error'; code: ErrorCode | string }
  | { t: 'auth'; ticket: string }
  | { t: 'chunk'; id: string; idx: number; total: number; bytes: Uint8Array }
  | { t: 'doc-changed'; docId: string; serverSeq: number }
  | { t: 'device-revoked' }
  | { t: 'hello'; proto: number; schema: number; client: string; deviceId: string }
  | { t: 'welcome'; proto: number; serverSeq: number; schemaHint: number; minClient: string }
  | { t: 'synced' };

const SYNC = 0, AWARENESS = 1;
const SUB = { step1: 0, step2: 1, update: 2 } as const;
const TAG = {
  ack: 100, error: 101, auth: 102, chunk: 103, 'doc-changed': 104, 'device-revoked': 105, hello: 110, welcome: 111, synced: 112,
} as const;

// ───────── lib0 모양 인코딩 ─────────
class Writer {
  private buf = new Uint8Array(64);
  private n = 0;
  private room(k: number) {
    if (this.n + k <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }
  uint(v: number) {
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`varuint: ${v}`);
    this.room(8);
    while (v > 0x7f) { this.buf[this.n++] = 0x80 | (v % 0x80); v = Math.floor(v / 0x80); }
    this.buf[this.n++] = v;
  }
  bytes(b: Uint8Array) { this.uint(b.length); this.room(b.length); this.buf.set(b, this.n); this.n += b.length; }
  str(s: string) { this.bytes(new TextEncoder().encode(s)); }
  done() { return this.buf.slice(0, this.n); }
}

class Reader {
  private i = 0;
  constructor(private readonly b: Uint8Array) {}
  uint(): number {
    let v = 0, mul = 1;
    for (;;) {
      if (this.i >= this.b.length) throw new RangeError('프레임이 중간에 끊김');
      const x = this.b[this.i++]!;
      v += (x & 0x7f) * mul;
      if (!(x & 0x80)) break;
      mul *= 0x80;
      if (mul > 2 ** 53) throw new RangeError('varuint가 너무 김');
    }
    return v;
  }
  bytes(): Uint8Array {
    const k = this.uint();
    if (this.i + k > this.b.length) throw new RangeError('프레임이 중간에 끊김');
    const out = this.b.slice(this.i, this.i + k);
    this.i += k;
    return out;
  }
  str() { return new TextDecoder('utf-8', { fatal: true }).decode(this.bytes()); }
  end() { if (this.i !== this.b.length) throw new RangeError('프레임 뒤에 남는 바이트'); }
}

/** 프레임 하나를 바이트로 */
export function encodeFrame(f: Frame): Uint8Array {
  const w = new Writer();
  switch (f.t) {
    case 'step1': w.uint(SYNC); w.uint(SUB.step1); w.bytes(f.sv); break;
    case 'step2': w.uint(SYNC); w.uint(SUB.step2); w.bytes(f.update); break;
    case 'update': w.uint(SYNC); w.uint(SUB.update); w.bytes(f.update); break;
    case 'awareness': w.uint(AWARENESS); break;
    case 'ack': w.uint(TAG.ack); w.uint(f.seq); break;
    case 'error': w.uint(TAG.error); w.str(f.code); break;
    case 'auth': w.uint(TAG.auth); w.str(f.ticket); break;
    case 'chunk': w.uint(TAG.chunk); w.str(f.id); w.uint(f.idx); w.uint(f.total); w.bytes(f.bytes); break;
    case 'doc-changed': w.uint(TAG['doc-changed']); w.str(f.docId); w.uint(f.serverSeq); break;
    case 'device-revoked': w.uint(TAG['device-revoked']); break;
    case 'hello': w.uint(TAG.hello); w.uint(f.proto); w.uint(f.schema); w.str(f.client); w.str(f.deviceId); break;
    case 'welcome': w.uint(TAG.welcome); w.uint(f.proto); w.uint(f.serverSeq); w.uint(f.schemaHint); w.str(f.minClient); break;
    case 'synced': w.uint(TAG.synced); break;
  }
  return w.done();
}

/** 바이트를 프레임으로 — 모르는 종류 · 깨진 프레임은 예외 (받는 쪽이 bad-update · 연결 끊기로 처리) */
export function decodeFrame(b: Uint8Array): Frame {
  const r = new Reader(b);
  const kind = r.uint();
  let f: Frame;
  if (kind === SYNC) {
    const sub = r.uint();
    const payload = r.bytes();
    if (sub === SUB.step1) f = { t: 'step1', sv: payload };
    else if (sub === SUB.step2) f = { t: 'step2', update: payload };
    else if (sub === SUB.update) f = { t: 'update', update: payload };
    else throw new RangeError(`모르는 sync 종류 ${sub}`);
  } else if (kind === AWARENESS) {
    return { t: 'awareness' }; // 내용은 읽지 않는다
  } else if (kind === TAG.ack) f = { t: 'ack', seq: r.uint() };
  else if (kind === TAG.error) f = { t: 'error', code: r.str() };
  else if (kind === TAG.auth) f = { t: 'auth', ticket: r.str() };
  else if (kind === TAG.chunk) { const id = r.str(), idx = r.uint(), total = r.uint(); f = { t: 'chunk', id, idx, total, bytes: r.bytes() }; }
  else if (kind === TAG['doc-changed']) { const docId = r.str(); f = { t: 'doc-changed', docId, serverSeq: r.uint() }; }
  else if (kind === TAG['device-revoked']) f = { t: 'device-revoked' };
  else if (kind === TAG.hello) { const proto = r.uint(), schema = r.uint(), client = r.str(); f = { t: 'hello', proto, schema, client, deviceId: r.str() }; }
  else if (kind === TAG.welcome) { const proto = r.uint(), serverSeq = r.uint(), schemaHint = r.uint(); f = { t: 'welcome', proto, serverSeq, schemaHint, minClient: r.str() }; }
  else if (kind === TAG.synced) f = { t: 'synced' };
  else throw new RangeError(`모르는 프레임 종류 ${kind}`);
  r.end();
  return f;
}

/** 보낼 프레임 — FRAME_MAX를 넘으면 chunk 프레임 여럿으로 (id는 이 소켓에서 겹치지 않게 부르는 쪽이 준다) */
export function frameOut(f: Frame, chunkId: () => string, max = FRAME_MAX): Uint8Array[] {
  const whole = encodeFrame(f);
  if (whole.length <= max) return [whole];
  if (f.t !== 'update' && f.t !== 'step2') throw new RangeError(`${f.t} 프레임이 ${whole.length}바이트 — 청크는 update · step 2만`);
  const body = Math.min(CHUNK_BODY, max - 256);
  const total = Math.ceil(whole.length / body);
  const id = chunkId();
  const out: Uint8Array[] = [];
  for (let idx = 0; idx < total; idx++) out.push(encodeFrame({ t: 'chunk', id, idx, total, bytes: whole.subarray(idx * body, (idx + 1) * body) }));
  return out;
}

/** 받은 chunk를 모은다 — 다 모이면 원래 프레임, 아직이면 null. 오래된 미완성은 sweep으로 버린다 */
export class ChunkAssembler {
  private parts = new Map<string, { total: number; got: Map<number, Uint8Array>; at: number }>();
  constructor(private readonly timeoutMs = CHUNK_TIMEOUT_MS) {}

  push(c: Extract<Frame, { t: 'chunk' }>, now = Date.now()): Frame | null {
    if (c.total < 1 || c.idx >= c.total) throw new RangeError('청크 번호가 맞지 않음');
    let p = this.parts.get(c.id);
    if (!p) { p = { total: c.total, got: new Map(), at: now }; this.parts.set(c.id, p); }
    if (p.total !== c.total) throw new RangeError('청크 수가 중간에 바뀜');
    p.got.set(c.idx, c.bytes); // 같은 번호가 다시 오면 덮어쓴다(중복 전송)
    if (p.got.size < p.total) return null;
    this.parts.delete(c.id);
    let len = 0;
    for (let i = 0; i < p.total; i++) len += p.got.get(i)!.length;
    const whole = new Uint8Array(len);
    for (let i = 0, at = 0; i < p.total; i++) { const b = p.got.get(i)!; whole.set(b, at); at += b.length; }
    const f = decodeFrame(whole);
    if (f.t !== 'update' && f.t !== 'step2') throw new RangeError(`청크 안에 ${f.t} 프레임`);
    return f;
  }

  /** 기다리다 지난 미완성 id — 버리고 돌려준다 (서버는 chunk-timeout을 보냄) */
  sweep(now = Date.now()): string[] {
    const out: string[] = [];
    for (const [id, p] of this.parts) if (now - p.at > this.timeoutMs) { this.parts.delete(id); out.push(id); }
    return out;
  }

  get pending(): number { return this.parts.size; }
}
