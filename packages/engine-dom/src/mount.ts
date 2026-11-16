// 블록 DOM: 가상화 마운트 · 블록 스타일 · 칸(제목 · 본문 · 모르는 콘텐츠) 렌더 · 높이 재기.
import { blockColor, blockDataOrigin, cellDoc, blockTextParts, boxKind, isBlankDoc, isChartContent, isDatabaseContent, isEmbedContent, isFileContent, isImageContent, isInkContent, isTableContent, isTextContent, isTocContent, isWebContent, toTitleDoc, tocEntries, tocSignature, type Block, type BoxKind, type ChartContent, type ChartData, type Content, type TableContent, type TableData, type Id, type TextContent, type TextDoc, isButtonContent, isTabsContent, setFilePreview, isCardGroup, isDividerContent } from '@dn/engine-core';
import { renderStatic } from '@dn/text-pm';
import type { CanvasView } from './canvas-view';
import { BLOCK_COLORS, DEFAULT_MIN_H, TITLE_MIN_H } from './constants';
import { renderChart, renderFile, renderImage, renderTable, svg } from './rich-render';
import { renderToc } from './toc-render';
import { renderButton } from './button-render';
import { renderTabs } from './tabs-render';
import { renderDivider } from './divider-render';
import { renderEmbed } from './embed-render';
import { syncCaptions } from './caption-view';
import { renderWeb } from './web-render';
import { restoreHeaderEdit } from './table-edit';
import { renderDatabase } from './db-view';
import { conflictBadge } from './conflict';
import { commentBadge } from './comment-badge';
import { kindTag } from './kind-tag';
import { labelBlock } from './a11y';
import { applyTextStyle } from './text-style';
import type { Mounted, Part } from './types';

/** 렌더러가 아직 없는 콘텐츠의 자리표시자 문구 (내부 타입명을 사용자에게 보이지 않는다) */
function otherLabel(type: string): string {
  if (type === 'chart') return '그래프 — 화면에 그리는 기능을 준비 중이에요. 데이터는 보관돼 있어요.';
  if (type === 'table') return '표 — 화면에 그리는 기능을 준비 중이에요. 데이터는 보관돼 있어요.';
  return '이 버전에서 보여 줄 수 없는 내용이에요. 앱을 업데이트하면 보여요.';
}

/** 블록 핸들 (⋮⋮) DOM — 점 여섯 개 */
export function createGrip(): HTMLDivElement {
  const grip = document.createElement('div');
  grip.className = 'dn-grip';
  grip.title = '드래그해서 옮기기 · 클릭해서 메뉴 열기';
  grip.setAttribute('role', 'button');
  grip.setAttribute('aria-label', '블록 메뉴');
  grip.hidden = true;
  const dots = svg('svg', { width: 10, height: 16, viewBox: '0 0 10 16' });
  for (const [cx, cy] of [[2, 3], [8, 3], [2, 8], [8, 8], [2, 13], [8, 13]] as const) dots.append(svg('circle', { cx, cy, r: 1.4, fill: 'currentColor' }));
  grip.appendChild(dots);
  return grip;
}

/** 가상화: 뷰포트(+여유) 안의 블록만 DOM에 둔다 (FR-005 · ENGINE 8.3). */
export function syncMounts(view: CanvasView): void {
  // LOD: 많이 축소하면 블록을 DOM 대신 캔버스에 단순화해 그린다 (ENGINE 8.5)
  const want = new Set(view.lod ? [] : view.engine.queryBlocks(view.visibleRect()));
  if (view.editingId) want.add(view.editingId);
  for (const [id, m] of view.mounted) {
    if (!want.has(id) || !view.engine.getBlock(id)) {
      closeEditor(m);
      view.blockObs.unobserve(m.el);
      m.el.remove();
      view.mounted.delete(id);
    }
  }
  let restack = false;
  for (const id of want) {
    const b = view.engine.getBlock(id);
    if (!b) continue;
    let m = view.mounted.get(id);
    if (!m) {
      m = mount(view, b);
      view.mounted.set(id, m);
      updateBlock(view, b, m);
      restack = true;
    } else if (view.dirtyAll || view.dirtyIds.has(id)) {
      updateBlock(view, b, m);
      restack = true;
    }
  }
  // 캡션 (그림 · 표 번호는 문서 차례라 무엇이든 바뀌면 다시 맞춘다)
  if (restack || view.dirtyAll || view.dirtyIds.size) syncCaptions(view.engine, view.mounted, view.readOnly);
  // 겹침 순서: 마운트된 블록만 z 키 순으로 z-index를 매긴다 (D5)
  if (restack) {
    const order = [...view.mounted.keys()]
      .map((id) => view.engine.getBlock(id)!)
      .filter(Boolean)
      .sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1));
    order.forEach((b, i) => { const el = view.mounted.get(b.id)!.el; const zi = String(i + 1); if (el.style.zIndex !== zi) el.style.zIndex = zi; });
  }
}

