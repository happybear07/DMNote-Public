// 문서 뷰 (FR-088): 같은 노트를 위에서 아래로 읽는 문서로. 같은 엔진 · 같은 데이터 — 여기서 고치면 캔버스도 바뀐다.
// 블록 순서 규칙(engine-core flow.ts): 화살표로 이어진 흐름은 화살표 차례(한 줄 흐름은 단계 번호, 갈래 흐름은 들여쓰기), 나머지는
// 위 → 아래(40px 단위로 같은 줄) · 같은 줄은 왼쪽 → 오른쪽 (내보내기 · 인쇄와 같다, FR-131). 흐름의 다음 단계로 가는 화살표는 '↓ 라벨' 잇기 줄로.
// 블록에 묶지 않은 손그림은 가까운 획끼리 한 그림으로 자리 순서에 (ink-figures.ts).
// 글 상자를 누르면 그 칸에 에디터(실행 취소는 캔버스와 같은 하나의 기록). 화살표는 블록 아래 "→ 대상 (라벨)" 줄로.
// word(주 문서 뷰): 워드처럼 이어 고치기(doc-word.ts) · 쪽 보기(doc-pages.ts).
import { blockColor, blockTextParts, documentOrder, isBound, noteCards, figurePaths, figureSlot, inkFigures, isTableContent, isTextContent, isTocContent, tocEntries, tocSignature, toTitleDoc, cellDoc, captionNumbers, pageGeom, type CaptionNumber, type Block, type Engine, type Id } from '@dn/engine-core';
import { mediaSeek, refreshXrefs, type NoteLinkHost } from '@dn/text-pm';
import { renderInkPaths, renderTable } from './rich-render';
import { bindTableSort } from './table-sort-ui';
import { clickAndType } from './doc-click-type';
import { columnGap, docRows, groupRuns } from './doc-columns';
import type { EmbedHost } from './embed-render';
import type { WebHost } from './web-render';
import type { BlockMenuRequest } from './types';
import { syncFootnotes } from './doc-footnotes';
import { docParts } from './doc-parts';
import { syncCaption, useCaptionNumbers } from './caption-view';
import { applyTextStyle } from './text-style';
import { kindTag } from './kind-tag';
import { DocWord, type DocWordHost } from './doc-word';
import { DocTable } from './doc-table';
import { DocSelect } from './doc-select';
import { DocHandle } from './doc-handle';
import { DocRange } from './doc-range';
import { DocMarquee } from './doc-marquee';
import { paginate, setSheetDeco, syncAddPage, unpaginate } from './doc-pages';
import { DocCover, type DocCoverHost } from './doc-cover';
import { flipStatic } from './static-click';
import { DocDiagrams, diagramGroups, type DiagramHost } from './doc-diagram';

export interface DocViewOptions {
  engine: Engine;
  container: HTMLElement;
  readOnly?: boolean;
  files?: { url(hash: string): Promise<string | null>; blob?(hash: string): Promise<Blob | null> };
  noteLinks?: NoteLinkHost;
  /** 블록 임베드 (FR-082) */
  embeds?: EmbedHost;
  web?: WebHost;
  /** 워드처럼 고치기 (주 문서 뷰만) — 상자 경계 넘기 · 나누기 · 합치기 · 서식 막대 */
  word?: DocWordHost;
  /** 쪽 보기 (A4 종이 · 쪽 나눔 · 쪽 번호) */
  pages?: boolean;
  /** 맨 위 제목 (인쇄 · 내보내기 미리보기 — 노트 제목) */
  header?: string;
  /** 오른쪽 클릭: 그 블록의 속성 메뉴 (캔버스와 같은 블록 메뉴, 앱이 띄운다) */
  onBlockMenu?(req: BlockMenuRequest): void;
  /** 노트 제목 — 머리글 · 바닥글의 {제목} (없으면 header) */
  title?: () => string;
  /** '문서에서 그림으로'를 켠 묶음의 도식 그림 (doc-diagram.ts) — 앱이 캔버스로 그린다 */
  diagram?: DiagramHost;
  /** 첫 쪽 표지 — 표지 쪽 그림 · 캔버스로 열기 (doc-cover.ts) */ cover?: DocCoverHost;
}

