// 문서 뷰 항목 안쪽 그리기 (DocView.fill): 내용마다 글 · 표 · 그래프 · 사진 · 잉크 · 파일 · 임베드 · 웹 · 목차 · 데이터베이스,
// 그리고 화살표 — 바로 다음 항목으로 가면 '↓ 라벨' 잇기 줄, 다른 곳으로 가면 '→ 대상 · 라벨'.
import { arrowChip, blockTextParts, isBound, isChartContent, readsBackward, RELATION_SPEC, type Arrow, type KnownRelation, isDatabaseContent, isEmbedContent, isFileContent, isImageContent, isInkContent, isTableContent, isTextContent, isTocContent, isWebContent, textLines, tocEntries, type Block, type Content, type Engine, type Id, isButtonContent, isTabsContent, setFilePreview, isDividerContent } from '@dn/engine-core';
import { renderStatic } from '@dn/text-pm';
import type { DocView } from './doc-view';
import { renderEmbed } from './embed-render';
import { renderChart, renderFile, renderImage, renderInkSvg, renderTable } from './rich-render';
import { renderToc } from './toc-render';
import { renderButton } from './button-render';
import { renderTabs } from './tabs-render';
import { renderDividerDoc } from './divider-render';
import { renderWeb } from './web-render';
import { renderDatabase } from './db-view';

export function docParts(dv: DocView, b: Block, contents: readonly Content[], next?: Id, parent?: Id): HTMLElement[] {
  const e = dv.opts.engine;
  const parts: HTMLElement[] = [];
  for (const c of contents) {
    const p = document.createElement('div');
    p.dataset.part = c.id;
    // 내용 하나를 그리다 오류가 나도 그 내용만 안내 (FR-149) — 문서의 나머지는 계속
    try {
    if (isTextContent(c)) {
      p.className = `dn-text dn-doc-text${c.role === 'title' ? ' dn-doc-title' : ''}`;
      renderStatic(c.doc, p);
    } else if (isTableContent(c)) renderTable(c, p);
    else if (isChartContent(c)) renderChart(c, p);
    else if (isImageContent(c)) renderImage(c, p, dv.opts.files?.url.bind(dv.opts.files));
    else if (isInkContent(c)) renderInkSvg(e, c.id, p);
    else if (isFileContent(c)) renderFile(c, p, dv.opts.files?.url.bind(dv.opts.files), { ...(dv.opts.files?.blob ? { blob: dv.opts.files.blob.bind(dv.opts.files) } : {}), ...(dv.opts.readOnly ? {} : { onPreview: (on: boolean) => { setFilePreview(e, c.id, on); } }) });
    else if (isEmbedContent(c)) renderEmbed(c, p, dv.opts.embeds, dv.opts.files?.url.bind(dv.opts.files));
    else if (isWebContent(c)) renderWeb(c, p, { engine: e, readOnly: !!dv.opts.readOnly, host: dv.opts.web });
    else if (isTocContent(c)) renderToc(tocEntries(e, c.depth), p, (id) => dv.items.get(id)?.el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    // 문서 뷰의 데이터베이스는 읽기 — 고치기는 캔버스에서 (다시 그릴 때 입력 칸 포커스를 잃지 않게)
    else if (isDatabaseContent(c)) renderDatabase(p, c, { engine: e, readOnly: true });
    else if (isTabsContent(c)) renderTabs(c, p, { engine: e, readOnly: true }); // 문서 뷰는 탭 바꿔 보기만 — 고치기는 캔버스에서
    else if (isDividerContent(c)) renderDividerDoc(c, p); // 구분선 → 가로줄 (세로선은 비움)
    else if (isButtonContent(c)) renderButton(c, p, { engine: e, readOnly: !!dv.opts.readOnly || !dv.opts.word, selected: () => dv.select?.selected().blocks ?? [] });
    else { p.className = 'dn-unknown'; p.textContent = '이 버전에서 보여 줄 수 없는 내용이에요.'; }
    if (!isTextContent(c) && !isTableContent(c) && !isWebContent(c) && !isButtonContent(c) && !isDividerContent(c) && dv.opts.word && !dv.opts.readOnly) p.title = '두 번 누르면 캔버스에서 고쳐요';
    } catch (err) {
      console.warn('[dn] 블록을 그리지 못함', b.id, err);
      p.className = 'dn-render-msg';
      p.textContent = '이 내용을 그리지 못했어요. 내용은 그대로 저장돼 있어요 — 백업을 내보내 두세요.';
    }
    parts.push(p);
  }
  // 화살표: 문서에서 바로 다음 항목으로 가면 '↓ 라벨' 잇기 줄, 다른 곳으로 가면 '→ 대상 · 라벨'
  const rel = e.arrowsOf(b.id).filter(isBound).filter((a) => a.from.blockId === b.id); // 빈 곳 화살표는 문서에 안 나온다
  const toNext = b.nodeKind === 'condition' ? undefined : rel.find((a) => a.to.blockId === next); // 조건은 갈래마다 '▸ 라벨 → 대상'
  // 위계 · 논증 화살표가 들여쓴 부모로 가면 들여쓰기가 이미 그 관계 — 원문 라벨 · 기호가 없으면 줄을 빼고 (STRUCTURE-GUIDE 4.11)
  const others = rel.filter((a) => a !== toNext && !(a.to.blockId === parent && shownByNesting(a, e.getBlock(a.to.blockId)?.nodeKind)));
  const nextChip = toNext ? arrowChip(toNext) : '';
  if (nextChip) parts.push(Object.assign(document.createElement('div'), { className: 'dn-doc-flow', textContent: `↓ ${nextChip}` })); // 라벨 없는 다음 단계는 번호 · 차례로 충분
  if (others.length) {
    const ul = document.createElement('ul');
    ul.className = 'dn-doc-rel';
    for (const a of others) {
      const li = document.createElement('li');
      const chip = arrowChip(a), back = dv.steps.get(a.to.blockId), mine = dv.steps.get(b.id);
      // 닫힌 고리: 앞 단계로 돌아가는 화살표는 '↺ n단계로', 조건의 갈래는 '▸ 라벨 → 대상' (STRUCTURE-GUIDE 4.11)
      if (back !== undefined && mine !== undefined && back <= mine) li.textContent = `↺ ${back}단계로${chip ? ` · ${chip}` : ''}`;
      else if (b.nodeKind === 'condition' && chip) li.textContent = `▸ ${chip} → ${nameOf(e, a.to.blockId)}`;
      else li.textContent = `→ ${nameOf(e, a.to.blockId)}${chip ? ` · ${chip}` : ''}`;
      ul.appendChild(li);
    }
    parts.push(ul);
  }
  return parts;
}

function shownByNesting(a: Arrow, toKind?: string): boolean {
  const chip = a.relation ? RELATION_SPEC[a.relation as KnownRelation]?.chip : undefined;
  return readsBackward(a.relation, toKind) && !a.negated && !a.sign && a.order === undefined && !a.symbol && (!a.label || a.label === chip?.ko || a.label === chip?.en);
}

function nameOf(e: Engine, blockId: Id): string {
  const { title, bodies } = blockTextParts(e.contentsOf(blockId));
  for (const c of title ? [title, ...bodies] : bodies) {
    const line = textLines(c.doc).find((l) => l.trim());
    if (line) return line.trim().slice(0, 50);
  }
  const t = e.contentsOf(blockId).map((c) => (c as { title?: unknown }).title).find((x) => typeof x === 'string' && x);
  return typeof t === 'string' ? t : '상자';
}
