// 발표 모드 장면 나누기 (GAP #21 — 노션 발표 2026-03 · Ctrl+Alt+P): 문서 뷰와 같은 읽는 차례(documentOrder)를 장면으로 나눈다.
// 제목 상자 · 제목 1로 시작하는 상자 · 쪽 나눔에서 새 장면(노션은 구분선 — 이 앱은 제목 · 쪽이 구역을 나눈다).
// 그렇게 나뉘지 않으면(장면 하나) 묶음 · 흐름 단위마다, 그래도 하나면 상자마다. 빈 노트는 장면 없음.
import type { Engine } from './engine';
import { isTextContent, type Block, type Id } from './model';
import { docUnits, documentOrder } from './flow';

const startsSection = (engine: Engine, b: Block): boolean => {
  if (b.pageBreak) return true;
  return engine.contentsOf(b.id).some((c) => isTextContent(c) && (c.role === 'title' || (c.doc.content[0]?.type === 'heading' && c.doc.content[0]?.attrs?.level === 1)));
};

/** 장면마다 블록 id들 (읽는 차례) */
export function presentSlides(engine: Engine): Id[][] {
  const order = documentOrder(engine).map((i) => i.block);
  if (!order.length) return [];
  const slides: Id[][] = [];
  for (const b of order) {
    if (!slides.length || (startsSection(engine, b) && slides.at(-1)!.length)) slides.push([]);
    slides.at(-1)!.push(b.id);
  }
  if (slides.length > 1) return slides;
  const units = docUnits(engine);
  if (units.length > 1) {
    const rank = new Map(order.map((b, i) => [b.id, i]));
    return units.map((u) => u.map((b) => b.id).sort((a, b) => rank.get(a)! - rank.get(b)!)).sort((a, b) => rank.get(a[0]!)! - rank.get(b[0]!)!);
  }
  return order.map((b) => [b.id]);
}