export class DocView {
  readonly root: HTMLDivElement;
  /** @internal */ readonly page: HTMLDivElement;
  /** @internal */ readonly items = new Map<Id, { el: HTMLElement; sig: unknown[] }>();
  private caps = new Map<Id, CaptionNumber>();
  /** @internal 단계 번호 (문서 차례) — 닫힌 고리의 '↺ n단계로' (doc-parts.ts) */ readonly steps = new Map<Id, number>();
  /** 이름 있는 묶음의 문서 첫 상자 → 묶음 이름 (소제목, STRUCTURE-GUIDE 4.11) */
  private heads = new Map<Id, string>();
  /** 워드처럼 고치기 — 서식 막대가 부르는 명령 · 상태 */
  readonly word: DocWord;
  /** 표 칸 고치기 (doc-table.ts) */
  readonly table: DocTable;
  /** 블록 고르기 · 지우기 · 복사 (doc-select.ts) — 주 문서 뷰만 */
  readonly select: DocSelect | null;
  /** 여러 글 칸에 걸친 글자 범위 (doc-range.ts) */
  readonly range: DocRange;
  /** 빈 곳에서 끌어 고르기 */
  private readonly marquee: DocMarquee | null;
  /** 블록 손잡이 ⋮⋮ — 끌어 옮기기 · 블록 메뉴 (doc-handle.ts) */
  readonly handle: DocHandle | null;
  private readonly sheets: HTMLDivElement;
  private headerEl: HTMLElement | null = null;
  /** 손그림 (블록에 묶지 않은 잉크) — 획들 → 그림 */
  private readonly figs = new Map<string, { el: HTMLElement; sig: unknown[] }>();
  private readonly sizes: ResizeObserver | null;
  private pageFrame = 0;
  /** 컬럼 줄 (FR-049): 줄 블록 id들 → 감싸는 칸 · 컬럼 사이 막대 */
  private readonly rows = new Map<string, HTMLElement>();
  private readonly gaps = new Map<string, HTMLElement>();
  private readonly unsub: () => void;
  private readonly diagrams: DocDiagrams; // 그림으로 보일 묶음 (doc-diagram.ts)
  private readonly cover = new DocCover(this); // 첫 쪽 표지
  private frame = 0;

