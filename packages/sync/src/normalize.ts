// 다른 곳에서 온 엔티티를 엔진 규칙에 맞게 편다 (SYNC.md 13.4 normalize의 지금 구현분).
// 동시 편집이 합쳐지면 어느 기기도 만들지 않은 상태가 나올 수 있다 — 예: 한쪽은 내용 상자를 제목 상자로 바꾸고 다른 쪽은 그 상자에 문단을 더함.
// 이런 값을 그대로 넣으면 엔진 불변식(I2 · I6 · I10)이 트랜잭션을 통째로 되돌려, 함께 온 다른 변경까지 버려졌다.
// 모든 기기가 같은 Y에서 같은 규칙으로 펴므로 엔진끼리는 같아진다(Y는 그대로 둔다 — 그 상자를 다음에 고치면 편 값이 Y에 쓰인다).
// undefined = 엔진에 넣지 않는다(끊긴 참조처럼 보이지 않게만 한다).
import { defaultTextCodec, endBlock, isFiniteRect, isOrderKey, keyBetween, MIN_SIZE, toTitleDoc, validEnd, type EntityKind, type TextDoc } from '@dn/engine-core';

type Rec = Record<string, unknown>;

export function fitIncoming(kind: EntityKind, r: Rec): Rec | undefined {
  if (kind === 'block') {
    // 블록은 거르지 않는다(거르면 엔진에서 지워져 그 안 콘텐츠까지 사라진다) — 맞지 않는 값만 고친다 (I6 · I7)
    let out = r;
    const w = Number(r.w), h = Number(r.h);
    if (!(w >= MIN_SIZE) || !(h >= MIN_SIZE)) out = { ...out, w: w >= MIN_SIZE ? w : MIN_SIZE, h: h >= MIN_SIZE ? h : MIN_SIZE };
    if (!isFiniteRect(out as never)) out = { ...out, x: 0, y: 0, w: MIN_SIZE * 10, h: MIN_SIZE * 4 };
    if (!isOrderKey(out.z)) out = { ...out, z: keyBetween(null, null) };
    return out;
  }
  if (kind === 'content') {
    if (!isOrderKey(r.order)) return undefined;
    // I8: 스키마에 안 맞는 글(동시 구조 편집) — 맞는 블록은 두고 안 맞는 블록만 같은 글자의 문단으로 (코덱이 고칠 줄 알 때)
    const codec = defaultTextCodec();
    if (r.type === 'text' && r.doc && codec?.repair && codec.validate(r.doc)) r = { ...r, doc: codec.repair(r.doc) };
    // I10: 제목 상자는 문단 하나 — 여러 줄이면 글자 · 서식은 두고 한 줄로 편다
    if (r.type === 'text' && r.role === 'title' && r.doc && typeof r.doc === 'object') {
      const kids = (r.doc as TextDoc).content ?? [];
      if (kids.length !== 1 || kids[0]!.type !== 'paragraph') return { ...r, doc: toTitleDoc(r.doc as TextDoc) };
    }
    return r;
  }
  if (kind === 'arrow') {
    // I2: 자기 자신을 잇는 화살표 (두 기기가 각자 끝점을 같은 상자로 옮긴 경우). 끝이 비어 있으면(프레임 일부만 받아 Yjs가 새 끝은 보류하고
    // 옛 끝 삭제만 적용한 순간 — 반례 s4-03) 들이지 않는다 — 새 끝이 들어오면 그 화살표를 다시 맞춘다
    // 끝은 상자 id 또는 빈 곳의 점(11/09) — 둘 다 아니면(비어 있음) 들이지 않는다. 같은 상자를 잇는 것만 막는다
    if (!validEnd(r.from) || !validEnd(r.to)) return undefined;
    const from = endBlock(r.from), to = endBlock(r.to);
    if (from && from === to) return undefined;
    return r;
  }
  if (kind === 'stroke') {
    // 부모가 비어 있는 획(위와 같은 순간)은 들이지 않는다
    const p = r.parent as { kind?: unknown } | undefined;
    if (p?.kind !== 'layer' && p?.kind !== 'content') return undefined;
    return r;
  }
  return r;
}