export function mount(view: CanvasView, b: Block): Mounted {
  const el = document.createElement('div');
  el.className = 'dn-block';
  el.dataset.id = b.id;
  view.world.appendChild(el);
  view.blockObs.observe(el);
  return { el, parts: [], editor: null, editingPart: null };
}

export function updateBlock(view: CanvasView, b: Block, m: Mounted): void {
  const s = m.el.style;
  s.left = `${b.x}px`;
  s.top = `${b.y}px`;
  s.width = `${b.w}px`;
  const kind = boxKind(view.engine.contentsOf(b.id));
  s.minHeight = `${b.minH ? b.minH : kind === 'title' ? TITLE_MIN_H : DEFAULT_MIN_H}px`; // 자동 높이 상자의 minH = 배치 다듬기가 맞춘 높이
  s.setProperty('--dn-minh', b.sizing === 'fixed' && b.minH ? `${b.minH}px` : ''); // 높이를 채우는 콘텐츠(PDF 보기)가 쓴다
  m.el.classList.toggle('dn-box-title', kind === 'title');
  m.el.classList.toggle('dn-box-text', kind === 'text');
  m.el.classList.toggle('dn-box-divider', view.engine.contentsOf(b.id).some(isDividerContent)); // 구분선 — 칸 테두리 · 바탕 없이 선만
  m.el.classList.toggle('dn-in-card', isCardGroup(view.engine, b.group)); // 카드 안 상자 — 카드 하나로 보이게 테두리 없이 (노트형)
  // 테마별 블록 색은 CSS 변수(--dn-block-<색>)가 정한다 — 없으면 밝은 테마 값
  // 바탕색: 사용자가 고른 색, 없으면 노드 종류 기본색 (v6 — AI는 종류만 적는다)
  const bg = blockColor(b);
  s.background = bg && BLOCK_COLORS[bg] ? `var(--dn-block-${bg}, ${BLOCK_COLORS[bg]})` : '';
  m.el.classList.toggle('dn-colored', !!bg);
  applyTextStyle(m.el, b); // 글자 크기 · 색 · 정렬 (오른쪽 클릭 › 글자)
  m.el.classList.toggle('dn-ai', !!b.ai);
  // AI가 만들고 사람이 고친 블록 (v6 출처 — 학습 데이터 등급 claude_edited 등)
  m.el.classList.toggle('dn-ai-edited', blockDataOrigin(view.engine, b.id).endsWith('_edited'));
  m.el.classList.toggle('dn-editing', view.editingId === b.id);
  // 블록 하나를 그리다 오류가 나도 그 블록만 오류 표시 (FR-149) — 데이터는 그대로, 다른 블록은 계속 그린다
  try { renderContents(view, b, m); m.el.classList.remove('dn-render-error'); }
  catch (err) {
    console.warn('[dn] 블록을 그리지 못함', b.id, err);
    m.el.classList.add('dn-render-error');
    m.el.replaceChildren(Object.assign(document.createElement('div'), { className: 'dn-render-msg', textContent: '이 블록을 그리지 못했어요. 내용은 그대로 저장돼 있어요 — 백업을 내보내 두세요.' }));
    for (const p of m.parts) p.rendered = null;
    m.parts = [];
  }
  conflictBadge(view, b, m);
  commentBadge(view, b, m);
  kindTag(b, m); // 노드 종류 태그 · 상태 (v6)
  labelBlock(view, b, m);
}

/**
 * 블록의 텍스트(제목 상자 또는 내용 상자 — 스키마 v3은 하나, 옛 데이터는 여럿일 수 있다) + 모르는 콘텐츠 자리표시자. 칸마다 DOM 하나, 편집 중인 칸만 에디터.
 * 비어 있는 칸은 편집 중이 아닐 때 숨긴다(제목만 있는 카드가 작게 보이도록) — 둘 다 비면 제목 자리표시자.
 */
