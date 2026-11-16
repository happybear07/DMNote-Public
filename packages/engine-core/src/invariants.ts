// 커밋 직전 불변식 검사 (ENGINE 3.7). 엔진 상태는 읽기 전용 뷰로만 받는다.
import { isFiniteRect, MIN_SIZE } from './geom';
import { isBlockEnd, validEnd, type Arrow, type Block, type Content, type EntityKind, type Id, type TextCodec, type TextContent } from './model';
import type { Op } from './ops';
import { isOrderKey } from './order';

export interface InvariantView {
  readonly blocksMap: ReadonlyMap<Id, Block>;
  readonly contentsByBlock: ReadonlyMap<Id, ReadonlySet<Id>>;
  readonly arrowsByBlock: ReadonlyMap<Id, ReadonlySet<Id>>;
  readonly codec: TextCodec | null;
  mapOf(e: EntityKind): ReadonlyMap<Id, unknown>;
}

/** 커밋 직전 검사 — 변경된 엔티티와 그 이웃만 (ENGINE 3.7). 위반이면 이유 문자열. */
export function validateOps(ops: readonly Op[], s: InvariantView): string | null {
  for (const op of ops) {
    if (op.k === 'set' && op.e === 'note') continue;
    const e = op.e as EntityKind;
    if (op.k === 'delete') {
      if (e === 'block') {
        if (s.blocksMap.has(op.id)) continue;
        if (s.contentsByBlock.get(op.id)?.size) return `I1: 삭제된 블록 ${op.id}에 콘텐츠가 남음`;
        if (s.arrowsByBlock.get(op.id)?.size) return `I2: 삭제된 블록 ${op.id}에 화살표가 남음`;
      }
      continue;
    }
    const v = s.mapOf(e).get(op.id);
    if (!v) continue; // 같은 트랜잭션에서 이후 삭제됨
    if (e === 'block') {
      const b = v as Block;
      if (!isFiniteRect(b)) return `I6: 블록 ${b.id} 좌표가 범위를 벗어남`;
      if (b.w < MIN_SIZE || b.h < MIN_SIZE) return `I6: 블록 ${b.id} 크기가 최소값보다 작음`;
      if (!isOrderKey(b.z)) return `I7: 블록 ${b.id} z 키 형식 오류`;
    } else if (e === 'content') {
      const c = v as Content;
      if (!s.blocksMap.has(c.blockId)) return `I1: 콘텐츠 ${c.id}의 블록 ${c.blockId} 없음`;
      if (op.k !== 'text' && c.type === 'text' && s.codec) {
        const why = s.codec.validate((c as TextContent).doc);
        if (why) return `I8: 콘텐츠 ${c.id} 텍스트 문서 오류 — ${why}`;
      }
      if (!isOrderKey(c.order)) return `I7: 콘텐츠 ${c.id} order 키 형식 오류`;
      // I10: 제목 상자는 문단 하나 (스키마 v3) — 텍스트 스텝으로 줄이 나뉘어도 여기서 막힌다
      if (c.type === 'text' && (c as TextContent).role === 'title') {
        const kids = (c as TextContent).doc.content;
        if (kids.length !== 1 || kids[0]!.type !== 'paragraph') return `I10: 제목 상자 ${c.id}은 문단 하나여야 함`;
      }
    } else if (e === 'arrow') {
      const a = v as Arrow;
      // 끝은 살아 있는 상자 또는 빈 곳의 점 (11/09)
      if (![a.from, a.to].every((an) => validEnd(an) && (!isBlockEnd(an) || s.blocksMap.has(an.blockId)))) return `I2: 화살표 ${a.id}의 블록 없음`;
      if (isBlockEnd(a.from) && isBlockEnd(a.to) && a.from.blockId === a.to.blockId) return `I2: 화살표 ${a.id}가 같은 블록을 잇는다`;
    }
  }
  return null;
}