  constructor(/** @internal */ readonly opts: DocViewOptions) {
    this.root = document.createElement('div');
    this.root.className = `dn-doc${opts.word ? ' dn-doc-word' : ''}${opts.readOnly ? ' dn-doc-ro' : ''}`;
    this.page = Object.assign(document.createElement('div'), { className: 'dn-doc-page' });
    this.sheets = Object.assign(document.createElement('div'), { className: 'dn-doc-sheets' });
    this.root.appendChild(this.page);
    this.word = new DocWord(this);
    this.table = new DocTable(opts.engine, this.root);
    this.range = new DocRange(this);
    this.select = opts.word ? new DocSelect(this) : null;
    if (this.select) this.root.tabIndex = -1;
    this.handle = opts.word ? new DocHandle(this) : null;
    this.diagrams = new DocDiagrams(opts.engine, opts.diagram, { open: (id) => opts.word?.openInCanvas?.(id), menu: (ids, x, y) => opts.onBlockMenu?.({ ids: [...ids], x, y, doc: true }) });
    this.marquee = opts.word ? new DocMarquee(this, (ev) => { if (!this.word.pageDown(ev)) this.word.close(); }) : null;
    // 쪽 보기: 항목 크기가 바뀌면(입력 · 그림 로드) 쪽을 다시 맞춘다
    this.sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.schedulePages()) : null;
    opts.container.replaceChildren(this.root);
    this.root.addEventListener('mousedown', (e) => this.onDown(e));
    // 서식 복사(붓): 글자를 고르거나 상자를 누르고 뗀 뒤 입힌다 (에디터 선택이 맞춰진 다음)
    this.root.addEventListener('mouseup', () => { if (this.word.painter.mode) setTimeout(() => this.word.painter.up(), 0); });
    // 글 · 표가 아닌 것(그래프 · 사진 · 데이터베이스 · 파일 · 손그림 …)은 캔버스에서 고친다 — 그 내용을 두 번 누르면 거기로 (DQ-005).
    // 항목 안이라도 내용 밖 빈 곳(짧은 제목 옆 등)은 빈 곳 — 캔버스로 넘기지 않는다
    this.root.addEventListener('dblclick', (e) => {
      const t = e.target instanceof Element ? e.target : null;
      const item = t?.closest<HTMLElement>('.dn-doc-item[data-id]');
      if (!t || !item || this.opts.readOnly || !t.closest('[data-part]') || t.closest('.dn-doc-text, .dn-table, .dn-web')) return;
      this.opts.word?.openInCanvas?.(item.dataset.id!);
    });
    bindTableSort(this.root, opts.engine, { readOnly: () => !!this.opts.readOnly, onRefused: () => this.opts.word?.onNotice?.('table-sort-merged') }); // 표 열 머리 정렬
    this.root.addEventListener('contextmenu', (ev) => this.onContext(ev));
    this.root.addEventListener('dblclick', (ev) => { clickAndType(this, ev); }); // 빈 곳 두 번 누르기: 그 자리에서 쓰기 (워드 '클릭하여 입력')
    this.unsub = opts.engine.subscribe(() => this.schedule());
    this.render();
    if (opts.pages) this.setPages(true);
  }

  /** 쪽 보기 켜고 끄기 */
  setPages(on: boolean): void {
    this.opts.pages = on;
    this.root.classList.toggle('dn-doc-paged', on);
    if (on) { this.page.prepend(this.sheets); this.layoutPages(); }
    else { unpaginate(this.page, this.sheets); this.sheets.remove(); }
  }

  private schedulePages(): void {
    if (!this.opts.pages || this.pageFrame) return;
    this.pageFrame = requestAnimationFrame(() => { this.pageFrame = 0; this.layoutPages(); });
  }

  private layoutPages(): void {
    if (!this.opts.pages) return;
    if (this.sheets.parentElement !== this.page || this.page.firstChild !== this.sheets) this.page.prepend(this.sheets);
    const ps = this.opts.engine.note.pageSetup; // 쪽 설정 (engine-core page-setup.ts)
    setSheetDeco(this.page, { geom: pageGeom(ps), header: ps?.header, footer: ps?.footer, numbers: ps?.numbers, skipFirst: ps?.skipFirst, title: this.opts.title?.() ?? this.opts.header ?? '', date: new Date().toLocaleDateString('ko-KR') });
    const pages = paginate(this.page, this.sheets, (el) => el.classList.contains('dn-doc-break') || !!el.querySelector(':scope > .dn-doc-break') || !!el.previousElementSibling?.classList.contains('dn-doc-cover')); // 표지 다음은 새 쪽
    syncAddPage(this.sheets, pages, this.opts.word && !this.opts.readOnly ? () => this.word.newPage() : null);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }

  /** 블록이 바뀐 것만 다시 그린다 (콘텐츠 객체가 같으면 그대로) */
  render(): void {
    const e = this.opts.engine;
    this.caps = captionNumbers(e); // 캡션 번호 (문서 차례) — 상호 참조 글자도
    this.root.classList.toggle('dn-hnum', !!e.note.headingNumbers); // 제목 번호 (CSS 카운터, doc-word.css)
    useCaptionNumbers(this.caps);
    const keep = this.range.snapshot(); // 여러 칸 범위는 다시 그린 뒤 되놓는다 (DE-002)
    this.word.check();
    if (this.table.cell && !e.getContent(this.table.cell.contentId)) this.table.close();
    const items = documentOrder(e);
    const order = items.map((x) => x.block);
    const info = new Map(items.map((x, i) => [x.block.id, { ...x, next: items[i + 1]?.block.id }]));
    const grp = groupRuns(order);
    this.steps.clear();
    for (const x of items) if (x.step) this.steps.set(x.block.id, x.step);
    this.heads = new Map();
    const named = new Set<string>();
    const cardNo = new Map(noteCards(e).filter((c) => c.number).map((c) => [c.id, c.number!])); // 번호 켠 카드는 소제목 앞에 번호 (노트형)
    for (const b of order) { const g = b.group, name = g && e.note.groups?.[g]?.name; if (g && !named.has(g) && (name || cardNo.has(g))) { named.add(g); this.heads.set(b.id, cardNo.has(g) ? `${cardNo.get(g)}. ${name ?? ''}`.trim() : name!); } }
    const seen = new Set<Id>();
    // 그림으로 보일 묶음: 첫 상자 자리에 그림 하나, 나머지 상자는 빼고 (SmartArt처럼)
    const dg = diagramGroups(e, order), usedDg = new Set<Id>();
    const shown = dg.size ? order.filter((b) => !b.group || !dg.has(b.group) || dg.get(b.group)![0] === b.id) : order;
    const itemOf = (b: Block): HTMLElement => {
      if (b.group && dg.has(b.group)) { usedDg.add(b.group); return this.diagrams.el(b.group, dg.get(b.group)!); }
      seen.add(b.id);
      const contents = e.contentsOf(b.id);
      const arrows = e.arrowsOf(b.id).filter(isBound).filter((a) => a.from.blockId === b.id);
      const toc = contents.find(isTocContent);
      const f = info.get(b.id);
      const sig = [...contents, ...arrows, ...arrows.map((a) => e.contentsOf(a.to.blockId)[0]), b.style?.color, b.nodeKind, b.status, b.emphasis, b.hedge, b.role, b.speaker, b.time, b.owner, b.due, b.start, b.end, b.group ? e.note.groups?.[b.group]?.bracket : undefined, b.fontScale, b.fontFamily, b.textColor, b.align, b.lineHeight, b.indent, b.firstLine, b.spaceBefore, b.spaceAfter, b.pageBreak, b.caption, this.caps.get(b.id)?.label, f?.step, f?.depth, f?.next, f?.parent, this.heads.get(b.id), ...arrows.map((a) => this.steps.get(a.to.blockId)), toc ? tocSignature(tocEntries(e, toc.depth)) : null];
      let it = this.items.get(b.id);
      if (!it) {
        const el = document.createElement('section');
        el.className = 'dn-doc-item';
        el.dataset.id = b.id;
        it = { el, sig: [] };
        this.items.set(b.id, it);
      }
      const changed = sig.length !== it.sig.length || sig.some((x, i) => x !== it!.sig[i]);
      if (changed) { this.fill(b, it.el, f?.next, f?.parent); it.sig = sig; }
      // 흐름: 한 줄 흐름은 단계 번호, 갈래 흐름은 들여쓰기
      it.el.dataset.step = f?.step ? String(f.step) : '';
      it.el.dataset.grp = grp.get(b.id) ?? ''; // 묶음(블록)이면 왼쪽 선
      it.el.style.marginLeft = f?.depth ? `${f.depth * 28}px` : '';
      return it.el;
    };
    // 같은 줄의 블록은 컬럼으로 (FR-049) — 감싸는 칸 안에 블록 · 사이 막대 · 블록 …
    let prev: HTMLElement | null = null;
    const usedRows = new Set<string>(), usedGaps = new Set<string>();
    // 쪽 보기의 종이 층은 늘 맨 앞 — 그 뒤부터 차례로 (항목을 옮기면 고치던 에디터의 초점이 빠진다)
    const place = (top: HTMLElement) => {
      const at: ChildNode | null = prev ? prev.nextSibling : this.sheets.parentElement === this.page ? this.sheets.nextSibling : this.page.firstChild;
      if (at !== top) this.page.insertBefore(top, at);
      prev = top;
    };
    // 블록에 묶지 않은 손그림: 가까운 획끼리 한 그림으로, 자리 순서대로 끼운다
    const cov = this.cover.element(); if (cov) place(cov); // 표지 쪽이 있으면 맨 앞
    if (this.opts.header) { this.headerEl ??= Object.assign(document.createElement('h1'), { className: 'dn-doc-header' }); this.headerEl.textContent = this.opts.header; place(this.headerEl); }
    const figs = inkFigures(e).map((x) => ({ f: x, slot: figureSlot(shown, x) })).sort((a, b) => a.slot - b.slot);
    const usedFigs = new Set<string>();
    let fi = 0, idx = 0;
    const figure = () => {
      const { f: fig } = figs[fi++]!;
      const key = fig.ids.join(',');
      usedFigs.add(key);
      const sig = fig.ids.map((id) => e.getStroke(id));
      let it = this.figs.get(key);
      if (!it || it.sig.some((x, i) => x !== sig[i])) {
        const el = it?.el ?? Object.assign(document.createElement('figure'), { className: 'dn-doc-item dn-doc-ink' });
        const svg = document.createElement('div');
        renderInkPaths(figurePaths(e, fig), svg);
        el.replaceChildren(svg);
        el.title = '캔버스에 그린 손그림 — 고치기는 캔버스에서';
        el.dataset.strokes = fig.ids.join(',');
        it = { el, sig };
        this.figs.set(key, it);
      }
      place(it.el);
    };
    // 흐름에 든 블록은 나란히 놓여 있어도 컬럼으로 묶지 않는다 (차례가 있는 단계)
    for (const row of docRows(shown, (b) => info.get(b.id)?.flow === undefined)) {
      while (fi < figs.length && figs[fi]!.slot <= idx) figure();
      idx += row.length;
      let top: HTMLElement;
      if (row.length > 1) {
        const key = row.map((b) => b.id).join('|');
        usedRows.add(key);
        let wrap = this.rows.get(key);
        if (!wrap) { wrap = document.createElement('div'); wrap.className = 'dn-doc-row'; this.rows.set(key, wrap); }
        const want: HTMLElement[] = [];
        row.forEach((b, i) => {
          if (i) {
            const gk = `${row[i - 1]!.id}|${b.id}`;
            usedGaps.add(gk);
            let g = this.gaps.get(gk);
            if (!g) { g = columnGap(e, row[i - 1]!.id, b.id, !!this.opts.readOnly); this.gaps.set(gk, g); }
            want.push(g);
          }
          const el = itemOf(b);
          el.style.flex = `${Math.max(1, b.w)} 1 0`;
          want.push(el);
        });
        if (wrap.children.length !== want.length || want.some((el, i) => wrap!.children[i] !== el)) wrap.replaceChildren(...want);
        top = wrap;
      } else {
        top = itemOf(row[0]!);
        top.style.flex = '';
      }
      place(top);
    }
    while (fi < figs.length) figure();
    for (const [k, it] of this.figs) if (!usedFigs.has(k)) { it.el.remove(); this.figs.delete(k); }
    for (const [k, w] of this.rows) if (!usedRows.has(k)) { w.remove(); this.rows.delete(k); }
    for (const k of [...this.gaps.keys()]) if (!usedGaps.has(k)) this.gaps.delete(k);
    for (const [id, it] of this.items) if (!seen.has(id)) { it.el.remove(); this.items.delete(id); }
    this.diagrams.sweep(usedDg);
    if (keep) this.range.restore(keep);
    this.select?.paint();
    syncFootnotes(this.page, e); // 맨 끝 각주 목록
    refreshXrefs(this.page); // 다시 그리지 않은 글의 상호 참조도 지금 번호로
    const empty = this.opts.word && !this.opts.readOnly ? '여기를 눌러 바로 쓰기 시작하세요.' : '아직 상자가 없어요. 캔버스에서 상자를 만들면 여기에 순서대로 보여요.';
    if (!order.length && !figs.length) { if (!this.page.querySelector('.dn-doc-empty')) this.page.append(Object.assign(document.createElement('p'), { className: 'dn-doc-empty', textContent: empty })); }
    else this.page.querySelector('.dn-doc-empty')?.remove();
    if (this.sizes) { this.sizes.disconnect(); for (const el of this.page.children) if (el !== this.sheets) this.sizes.observe(el); }
    this.layoutPages();
    this.word.emit();
  }

  private fill(b: Block, el: HTMLElement, next?: Id, parent?: Id): void {
    const e = this.opts.engine;
    const contents = e.contentsOf(b.id);
    const { title, bodies } = blockTextParts(contents);
    el.classList.toggle('dn-doc-heading', !!title && !bodies.length && contents.length === 1 && !b.nodeKind); // 종류가 있는 상자(AI 노드)는 소제목이 아니라 개념
    el.dataset.color = blockColor(b) ?? '';
    el.dataset.brace = b.group && e.note.groups?.[b.group]?.bracket === 'brace' ? '1' : ''; // 중괄호 묶음: 문서에서는 왼쪽 중괄호 선
    el.classList.toggle('dn-doc-break', !!b.pageBreak);
    applyTextStyle(el, b);
    // 편집 중인 블록은 다시 짓지 않는다 — 에디터를 떼었다 붙이면 포커스가 빠져 입력이 끊긴다. 엔진 쪽 변경(실행 취소 등)만 맞춘다
    const ed = this.word.editor;
    if (ed && contents.some((c) => c.id === ed.contentId)) {
      const c = e.getContent(ed.contentId);
      if (c && isTextContent(c)) ed.ed.setDoc(c.doc);
      kindTag(b, { el });
      return;
    }
    // 표 칸을 고치는 중이면 그 표만 고친 칸을 빼고 맞춘다 (칸을 떼면 편집이 끊긴다)
    const cell = this.table.cell;
    if (cell && contents.some((c) => c.id === cell.contentId)) {
      const c = e.getContent(cell.contentId);
      if (c && isTableContent(c)) {
        renderTable(c, cell.part, { rowId: cell.rowId, colId: cell.colId });
        // 실행 취소 · 다시 실행: 고치는 칸 편집기에도 엔진 글을 (캔버스 mount.ts와 같게). 칸이 사라졌으면 닫고, 표가 다시 지어져 초점이 빠졌으면 되돌린다
        // (아직 글이 없는 칸은 데이터에 칸이 없다 — 빈 칸으로 본다)
        const row = c.rows.find((r) => r.id === cell.rowId), ed = cell.editor;
        if (!row || !c.columns.some((x) => x.id === cell.colId) || !ed || !cell.part.contains(ed.view.dom)) this.table.close();
        else { ed.setDoc(toTitleDoc(row.cells[cell.colId] ?? cellDoc(''))); if (!ed.view.hasFocus()) ed.focus(); }
      }
      return;
    }
    const parts = docParts(this, b, contents, next, parent);
    el.replaceChildren(...parts);
    syncCaption(el, e, b.id, this.caps.get(b.id), !!this.opts.readOnly); // 표는 위 · 그림은 아래
    kindTag(b, { el }); // 종류 · 상태 · 역할 · 발화자 (캔버스와 같은 표시)
    const head = this.heads.get(b.id); // 묶음 소제목 — 고정 틀이면 칸 이름
    if (head) el.prepend(Object.assign(document.createElement('div'), { className: 'dn-doc-ghead', textContent: head }));
  }

  private onDown(ev: MouseEvent): void {
    const t = ev.target instanceof Element ? ev.target : null;
    if (!t || this.opts.readOnly || ev.button !== 0) return; // 오른쪽 · 가운데 버튼은 메뉴 · 스크롤 몫 — 누른 문단을 열지 않는다
    // 편집기 안 · 편집기가 띄운 창, 또는 누르는 사이 다시 그려져 떨어진 요소(수식 미리보기 등)는 편집기 몫
    if (!t.isConnected || t.closest('.dn-editor-pop, .dn-caption, .dn-table-sort')) return; // 캡션은 눌러서 고친다 (caption-view.ts) · 표 정렬 단추 (table-sort-ui.ts)
    if (t.closest('.dn-web .dn-ui')) { this.select?.clear(); return; } // 웹 블록의 주소 칸 · 단추: 블록 고르기는 풀고 그 칸에 맡긴다 (DQ-016)
    if (t.closest('.dn-button .dn-ui, .dn-tabs-strip')) return; // 버튼 · 고치기(⋯) · 탭 줄: 고른 상자는 그대로 — '고른 상자로 바꾸기'
    if (this.select?.down(ev)) return;
    if (t.closest('.dn-text-editing')) return;
    const link = t.closest<HTMLElement>('a.dn-note-link[data-note]');
    if (link && this.opts.noteLinks && !link.classList.contains('missing')) { ev.preventDefault(); this.opts.noteLinks.open(link.dataset.note!); return; }
    const xref = t.closest<HTMLElement>('a.dn-xref[data-xref]:not(.missing)'); // 상호 참조: 그 그림 · 표로
    if (xref) { ev.preventDefault(); this.word.close(); this.focusBlock(xref.dataset.xref!); return; }
    const mt = t.closest<HTMLElement>('.dn-media-time'); if (mt) { ev.preventDefault(); mediaSeek(mt); return; } // 녹음 재생 시각 (FR-044)
    // 표: 칸 · 머리글을 누르면 그 자리에서 고치기 (DQ-005). 고치던 칸 · 표 도구는 그대로
    if (t.closest('.dn-cell-editing, .dn-table-tools, .dn-th-input')) return;
    if (ev.shiftKey && this.table.extend(t)) { ev.preventDefault(); return; } // 칸 합치기 고르기
    this.table.close();
    if (t.closest('.dn-table td[data-row], .dn-table th[data-col]')) { this.word.close(); if (this.table.down(t)) { ev.preventDefault(); return; } }
    // 고치지 않는 글의 토글 화살표 · 할 일 상자는 한 번에 접기 · 체크 (DQ-012)
    if (this.opts.word && flipStatic(this.opts.engine, ev)) { this.word.close(); return; }
    const part = t.closest<HTMLElement>('.dn-doc-text[data-part]');
    if (part) { ev.preventDefault(); this.word.openAt(part, ev); return; }
    // 빈 곳(항목 안이라도 내용 밖 — 짧은 제목 옆 등): 끌면 끌어 고르기, 그냥 떼면 새 문단 · 가까운 글 칸 (doc-marquee).
    // 두 번째 누르기는 '클릭하여 입력' 몫 (dblclick, doc-click-type.ts)
    const blank = !t.closest('.dn-doc-item') || !t.closest('[data-part], .dn-kind-tag, button, a, input, select, textarea');
    if (this.opts.word && blank && !t.closest('.dn-doc-gap')) { ev.preventDefault(); if (ev.detail < 2) this.marquee?.begin(ev); return; }
    this.word.close();
  }

  /**
   * 오른쪽 클릭: 블록 속성 메뉴. 고치는 글 안이면 그 상자 메뉴(잘라내기 · 복사 · 붙여넣기 + 글자 · 상자) — 캔버스 편집 중과 같게 (AT-005).
   * Shift+오른쪽 클릭 · 표 칸 · 입력 칸 안은 브라우저 메뉴 그대로 (맞춤법 · 복사 · 붙여넣기)
   */
  private onContext(ev: MouseEvent): void {
    const t = ev.target instanceof Element ? ev.target : null;
    if (!t || this.opts.readOnly || !this.opts.onBlockMenu || ev.shiftKey) return;
    const ed = this.word.editor;
    if (ed && t.closest('.dn-text-editing') && ed.el.contains(t)) {
      ev.preventDefault();
      this.opts.onBlockMenu({ ids: [ed.blockId], x: ev.clientX, y: ev.clientY, editing: true, doc: true });
      return;
    }
    if (t.closest('.dn-text-editing, .dn-cell-editing, input, textarea, .dn-editor-pop, .dn-db-ui')) return;
    const id = t.closest<HTMLElement>('.dn-doc-item[data-id]')?.dataset.id;
    if (!id) return;
    ev.preventDefault();
    this.word.close();
    const sel = this.select?.selected().blocks ?? [];
    if (!sel.includes(id)) this.select?.selectBlock(id);
    this.opts.onBlockMenu({ ids: sel.includes(id) ? sel : [id], x: ev.clientX, y: ev.clientY, doc: true });
  }

  /** 블록 위치로 스크롤 (검색 결과 · 링크) */
  focusBlock(id: Id): void {
    const el = this.items.get(id)?.el;
    el?.scrollIntoView({ block: 'center' });
    el?.classList.add('dn-doc-flash');
    setTimeout(() => el?.classList.remove('dn-doc-flash'), 1200);
  }

  /** 도식 그림이 다 그려질 때까지 (인쇄 · PDF · 워드로 내보내기 전에) */
  diagramsReady(): Promise<void> { return this.diagrams.ready(); }

  destroy(): void {
    this.diagrams.sweep(new Set());
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.pageFrame);
    this.sizes?.disconnect();
    this.word.close(false);
    this.table.close();
    this.select?.destroy();
    this.handle?.destroy();
    this.marquee?.destroy();
    this.unsub();
    this.root.remove();
  }
}

