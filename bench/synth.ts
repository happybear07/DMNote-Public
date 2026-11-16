// 합성 노트 생성기 (ENGINE 14.1, FR-008). 같은 시드 → 같은 스냅샷.
// 엔진 트랜잭션을 거치지 않고 스냅샷을 바로 만든다 — 벤치가 재려는 것이 "저장된 노트 열기"라서.
import { keysBetween, SCHEMA_VERSION, TEXT_SCHEMA, bodyDoc, mergeTitleBody, titleDoc, type Arrow, type Block, type Content, type NoteSnapshot, type Side, type StrokeRecord } from '../packages/engine-core/src/index';

export interface SynthOptions {
  blocks: number;
  seed?: number;
  /** 블록 수 대비 화살표 비율 (기본 0.5) */
  arrowRatio?: number;
  /** 블록 수 대비 자유 스트로크 비율 (기본 1.0, 평균 60점) */
  strokeRatio?: number;
  /** cluster: 4만×4만 영역에 군집 (실제 노트처럼 뭉침) · uniform: 균일 */
  dist?: 'cluster' | 'uniform';
}

export const WORLD = 40_000;

/** mulberry32 — 시드 고정 난수 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const WORDS = ['구조', '분석', '파이프라인', '프롬프트', '스키마', '검증', '캔버스', '블록', '화살표', '요약', 'API', 'note', 'render', 'index', '관계', '수치', '비교', '정리', '결과', '다음'];
const SIDES: Side[] = ['auto', 'auto', 'top', 'right', 'bottom', 'left'];

export function synthNote(opts: SynthOptions): NoteSnapshot {
  const n = opts.blocks;
  const r = rng(opts.seed ?? 1);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const id = () => { let s = ''; for (let i = 0; i < 22; i++) s += ALPHABET[Math.floor(r() * 62)]; return s; };
  const q = (v: number) => Math.round(v * 64) / 64;
  const words = (chars: number) => { let s = ''; while (s.length < chars) s += (s ? ' ' : '') + WORDS[int(0, WORDS.length - 1)]; return s; };

  // 군집: 블록 50개당 중심 1개, 중심 주위 정규분포(σ 1,200px)
  const clusters = Array.from({ length: Math.max(1, Math.round(n / 50)) }, () => ({ x: r() * WORLD, y: r() * WORLD }));
  const gauss = () => { const u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  const zs = keysBetween(null, null, n);
  const blocks: Record<string, Block> = {};
  const contents: Record<string, Content> = {};
  const blockIds: string[] = [];
  for (let i = 0; i < n; i++) {
    let x: number, y: number;
    if (opts.dist === 'uniform') { x = r() * WORLD; y = r() * WORLD; }
    else { const c = clusters[Math.floor(i / 50) % clusters.length]!; x = c.x + gauss() * 1200; y = c.y + gauss() * 1200; }
    const bid = id();
    blockIds.push(bid);
    blocks[bid] = { id: bid, x: q(x), y: q(y), w: int(180, 420), h: int(60, 320), sizing: 'auto', layout: 'flow', z: zs[i]! };
    // 블록당 텍스트 상자 하나 (스키마 v3): 5개 중 1개는 제목 상자, 나머지는 내용 상자(첫 줄 제목3 + 본문, 평균 200자)
    const cid = id();
    contents[cid] = r() < 0.2
      ? { id: cid, blockId: bid, order: keysBetween(null, null, 1)[0]!, type: 'text', role: 'title', doc: titleDoc(words(int(8, 24))) }
      : { id: cid, blockId: bid, order: keysBetween(null, null, 1)[0]!, type: 'text', role: 'body', doc: mergeTitleBody(titleDoc(words(int(8, 24))), bodyDoc(words(int(60, 300)))) };
  }

  // 화살표: 같은 군집 안 가까운 생성 순번끼리 (실제 노트처럼 이웃 연결)
  const arrows: Record<string, Arrow> = {};
  const na = n < 2 ? 0 : Math.round(n * (opts.arrowRatio ?? 0.5));
  for (let i = 0; i < na; i++) {
    const a = int(0, n - 1);
    let b = a + int(1, 5) * (r() < 0.5 ? -1 : 1);
    b = Math.min(n - 1, Math.max(0, b));
    if (b === a) b = a === 0 ? 1 : a - 1;
    const aid = id();
    arrows[aid] = { id: aid, from: { blockId: blockIds[a]!, side: SIDES[int(0, 5)]! }, to: { blockId: blockIds[b]!, side: SIDES[int(0, 5)]! } };
  }

  // 스트로크: 엔진은 아직 해석하지 않고 보존만 한다 (P4). 점열은 문자열 (ENGINE 11.3 · 12.7).
  const strokes: Record<string, StrokeRecord> = {};
  const ns = Math.round(n * (opts.strokeRatio ?? 1));
  for (let i = 0; i < ns; i++) {
    const sid = id();
    const pts: string[] = [];
    let x = r() * WORLD, y = r() * WORLD;
    for (let p = int(30, 90); p > 0; p--) { x += r() * 6 - 3; y += r() * 6 - 3; pts.push(`${q(x)},${q(y)},${(0.3 + r() * 0.7).toFixed(2)}`); }
    strokes[sid] = { id: sid, pts: pts.join(' '), width: 2, color: '#222' };
  }

  const sortRec = <T>(o: Record<string, T>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]!]));
  return {
    schemaVersion: SCHEMA_VERSION,
    engine: { textSchema: TEXT_SCHEMA },
    note: { id: id(), title: `합성 노트 · 블록 ${n}`, createdAt: 0, updatedAt: 0 },
    blocks: sortRec(blocks), contents: sortRec(contents), arrows: sortRec(arrows), strokes: sortRec(strokes),
  };
}