function renderContents(view: CanvasView, b: Block, m: Mounted): void {
  const contents = view.engine.contentsOf(b.id);
  const { title, bodies } = blockTextParts(contents);
  const want: { id: Id; role: Part['role'] }[] = [
    ...(title ? [{ id: title.id, role: 'title' as const }] : []),
    ...bodies.map((c) => ({ id: c.id, role: 'body' as const })),
    ...contents.filter((c) => !isTextContent(c)).map((c) => ({ id: c.id, role: 'other' as const })),
  ];
  const same = want.length === m.parts.length && want.every((w, i) => m.parts[i]!.contentId === w.id && m.parts[i]!.role === w.role);
  if (!same) {
    if (m.editingPart && !want.some((w) => w.id === m.editingPart)) closeEditor(m);
    const old = new Map(m.parts.map((p) => [p.contentId, p]));
    m.parts = want.map((w) => {
      const keep = old.get(w.id);
      if (keep && keep.role === w.role) return keep;
      const el = document.createElement('div');
      el.className = w.role === 'other' ? 'dn-unknown' : `dn-text dn-part-${w.role}`;
      el.dataset.part = w.id;
      return { el, contentId: w.id, role: w.role, rendered: null };
    });
    m.el.replaceChildren(...m.parts.map((p) => p.el));
  }
  let bodyFilled = false;
  for (const p of m.parts) {
    const c = view.engine.getContent(p.contentId);
    if (!c) continue;
    if (p.role === 'other') { renderOther(view, c, p); continue; }
    const doc = (c as TextContent).doc;
    const blank = isBlankDoc(doc);
    if (p.role === 'body' && !blank) bodyFilled = true;
    p.el.classList.toggle('dn-blank', blank);
    if (m.editingPart === p.contentId && m.editor) {
      // 엔진 쪽 변경(undo · redo · 원격)만 반영된다. 사용자 입력은 이미 에디터와 같으므로 no-op.
      m.editor.setDoc(doc);
    } else if (p.rendered !== doc) {
      renderStatic(doc, p.el);
      p.rendered = doc;
    }
  }
  m.el.classList.toggle('dn-body-filled', bodyFilled);
}

/** 텍스트가 아닌 콘텐츠: 그래프 · 표(v4)는 그리고, 그 밖은 안내 문구. 편집 중인 표 셀은 에디터를 살려 둔 채 그 칸만 맞춘다 */
function renderOther(view: CanvasView, c: Content, p: Part): void {
  // 목차(FR-053): 지금 제목에서 만든다 — 다른 블록이 바뀌어도 changes.ts가 이 블록을 다시 그리게 표시한다
  if (isTocContent(c)) {
    const entries = tocEntries(view.engine, c.depth);
    const sig = tocSignature(entries);
    if (p.rendered !== c || p.el.dataset.sig !== sig) { renderToc(entries, p.el, (id) => view.focusBlock(id)); p.el.dataset.sig = sig; p.rendered = c; }
    return;
  }
  if (p.rendered === c) return;
  // 먼저 표시 — 표 셀 편집이 끝나면(endEditing) rendered를 다시 null로 돌려 둔다
  p.rendered = c;
  const url = view.host.files?.url.bind(view.host.files);
  if (isChartContent(c)) renderChart(c, p.el);
  // 블록 임베드(FR-082): 원본은 그릴 때마다 앱이 읽어 준다
  else if (isEmbedContent(c)) renderEmbed(c, p.el, view.host.embeds, url);
  // 웹 북마크 · 임베드(FR-050 · FR-051): iframe은 덮개 아래 — 두 번 누르면 그 안을 쓴다
  else if (isWebContent(c)) renderWeb(c, p.el, { engine: view.engine, readOnly: view.readOnly, host: view.host.web, shield: true });
  // 묶인 잉크(FR-037): 캔버스에서는 잉크 레이어가 블록 자리에 그린다 — 여기는 빈 칸(화면 읽기 프로그램용 이름만)
  else if (isInkContent(c)) { p.el.className = 'dn-inkpart'; p.el.replaceChildren(); p.el.setAttribute('aria-label', '손글씨'); }
  // 데이터베이스(FR-057): 칸을 그 자리에서 고친다
  else if (isDatabaseContent(c)) renderDatabase(p.el, c, { engine: view.engine, readOnly: view.readOnly, onExit: () => view.root.focus({ preventScroll: true }) });
  else if (isFileContent(c)) renderFile(c, p.el, url, { shield: true, ...(view.host.files?.blob ? { blob: view.host.files.blob.bind(view.host.files) } : {}), ...(view.readOnly ? {} : { onPreview: (on: boolean) => { setFilePreview(view.engine, c.id, on); } }) }); // PDF 펼쳐 보기 (GAP #22)
  else if (isImageContent(c)) renderImage(c, p.el, url);
  // 버튼(GAP #17): 누르면 넣을 상자들을 바로 아래에 — 새 상자를 고른다
  else if (isButtonContent(c)) renderButton(c, p.el, { engine: view.engine, readOnly: view.readOnly, selected: () => view.selectedBlocks, onPressed: (ids) => view.select(ids) });
  // 탭(GAP #17): 고치는 중이면 탭 줄만 다시 — 글 칸은 편집기가 갖고 있다
  else if (isDividerContent(c)) renderDivider(c, p.el); // 구분선 (노트형 NS-01)
  else if (isTabsContent(c)) renderTabs(c, p.el, { engine: view.engine, readOnly: view.readOnly, editing: view.tabEdit?.contentId === c.id, onSwitch: () => { if (view.tabEdit?.contentId === c.id) view.endEditing(); } });
  else if (isTableContent(c)) {
    const ce = view.cellEdit?.contentId === c.id ? view.cellEdit : null;
    renderTable(c, p.el, ce ? { rowId: ce.rowId, colId: ce.colId } : undefined);
    if (ce) {
      // 행 · 열이 지워졌으면(실행 취소 등) 편집을 끝낸다. 아직 글이 없는 칸은 데이터에 칸이 없다 — 빈 칸으로 본다
      const row = c.rows.find((r) => r.id === ce.rowId);
      if (!row || !c.columns.some((x) => x.id === ce.colId) || !p.el.contains(ce.editor.view.dom)) { view.endEditing(); return; }
      const doc = row.cells[ce.colId] ?? cellDoc('');
      p.el.prepend(ce.tools);
      ce.editor.setDoc(toTitleDoc(doc));
    }
    restoreHeaderEdit(view, c.id, p.el);
  } else p.el.textContent = otherLabel(c.type);
}

