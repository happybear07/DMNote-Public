// 두 시점 비교 (FR-135 변경 이력): 블록 단위 — 한쪽에만 있는 블록, 둘 다 있지만 내용(글 · 표 · 그래프 …)이 다른 블록.
// 자리 · 크기 · 상자 안 배치만 바뀐 것은 고침으로 치지 않는다(읽는 사람에게 중요한 것은 내용).
import type { Engine } from './engine';
import { isBlockEnd, type Anchor, type Arrow, type Id } from './model';

export interface BlockDiff { readonly onlyA: Id[]; readonly onlyB: Id[]; readonly changed: Id[]; /** 한쪽에만 있는 연결(화살표) 수 */ readonly arrowsA: number; readonly arrowsB: number }

const LAYOUT = new Set(['id', 'blockId', 'order', 'frame', 'ai']);

/** 키 순서와 무관한 직렬화 — 저장본에서 읽은 것과 고쳐 만든 것의 키 순서가 달라도 같은 값이면 같게 */
function stable(v: unknown, top = false): string {
  // 댓글 표시(comment 마크)는 내용이 아니다
  if (Array.isArray(v)) return `[${v.filter((x) => !(x && typeof x === 'object' && (x as { type?: unknown }).type === 'comment')).map((x) => stable(x)).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const noMarks = (k: string) => k === 'marks' && Array.isArray(o[k]) && (o[k] as { type?: unknown }[]).every((m) => m?.type === 'comment'); // 댓글만 있는 marks = 없음
    return `{${Object.keys(o).filter((k) => !(top && LAYOUT.has(k)) && o[k] !== undefined && !noMarks(k)).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** 블록의 의미 필드 (v6) — 노드 종류 · 상태 · 역할 … 이 바뀌면 고침 */
const MEANING = ['nodeKind', 'attachTo', 'status', 'emphasis', 'hedge', 'role', 'speaker', 'owner', 'time', 'start', 'end', 'due'] as const;

/** 블록 내용 표식: 콘텐츠의 id · 위치 정보를 뺀 값 (콘텐츠 순서대로) + 블록 색 · 글자 모양 + 의미 */
function contentSig(e: Engine, id: Id): string {
  const b = e.getBlock(id);
  const meaning = b ? MEANING.map((k) => stable(b[k])).join(',') : '';
  return `${e.contentsOf(id).map((c) => stable(c, true)).join('|')}#${b?.style?.color ?? ''}#${b?.fontScale ?? ''}#${b?.textColor ?? ''}#${b?.align ?? ''}#${b?.lineHeight ?? ''}#${b?.indent ?? ''}#${b?.pageBreak ? 1 : ''}#${meaning}`;
}

/** a(예: 지난 버전) ↔ b(예: 지금) */
export function diffBlocks(a: Engine, b: Engine): BlockDiff {
  const onlyA: Id[] = [], onlyB: Id[] = [], changed: Id[] = [];
  for (const x of a.blocks()) {
    if (!b.getBlock(x.id)) onlyA.push(x.id);
    else if (contentSig(a, x.id) !== contentSig(b, x.id)) changed.push(x.id);
  }
  for (const y of b.blocks()) if (!a.getBlock(y.id)) onlyB.push(y.id);
  // 화살표: 양 끝 + 관계 종류 (v6) — 관계를 바꾸면 한쪽에만 있는 연결로 센다
  const end = (an: Anchor) => (isBlockEnd(an) ? an.blockId : `@${Math.round(an.point.x)},${Math.round(an.point.y)}`); // 빈 곳의 점 끝은 자리로
  const key = (x: Arrow) => `${end(x.from)}>${end(x.to)}:${x.relation ?? ''}`;
  const ka = new Set([...a.arrows()].map(key)), kb = new Set([...b.arrows()].map(key));
  return { onlyA, onlyB, changed, arrowsA: [...ka].filter((k) => !kb.has(k)).length, arrowsB: [...kb].filter((k) => !ka.has(k)).length };
}
