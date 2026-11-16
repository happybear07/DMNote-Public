// 캔버스 접근성 (FR-150): 화면 읽기 프로그램용 역할 · 이름, 키보드로 블록 사이 이동(Tab · Shift+Tab — 읽는 순서), 고른 블록 알리기.
// 캔버스는 화살표를 Canvas2D로 그려 읽히지 않으므로, 블록 이름에 연결 수를 붙인다. 마지막 블록에서 Tab이면 캔버스 밖으로(갇히지 않게).
import { blockTextParts, createArrow, deleteEntities, endBlock, readingOrder, textLines, type Block, type Id } from '@dn/engine-core';
import type { CanvasView } from './canvas-view';
import { arrowHidden } from './geometry';
import type { Mounted } from './types';

const TYPE_NAME: Record<string, string> = {
  table: '표', chart: '그래프', image: '이미지', file: '첨부 파일', database: '데이터베이스', toc: '목차', embed: '임베드한 블록', ink: '손글씨',
};

/** 블록 이름: 첫 줄 글자(없으면 콘텐츠 종류) · 연결 수 */
export function blockLabel(view: CanvasView, id: Id, links = true): string {
  const contents = view.engine.contentsOf(id);
  const { title, bodies } = blockTextParts(contents);
  const text = [title, ...bodies].flatMap((c) => (c ? textLines(c.doc) : [])).find((l) => l.trim())?.trim().slice(0, 80);
  const other = contents.find((c) => c.type !== 'text');
  const name = text || (other ? TYPE_NAME[other.type] ?? other.type : '빈 상자');
  if (!links) return name;
  const out = view.engine.arrowsOf(id).filter((a) => endBlock(a.from) === id).length;
  const into = view.engine.arrowsOf(id).filter((a) => endBlock(a.to) === id).length;
  return `${name}${out || into ? ` · 연결 ${out ? `나감 ${out}` : ''}${out && into ? ' ' : ''}${into ? `들어옴 ${into}` : ''}` : ''}`;
}

/** 블록 DOM에 역할 · 이름 (그릴 때마다) */
export function labelBlock(view: CanvasView, b: Block, m: Mounted): void {
  m.el.setAttribute('role', 'group');
  m.el.setAttribute('aria-roledescription', '블록');
  const label = blockLabel(view, b.id);
  if (m.el.getAttribute('aria-label') !== label) m.el.setAttribute('aria-label', label);
  m.el.classList.toggle('dn-connect-src', connectSource(view) === b.id); // 화면 밖에 나갔다 다시 그려도 연결 시작 표시
}

/** 캔버스 뿌리: 이름 · 쓰는 법 · 알림 자리 */
export function setupA11y(view: CanvasView): void {
  const root = view.root;
  root.setAttribute('role', 'application');
  root.setAttribute('aria-roledescription', '캔버스');
  root.setAttribute('aria-label', '캔버스 — Tab · Shift+Tab으로 블록 이동, Enter로 편집, 화살표로 옮기기, Alt+화살표로 크기, C로 연결, Shift+F10으로 블록 메뉴');
  if (!root.querySelector(':scope > .dn-sr-live')) {
    const live = document.createElement('div');
    live.className = 'dn-sr-live';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('role', 'status');
    root.appendChild(live);
  }
}

export function announce(view: CanvasView, text: string): void {
  const live = view.root.querySelector<HTMLElement>(':scope > .dn-sr-live');
  if (live) live.textContent = text;
}

/** Tab(1) · Shift+Tab(-1): 읽는 순서로 다음 블록을 고르고 화면에 보이게. 끝을 넘으면 false(캔버스 밖으로 포커스를 넘긴다) */
export function tabBlock(view: CanvasView, dir: 1 | -1): boolean {
  const order = readingOrder(view.engine.blocks());
  if (!order.length) return false;
  const cur = view.selBlocks.size === 1 ? order.findIndex((b) => view.selBlocks.has(b.id)) : -1;
  const next = cur < 0 ? (dir === 1 ? 0 : order.length - 1) : cur + dir;
  if (next < 0 || next >= order.length) { view.select([]); announce(view, ''); return false; }
  const b = order[next]!;
  view.select([b.id]);
  view.focusBlock(b.id);
  announce(view, `블록 ${next + 1}/${order.length} · ${blockLabel(view, b.id)}`);
  return true;
}

// ───────── 키보드로 연결 (화살표) ─────────
// C: 고른 블록에서 연결 시작 → Tab · Shift+Tab으로 대상 → Enter = 연결(이미 있으면 지우기) → Esc = 그만두기.
const connecting = new WeakMap<CanvasView, Id>();

export function connectSource(view: CanvasView): Id | null { return connecting.get(view) ?? null; }

export function startConnect(view: CanvasView, from: Id): void {
  connecting.set(view, from);
  view.mounted.get(from)?.el.classList.add('dn-connect-src');
  announce(view, `연결: ${blockLabel(view, from, false)}에서 — Tab으로 대상을 고르고 Enter, 그만두려면 Esc`);
}

export function cancelConnect(view: CanvasView, quiet = false): void {
  const from = connecting.get(view);
  if (!from) return;
  connecting.delete(view);
  view.mounted.get(from)?.el.classList.remove('dn-connect-src');
  if (!quiet) announce(view, '연결을 그만뒀어요');
}

/** 대상(지금 고른 블록)으로 연결 · 이미 있으면 지우기. 처리했으면 true */
export function finishConnect(view: CanvasView): boolean {
  const from = connecting.get(view);
  const to = view.selBlocks.size === 1 ? [...view.selBlocks][0]! : null;
  if (!from) return false;
  if (!view.engine.getBlock(from)) { cancelConnect(view, true); return false; } // 시작 블록이 지워졌으면 그만두고 Enter는 원래대로
  if (!to || to === from) { announce(view, '연결할 다른 블록을 Tab으로 골라 주세요'); return true; }
  const existing = view.engine.arrowsOf(from).find((a) => endBlock(a.from) === from && endBlock(a.to) === to);
  if (existing) {
    deleteEntities(view.engine, [], [existing.id]);
    announce(view, `연결을 지웠어요: ${blockLabel(view, from, false)} → ${blockLabel(view, to, false)}`);
  } else {
    const r = createArrow(view.engine, { blockId: from, side: 'auto' }, { blockId: to, side: 'auto' }, undefined, view.arrowStyle);
    announce(view, r.ok ? `연결했어요: ${blockLabel(view, from, false)} → ${blockLabel(view, to, false)}${arrowHidden(view, r.value) ? ' — 붙어 있는 상자라 화살표는 화면에서 숨겨요' : ''}` : '연결하지 못했어요');
  }
  cancelConnect(view, true);
  return true;
}