export function closeEditor(m: Mounted): void {
  if (!m.editor) return;
  m.editor.destroy();
  m.editor = null;
  const p = m.parts.find((x) => x.contentId === m.editingPart);
  if (p) { p.rendered = null; p.el.className = `dn-text dn-part-${p.role}`; }
  m.editingPart = null;
}

/**
 * 문서를 주어진 폭의 상자로 그렸을 때 높이 (AI 배치 DomMeasurer, ENGINE 10.3). 실제 블록과 같은 DOM 구조로 잰다.
 * `kind`: 'text' 내용 상자(기본) · 'title' 제목 상자
 */
export function measureText(view: CanvasView, doc: TextDoc, w: number, kind: BoxKind = 'text'): number {
  return measureOffscreen(view, `dn-block dn-box-${kind}`, w, kind === 'title' ? TITLE_MIN_H : DEFAULT_MIN_H, (t) => {
    t.className = `dn-text dn-part-${kind === 'title' ? 'title' : 'body'}${isBlankDoc(doc) ? ' dn-blank' : ''}`;
    renderStatic(kind === 'title' ? toTitleDoc(doc) : doc, t);
  });
}

/** 그래프 · 표 높이 재기 (AI 결과 배치 · 새로 넣기): 화면 밖에서 실제로 그려 본다 — 제목 · 범례 · 줄바꿈까지 그대로 */
export function measureRich(view: CanvasView, c: (ChartData & { readonly type: 'chart' }) | (TableData & { readonly type: 'table' }), w: number): number {
  return measureOffscreen(view, 'dn-block', w, DEFAULT_MIN_H, (p) => {
    if (c.type === 'chart') renderChart(c as ChartContent, p);
    else renderTable(c as TableContent, p);
  });
}

/** 제목 상자를 한 줄로 그렸을 때의 폭 (AI 배치 · 배치 다듬기에서 제목 상자를 글 폭에 맞출 때) — 상자 안쪽 여백까지 */
export function measureTitleWidth(view: CanvasView, doc: TextDoc): number {
  const el = document.createElement('div');
  el.className = 'dn-block dn-box-title';
  el.style.cssText = 'visibility:hidden;left:-100000px;top:0;width:max-content;white-space:nowrap';
  const part = document.createElement('div');
  part.className = 'dn-text dn-part-title';
  renderStatic(toTitleDoc(doc), part);
  el.appendChild(part);
  view.world.appendChild(el);
  // offsetWidth는 정수로 반올림된다 — 소수점만큼 모자라면 마지막 글자가 다음 줄로 넘어가므로 2px 여유
  const w = el.offsetWidth + 2;
  el.remove();
  return w;
}

/** 화면 밖 블록 껍데기에 fill로 칸 하나를 그려 넣고 높이를 잰다 */
function measureOffscreen(view: CanvasView, cls: string, w: number, minH: number, fill: (part: HTMLDivElement) => void): number {
  const el = document.createElement('div');
  el.className = cls;
  el.style.cssText = `visibility:hidden;left:-100000px;top:0;width:${w}px;min-height:${minH}px`;
  const part = document.createElement('div');
  fill(part);
  el.appendChild(part);
  view.world.appendChild(el);
  const h = el.offsetHeight;
  el.remove();
  return h;
}
