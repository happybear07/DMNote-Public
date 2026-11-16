// 카드 그리기 (노트형 정리 NS-02, engine-core cards.ts): 묶음 테두리가 '카드'인 묶음을 밑층(under, 상자 DOM 아래)에
// 둥근 바탕 · 테두리 · 머리(번호 · 이름) · 머리 밑줄로 그린다. 고르기 · 손잡이는 위층(groups-view.ts drawGroups)이 카드 틀을 따라 그린다.
// 글이 늘어 다른 카드와 겹치면 테두리를 경고색 점선으로 — 앱의 '카드 다시 맞추기'(겹친 카드만 아래로)를 누를 때까지 다른 카드는 그대로(ADR-0014).
import { CARD_HEAD, CARD_PAD, cardFrame, isCardGroup, noteCards, type Id, type Rect } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { roundRect } from './draw-helpers';

/** 월드 사각형 → 화면 사각형 */
function toScreenRect(view: CanvasView, r: Rect): Rect {
  const a = view.toScreen(r), z = view.cam.zoom;
  return { x: a.x, y: a.y, w: r.w * z, h: r.h * z };
}

/** 카드 묶음이면 카드 틀(화면 px), 아니면 null — 묶음 화면(groups-view)이 테두리 · 맞히기에 쓴다 */
export function cardScreenFrame(view: CanvasView, gid: Id, union: Rect): Rect | null {
  return isCardGroup(view.engine, gid) ? toScreenRect(view, cardFrame(union)) : null;
}

/** 카드 머리 자리(화면 px) — 누르면 카드째 고른다 */
export function cardHeadRect(view: CanvasView, frame: Rect): Rect {
  const z = view.cam.zoom;
  return { x: frame.x, y: frame.y, w: frame.w, h: (CARD_PAD + CARD_HEAD - 6) * z };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function drawCards(view: CanvasView, ctx: CanvasRenderingContext2D): void {
  const cards = noteCards(view.engine, (id) => view.previewRect(id) ?? view.engine.blockRect(id));
  if (!cards.length) return;
  const z = view.cam.zoom, t = view.theme;
  const groups = view.engine.note.groups ?? {};
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]!, r = toScreenRect(view, c.frame);
    if (r.x > view.size.w || r.y > view.size.h || r.x + r.w < 0 || r.y + r.h < 0) continue;
    const meta = groups[c.id];
    const clash = cards.some((o, j) => j !== i && overlaps(c.frame, o.frame));
    ctx.setLineDash(clash ? [6, 4] : []);
    // 바탕은 고른 색만 — 없으면 비워 캔버스 무늬가 비치게 (상자와 같게, 알파 10/31)
    roundRect(ctx, r.x, r.y, r.w, r.h, 12 * z);
    const tone = meta?.tone && t.blocks[meta.tone];
    if (tone) { ctx.fillStyle = tone; ctx.fill(); }
    ctx.lineWidth = clash ? 1.5 : 1;
    ctx.strokeStyle = clash ? t.tones.orange : t.line;
    ctx.stroke();
    ctx.setLineDash([]);
    if (z < 0.3) continue;
    // 머리: 번호(강조색) + 이름, 아래 밑줄 — 이름은 붙인 이름만(없으면 번호만 · 첫 제목을 또 쓰지 않는다)
    const name = meta?.name?.trim() ?? '';
    const x0 = r.x + CARD_PAD * z, mid = r.y + (CARD_PAD + 14) * z;
    ctx.font = `700 ${15 * z}px Pretendard, system-ui, sans-serif`;
    let x = x0;
    if (c.number) {
      const num = `${c.number}.`;
      ctx.fillStyle = t.accent;
      ctx.fillText(num, x, mid);
      x += ctx.measureText(num).width + 6 * z;
    }
    if (name) {
      ctx.fillStyle = t.text;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, r.y, r.x + r.w - CARD_PAD * z - x, (CARD_PAD + CARD_HEAD) * z); ctx.clip();
      ctx.fillText(name, x, mid);
      ctx.restore();
    }
    // 머리 밑줄 (구분선 세 번째 층 — 따로 저장하지 않는다)
    const ly = r.y + (CARD_PAD + 28) * z;
    ctx.beginPath();
    ctx.moveTo(x0, ly);
    ctx.lineTo(r.x + r.w - CARD_PAD * z, ly);
    ctx.lineWidth = Math.max(1, 1.2 * z);
    ctx.strokeStyle = t.line;
    ctx.stroke();
  }
  ctx.restore();
}
