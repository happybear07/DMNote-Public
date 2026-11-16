// 서버 동기화 프레임 (SYNC.md 10.3 · 19.1): 인코딩 왕복 · lib0 모양 정수 · 깨진 프레임 · 512KB 청크 나누기 · 모으기 · 상태 우선순위
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ChunkAssembler, decodeFrame, docStatus, encodeFrame, FRAME_MAX, frameOut, overallStatus, type Frame } from '../src';

const ALL: Frame[] = [
  { t: 'step1', sv: new Uint8Array([1, 2, 3]) },
  { t: 'step2', update: new Uint8Array([0, 0]) },
  { t: 'update', update: new Uint8Array(300).fill(7) },
  { t: 'ack', seq: 0 },
  { t: 'ack', seq: 2 ** 40 + 5 },
  { t: 'error', code: 'bad-update' },
  { t: 'auth', ticket: 'eyJ1Ijoi.서명' },
  { t: 'chunk', id: 'c1', idx: 2, total: 3, bytes: new Uint8Array([9]) },
  { t: 'doc-changed', docId: 'n-1', serverSeq: 77 },
  { t: 'device-revoked' },
  { t: 'hello', proto: 1, schema: 6, client: '0.1.0', deviceId: '기기-가' },
  { t: 'welcome', proto: 1, serverSeq: 12, schemaHint: 6, minClient: '0.1.0' },
  { t: 'synced' },
];

describe('프레임', () => {
  it('모든 종류가 인코딩 → 디코딩 왕복', () => {
    for (const f of ALL) expect(decodeFrame(encodeFrame(f))).toEqual(f);
  });

  it('정수는 lib0 varuint 모양 (7비트씩, 이어지면 0x80)', () => {
    expect([...encodeFrame({ t: 'ack', seq: 300 })]).toEqual([100, 0xac, 0x02]);
    expect([...encodeFrame({ t: 'ack', seq: 127 })]).toEqual([100, 0x7f]);
    // y-protocols sync step 1 모양: [0 = sync, 0 = step 1, 길이, 상태 벡터…]
    const sv = Y.encodeStateVector(new Y.Doc());
    expect([...encodeFrame({ t: 'step1', sv })]).toEqual([0, 0, sv.length, ...sv]);
  });

  it('깨진 · 모르는 · 남는 바이트 프레임은 예외', () => {
    expect(() => decodeFrame(new Uint8Array([0, 1, 5, 1]))).toThrow(); // 길이 5인데 1바이트
    expect(() => decodeFrame(new Uint8Array([99]))).toThrow();
    expect(() => decodeFrame(new Uint8Array([0, 9, 0]))).toThrow();
    expect(() => decodeFrame(new Uint8Array([100, 1, 0]))).toThrow();
    expect(() => decodeFrame(new Uint8Array([101, 2, 0xff, 0xfe]))).toThrow(); // utf-8 아님
  });

  it('awareness는 내용을 읽지 않고 무시 표시만', () => {
    expect(decodeFrame(new Uint8Array([1, 5, 1, 2, 3]))).toEqual({ t: 'awareness' });
  });
});

describe('청크 (512KB 넘는 update · step 2)', () => {
  const big = (n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31) & 0xff; return b; };
  let k = 0;
  // 큰 배열은 toEqual이 느리다 — 종류 · 길이 · 바이트만 비교
  const same = (f: Frame | null, t: string, b: Uint8Array) => !!f && f.t === t && 'update' in f && f.update.length === b.length && f.update.every((x, i) => x === b[i]);
  const id = () => `c${++k}`;

  it('상한 이하는 그대로 한 프레임', () => {
    const out = frameOut({ t: 'update', update: big(1000) }, id);
    expect(out).toHaveLength(1);
    expect(decodeFrame(out[0]!)).toEqual({ t: 'update', update: big(1000) });
  });

  it('1.2MB step 2 → 청크 3개, 모두 상한 이하, 순서가 섞이고 겹쳐 와도 원래 프레임', () => {
    const update = big(1_200_000);
    const out = frameOut({ t: 'step2', update }, id);
    expect(out.length).toBe(3);
    for (const b of out) expect(b.length).toBeLessThanOrEqual(FRAME_MAX);
    const frames = out.map((b) => decodeFrame(b) as Extract<Frame, { t: 'chunk' }>);
    const asm = new ChunkAssembler();
    expect(asm.push(frames[2]!)).toBeNull();
    expect(asm.push(frames[0]!)).toBeNull();
    expect(asm.push(frames[0]!)).toBeNull(); // 중복
    expect(same(asm.push(frames[1]!), 'step2', update)).toBe(true);
    expect(asm.pending).toBe(0);
  });

  it('상한을 작게 줘도 동작 (DO 한도가 가정보다 작을 때)', () => {
    const update = big(5000);
    const out = frameOut({ t: 'update', update }, id, 1024);
    expect(out.length).toBeGreaterThan(5);
    for (const b of out) expect(b.length).toBeLessThanOrEqual(1024);
    const asm = new ChunkAssembler();
    let last: Frame | null = null;
    for (const b of out) last = asm.push(decodeFrame(b) as Extract<Frame, { t: 'chunk' }>);
    expect(same(last, 'update', update)).toBe(true);
  });

  it('update · step 2가 아닌 큰 프레임은 청크로 못 보냄', () => {
    expect(() => frameOut({ t: 'auth', ticket: 'x'.repeat(2000) }, id, 1024)).toThrow();
  });

  it('60초 넘게 미완성이면 sweep이 버린다 (chunk-timeout)', () => {
    const out = frameOut({ t: 'update', update: big(3000) }, id, 1024);
    const asm = new ChunkAssembler(60_000);
    asm.push(decodeFrame(out[0]!) as Extract<Frame, { t: 'chunk' }>, 1000);
    expect(asm.sweep(30_000)).toEqual([]);
    expect(asm.sweep(62_000)).toHaveLength(1);
    expect(asm.pending).toBe(0);
  });
});

describe('동기화 상태 (12.9)', () => {
  it('문서 상태: 끔 > 오류 > 충돌 > 대기 > 동기화됨', () => {
    const base = { enabled: true, conflicts: 0, unsynced: false, caughtUp: true };
    expect(docStatus(base)).toBe('synced');
    expect(docStatus({ ...base, unsynced: true })).toBe('pending');
    expect(docStatus({ ...base, caughtUp: false })).toBe('pending');
    expect(docStatus({ ...base, unsynced: true, conflicts: 2 })).toBe('conflict');
    expect(docStatus({ ...base, conflicts: 2, error: 'network' })).toBe('error');
    expect(docStatus({ ...base, enabled: false, error: 'network' })).toBe('off');
  });

  it('앱 전체 = 가장 높은 것, 문서가 없으면 off', () => {
    expect(overallStatus([])).toBe('off');
    expect(overallStatus([{ status: 'synced' }, { status: 'pending' }])).toBe('pending');
    expect(overallStatus([{ status: 'conflict' }, { status: 'error' }, { status: 'synced' }])).toBe('error');
  });
});
