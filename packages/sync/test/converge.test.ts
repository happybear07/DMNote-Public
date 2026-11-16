// 두 · 세 기기 수렴 속성 시험 (SYNC.md 19.2 · S4 19.5): 무작위 편집 · 네트워크(순서 섞기 · 중복 · 끊김 · 다시 붙기) 뒤 다 주고받으면
// P-S1 모든 기기 엔진이 같다(시각 · 충돌 표시 제외) · P-S2 원격 거절 0 · P-S3 삭제가 모르는 글 고침을 지우지 않는다 · P-S4 엔진 = Y를 다시 비춘 것.
// 커밋마다는 적게, 야간에는 DN_FUZZ_RUNS=10000으로. 반례는 fast-check가 줄여 seed · path와 함께 보여 준다.
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { determinism, World, type Action } from './harness';
import { REGRESSIONS } from './regressions';

const RUNS = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DN_FUZZ_RUNS ?? 120);

const word = fc.constantFrom('가', '나다', ' ', 'AB', '\n', '라마바');
const pick = fc.nat(30);
function actions(n: number) {
  const r = fc.nat(n - 1);
  return fc.oneof(
    { weight: 3, arbitrary: fc.record({ k: fc.constant('create' as const), r, x: fc.integer({ min: -10, max: 30 }), y: fc.integer({ min: -10, max: 30 }), text: word, title: fc.boolean() }) },
    { weight: 2, arbitrary: fc.record({ k: fc.constant('move' as const), r, pick, dx: fc.integer({ min: -8, max: 8 }), dy: fc.integer({ min: -8, max: 8 }) }) },
    { weight: 2, arbitrary: fc.record({ k: fc.constant('delete' as const), r, pick }) },
    { weight: 1, arbitrary: fc.record({ k: fc.constant('dup' as const), r, pick }) },
    { weight: 4, arbitrary: fc.record({ k: fc.constant('type' as const), r, pick, at: fc.nat(20), text: word }) },
    { weight: 2, arbitrary: fc.record({ k: fc.constant('erase' as const), r, pick, at: fc.nat(20), len: fc.integer({ min: 1, max: 4 }) }) },
    { weight: 1, arbitrary: fc.record({ k: fc.constant('convert' as const), r, pick }) },
    { weight: 2, arbitrary: fc.record({ k: fc.constant('arrow' as const), r, pick, pick2: pick }) },
    { weight: 1, arbitrary: fc.record({ k: fc.constant('unarrow' as const), r, pick }) },
    { weight: 1, arbitrary: fc.record({ k: fc.constant('rewire' as const), r, pick, pick2: pick }) },
    { weight: 1, arbitrary: fc.record({ k: fc.constant('group' as const), r, pick, pick2: pick }) },
    { weight: 1, arbitrary: fc.record({ k: fc.constant('ungroup' as const), r, pick }) },
    { weight: 2, arbitrary: fc.record({ k: fc.constant('undo' as const), r }) },
    { weight: 1, arbitrary: fc.record({ k: fc.constant('redo' as const), r }) },
    { weight: 5, arbitrary: fc.record({ k: fc.constant('send' as const), r, pick, dup: fc.boolean() }) },
    { weight: 5, arbitrary: fc.record({ k: fc.constant('recv' as const), r, pick, dup: fc.boolean() }) },
    { weight: 1, arbitrary: fc.record({ k: fc.constant('drop' as const), r }) },
    { weight: 2, arbitrary: fc.record({ k: fc.constant('rejoin' as const), r }) },
  ) as fc.Arbitrary<Action>;
}

/** 명령 열 하나를 돌리고 네 속성을 확인 — 어긋나면 무엇이 다른지 메시지로 */
function check(n: number, list: Action[]): void {
  const restore = determinism(list.length + n);
  try {
    const w = new World(n);
    for (const a of list) w.run(a);
    w.settle();
    const snaps = w.replicas.map((r) => World.masked(r.engine));
    for (let i = 1; i < n; i++) if (snaps[i] !== snaps[0]) throw new Error(`P-S1 수렴 실패: 기기 0 ≠ 기기 ${i}\n${diff(snaps[0]!, snaps[i]!)}`);
    const rejected = w.replicas.map((r) => r.rejected);
    if (rejected.some((x) => x)) throw new Error(`P-S2 원격 거절: ${rejected.join(', ')}`);
    const lost = w.lostEdits();
    if (lost.length) throw new Error(`P-S3 모르는 삭제가 글 고침을 지움: ${lost.join(', ')}`);
    for (const r of w.replicas) {
      const again = w.reprojected(r);
      if (again !== snaps[r.i]) throw new Error(`P-S4 기기 ${r.i} 엔진 ≠ Y 투영\n${diff(snaps[r.i]!, again)}`);
    }
  } finally {
    restore();
  }
}

/** 두 JSON 스냅샷의 첫 차이 근처 */
function diff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `…${a.slice(Math.max(0, i - 160), i + 160)}\n≠\n…${b.slice(Math.max(0, i - 160), i + 160)}`;
}

afterEach(() => { /* determinism()이 각 run 끝에 되돌린다 */ });

describe('하네스가 어려운 경우를 밟는다', () => {
  it('200개 명령 열 중 지운 쪽이 모르는 글 고침 · 충돌 표시가 여러 번 나온다', () => {
    let unseen = 0, conflicts = 0, blocks = 0;
    for (const list of fc.sample(fc.array(actions(2), { minLength: 20, maxLength: 40 }), { numRuns: 200, seed: 7 })) {
      const restore = determinism(list.length);
      try {
        const w = new World(2);
        for (const a of list) w.run(a);
        w.settle();
        const c = w.coverage();
        unseen += c.unseenEdits; conflicts += c.conflicts; blocks += c.blocks;
      } finally { restore(); }
    }
    expect(unseen).toBeGreaterThan(10);
    expect(conflicts).toBeGreaterThan(5);
    expect(blocks / 200).toBeGreaterThan(2);
  }, 60_000);
});

describe('수렴 속성 (P-S1 · P-S2 · P-S3 · P-S4)', () => {
  it('하네스 자체: 아무것도 안 하면 같다', () => check(2, []));

  for (const r of REGRESSIONS) it(`반례 ${r.name} — ${r.why}`, () => check(r.n, r.actions));

  it('두 기기 — 무작위 편집 · 네트워크', () => {
    fc.assert(fc.property(fc.array(actions(2), { maxLength: 40 }), (list) => check(2, list)), { numRuns: RUNS });
  }, 120_000);

  it('세 기기 — 무작위 편집 · 네트워크', () => {
    fc.assert(fc.property(fc.array(actions(3), { maxLength: 40 }), (list) => check(3, list)), { numRuns: Math.ceil(RUNS / 2) });
  }, 120_000);
});
