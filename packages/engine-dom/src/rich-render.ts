// 스키마 v4 콘텐츠 그리기 (FR-018 · FR-107 · FR-108): 그래프(막대 · 꺾은선 · 원)는 SVG, 표는 HTML 표 + 셀마다 정적 렌더.
// 라이브러리 없이 DOM API만 쓴다. 크기는 블록 폭에 맞춰 늘고(viewBox), 높이는 측정(layout)으로 따라온다.
import { formatBytes, formatDuration, inkPaths, type InkSvg, mediaKind, mergeSpans, sortedRows, tableSortState, type Engine, type FileContent, type ImageContent, type TableContent, isPdfFile } from '@dn/engine-core';
import { renderStatic } from '@dn/text-pm';
import { headerCell } from './table-sort-ui';
import { inkTone } from './theme';

import { svg } from './svg';
export { svg };
export { renderChart } from './chart-render';

/** 표: 제목 · 머리글 · 행. 셀마다 data-row · data-col (편집 시작 지점). 편집 중인 셀은 건드리지 않는다. */
export function renderTable(c: TableContent, el: HTMLElement, editing?: { rowId: string; colId: string }): void {
  el.className = 'dn-table';
  // 구성(제목 · 열 · 행 id)이 그대로면 바뀐 칸만 고쳐 그린다. 편집 중인 칸은 건드리지 않는다 —
  // 칸을 떼었다 붙이면 브라우저가 포커스를 빼서 편집이 끝나 버린다.
  const shape = `${c.title ?? ''}|${c.columns.map((x) => `${x.id}:${x.name}:${tableSortState(c, x.id) ?? ''}`).join(',')}|${sortedRows(c).map((r) => r.id).join(',')}|${JSON.stringify(c.merges ?? [])}|${c.noHeader ? 'h0' : ''}${c.headerCol ? 'c1' : ''}`;
  if (el.dataset.shape === shape && el.querySelector('table')) {
    for (const row of c.rows) {
      for (const col of c.columns) {
        if (editing && editing.rowId === row.id && editing.colId === col.id) continue;
        const td = el.querySelector<HTMLElement>(`td[data-row="${row.id}"][data-col="${col.id}"]`);
        const doc = row.cells[col.id];
        // 편집기를 막 뗀 칸(표시가 남은 칸)은 글이 그대로여도 다시 그린다 — 편집기가 칸 안을 떼어 가 비어 있다 (DE-004)
        if (!td || (drawn.get(td) === doc && !td.classList.contains('dn-cell-editing'))) continue;
        td.classList.remove('dn-cell-editing');
        if (doc) renderStatic(doc, td); else td.replaceChildren();
        drawn.set(td, doc);
      }
    }
    return;
  }
  el.dataset.shape = shape;
  const keep = editing ? el.querySelector<HTMLTableCellElement>(`td[data-row="${editing.rowId}"][data-col="${editing.colId}"]`) : null;
  el.replaceChildren();
  if (c.title) el.appendChild(Object.assign(document.createElement('div'), { className: 'dn-table-title', textContent: c.title }));
  const table = document.createElement('table');
  // 머리 행(열 이름 줄)은 끌 수 있다 · 첫 열을 머리 모양으로 (engine-core table-head.ts)
  if (!c.noHeader) {
    const head = table.createTHead().insertRow();
    for (const col of c.columns) {
      const th = document.createElement('th');
      th.dataset.col = col.id;
      headerCell(th, col.name, tableSortState(c, col.id)); // 이름 + 정렬 단추 (table-sort-ui.ts)
      head.appendChild(th);
    }
  }
  const headCol = c.headerCol ? c.columns[0]?.id : undefined;
  const body = table.createTBody();
  // 합친 칸 (table-merge.ts): 왼쪽 위 칸에 rowspan · colspan, 덮인 칸은 그리지 않는다
  const { spans, covered } = mergeSpans(c);
  for (const row of sortedRows(c)) {
    const tr = body.insertRow();
    tr.dataset.row = row.id;
    for (const col of c.columns) {
      const key = `${row.id}:${col.id}`, span = spans.get(key);
      if (covered.has(key)) continue;
      // 고치는 칸은 그 요소를 그대로 (합친 칸이 바뀌었으면 넓이만 맞춘다)
      if (keep && editing!.rowId === row.id && editing!.colId === col.id) { keep.rowSpan = span?.rows ?? 1; keep.colSpan = span?.cols ?? 1; tr.appendChild(keep); continue; }
      const td = document.createElement('td');
      td.dataset.row = row.id;
      td.dataset.col = col.id;
      if (span) { td.rowSpan = span.rows; td.colSpan = span.cols; }
      if (col.id === headCol) td.classList.add('dn-td-head');
      const doc = row.cells[col.id];
      if (doc) renderStatic(doc, td);
      drawn.set(td, doc);
      tr.appendChild(td);
    }
  }
  el.appendChild(table);
}

/** 셀 → 마지막으로 그린 문서 (같으면 다시 그리지 않는다) */
const drawn = new WeakMap<HTMLElement, unknown>();

/** 이미지: 원래 비율로 자리를 먼저 잡고(높이 측정이 흔들리지 않게) 첨부 주소가 오면 채운다 */
export function renderImage(c: ImageContent, el: HTMLElement, url: ((hash: string) => Promise<string | null>) | undefined): void {
  el.className = 'dn-image';
  let img = el.querySelector('img');
  if (!img) {
    img = document.createElement('img');
    img.draggable = false;
    el.replaceChildren(img);
  }
  img.alt = c.alt ?? '';
  img.style.aspectRatio = `${Math.max(1, c.natural.w)} / ${Math.max(1, c.natural.h)}`;
  if (img.dataset.hash === c.attachment) return;
  img.dataset.hash = c.attachment;
  img.removeAttribute('src');
  const pic = img;
  void (url?.(c.attachment) ?? Promise.resolve(null)).then((u) => {
    if (pic.dataset.hash !== c.attachment) return;
    if (u) { pic.src = u; el.classList.remove('dn-missing'); }
    else { el.classList.add('dn-missing'); el.dataset.msg = '이미지 파일을 찾을 수 없어요'; }
  });
}

/** 블록에 묶인 잉크 (FR-037) → SVG. 문서 뷰에서 — 캔버스에서는 잉크 레이어가 블록 자리에 그린다 */
export function renderInkSvg(engine: Engine, contentId: string, el: HTMLElement): void {
  const ink = inkPaths(engine, contentId);
  el.className = 'dn-ink-svg';
  if (!ink) { el.replaceChildren(); return; }
  renderInkPaths(ink, el);
}

/** SVG 경로 → 그림 (묶인 잉크 · 문서의 손그림) */
export function renderInkPaths(ink: InkSvg, el: HTMLElement): void {
  el.classList.add('dn-ink-svg');
  const root = svg('svg', { viewBox: `0 0 ${ink.w} ${ink.h}`, role: 'img', 'aria-label': `손글씨 ${ink.paths.length}획` });
  root.style.maxWidth = `${ink.w}px`;
  for (const p of ink.paths) {
    // 검정 · 흰 펜은 바탕 따라 (AT-021) — 앱 CSS --dn-ink-k(어두운 바탕) · --dn-ink-w(밝은 바탕)가 있으면 그 색, 없으면 저장 색
    const tone = p.hl ? null : inkTone(p.color);
    root.append(svg('path', { d: p.d, fill: 'none', stroke: p.color, 'stroke-width': p.width, 'stroke-linecap': p.hl ? 'butt' : 'round', 'stroke-linejoin': 'round', ...(p.hl ? { opacity: '0.35' } : {}), ...(tone ? { style: `stroke: var(--dn-ink-${tone}, ${p.color})` } : {}) }));
  }
  el.replaceChildren(root);
}

/** 첨부 파일 카드 (FR-052): 형식 표시 · 이름 · 크기 · 내려받기. 소리 · 영상(녹음 블록 FR-043 포함)은 아래에 재생기 · 배속 */
/** o.onPreview: PDF 펼치기 · 접기 (없으면 단추 없음 — 보기 전용), o.shield: 캔버스 — iframe 위 덮개(두 번 눌러 안을 쓴다), o.blob: 첨부 내용 */
export interface PdfOpts { onPreview?: (on: boolean) => void; shield?: boolean; blob?: (hash: string) => Promise<Blob | null> }
export function renderFile(c: FileContent, el: HTMLElement, url: ((hash: string) => Promise<string | null>) | undefined, o: PdfOpts = {}): void {
  const media = mediaKind(c.mime);
  el.className = media ? `dn-file dn-media dn-media-${media}` : 'dn-file';
  const ext = (c.name.split('.').pop() ?? '').slice(0, 4).toUpperCase() || 'FILE';
  const badge = document.createElement('span');
  badge.className = 'dn-file-ext';
  badge.textContent = c.name.includes('.') ? ext : 'FILE';
  const info = document.createElement('span');
  info.className = 'dn-file-info';
  const name = document.createElement('span');
  name.className = 'dn-file-name';
  name.textContent = c.name;
  name.title = c.name;
  const size = document.createElement('span');
  size.className = 'dn-file-size';
  size.textContent = c.duration ? `${formatDuration(c.duration)} · ${formatBytes(c.size)}` : formatBytes(c.size);
  info.append(name, size);
  const a = document.createElement('a');
  a.className = 'dn-file-dl dn-ui';
  a.textContent = '내려받기';
  a.download = c.name;
  a.setAttribute('aria-label', `${c.name} 내려받기`);
  a.href = '#';
  const missing = () => { el.classList.add('dn-missing'); el.dataset.msg = '파일을 찾을 수 없어요'; };
  a.addEventListener('click', (e) => {
    if (a.dataset.ready) return;
    e.preventDefault();
    void (url?.(c.attachment) ?? Promise.resolve(null)).then((u) => {
      if (!u) { missing(); return; }
      a.href = u; a.dataset.ready = '1'; a.click();
    });
  });
  if (!media) {
    if (!isPdfFile(c)) { el.replaceChildren(badge, info, a); return; }
    renderPdf(c, el, o, [badge, info], a, missing);
    return;
  }
  const row = document.createElement('div');
  row.className = 'dn-file-row';
  // 재생기: 캔버스 조작(끌기 · 선택)과 겹치지 않게 dn-ui. 주소는 첨부 저장소에서 (메타데이터만 먼저 읽는다)
  const player = document.createElement(media);
  player.className = 'dn-media-player dn-ui';
  player.controls = true;
  player.preload = 'metadata';
  player.setAttribute('aria-label', `${c.name} 재생`);
  void (url?.(c.attachment) ?? Promise.resolve(null)).then((u) => { if (u) player.src = u; else missing(); });
  // 브라우저 녹음(MediaRecorder webm)은 길이 정보가 없어 탐색 막대가 안 움직인다 — 끝으로 한 번 보내 길이를 계산시킨 뒤 처음으로
  player.addEventListener('loadedmetadata', () => {
    if (player.duration !== Infinity) return;
    player.addEventListener('durationchange', function back() {
      if (player.duration === Infinity) return;
      player.removeEventListener('durationchange', back);
      player.currentTime = 0;
    });
    player.currentTime = 1e101;
  }, { once: true });
  const rate = document.createElement('button');
  rate.type = 'button';
  rate.className = 'dn-media-rate dn-ui';
  rate.textContent = '1×';
  rate.title = '재생 속도';
  rate.setAttribute('aria-label', '재생 속도 1배');
  rate.addEventListener('click', () => {
    const next = RATES[(RATES.indexOf(player.playbackRate) + 1) % RATES.length]!;
    player.playbackRate = next;
    rate.textContent = `${next}×`;
    rate.setAttribute('aria-label', `재생 속도 ${next}배`);
  });
  row.append(badge, info, rate, a);
  el.replaceChildren(row, player);
}

/** 배속 차례: 1 → 1.25 → 1.5 → 2 → 0.75 → 1 */
const RATES = [1, 1.25, 1.5, 2, 0.75];

/** PDF (GAP #22): 카드 줄(펼쳐 보기 · 내려받기) + 펼치면 브라우저 PDF 보기. 캔버스에서는 덮개를 두 번 눌러야 안을 쓴다(웹 임베드와 같은 dn-web-embed · liveWeb) */
const pdfUrls = new WeakMap<HTMLElement, string>();
function renderPdf(c: FileContent, el: HTMLElement, o: PdfOpts, head: HTMLElement[], dl: HTMLElement, missing: () => void): void {
  const old = pdfUrls.get(el);
  if (old) { URL.revokeObjectURL(old); pdfUrls.delete(el); }
  el.classList.add('dn-file-pdf');
  const row = document.createElement('div');
  row.className = 'dn-file-row';
  row.append(...head);
  if (o.onPreview) {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'dn-file-pv dn-ui';
    t.textContent = c.preview ? '접기' : '펼쳐 보기';
    t.title = c.preview ? 'PDF 접기' : 'PDF를 노트 안에서 펼쳐 보기';
    t.addEventListener('click', (e) => { e.stopPropagation(); o.onPreview!(!c.preview); });
    row.append(t);
  }
  row.append(dl);
  if (!c.preview) { el.replaceChildren(row); return; }
  const box = document.createElement('div');
  box.className = 'dn-web-embed dn-pdf-view';
  const frame = document.createElement('iframe');
  frame.className = 'dn-pdf-frame';
  frame.title = `${c.name} 보기`;
  box.append(frame);
  if (o.shield) { const s = document.createElement('div'); s.className = 'dn-web-shield'; s.title = '두 번 누르면 PDF를 넘겨 볼 수 있어요'; box.append(s); }
  // 보안: 이름 · 형식은 바꿔 붙일 수 있다(가져온 백업 등) — 머리 바이트가 %PDF-일 때만, PDF 형식으로 다시 싸서 연다.
  // 같은 출처 blob iframe에 HTML이 열리면 스크립트가 앱 권한으로 돈다 (CSP frame-src blob:은 이 길만 쓴다)
  void (o.blob?.(c.attachment) ?? Promise.resolve(null)).then(async (b) => {
    if (!b) { missing(); return; }
    const buf = await b.arrayBuffer();
    if (new TextDecoder().decode(buf.slice(0, 5)) !== '%PDF-') { box.replaceChildren(Object.assign(document.createElement('div'), { className: 'dn-pdf-bad', textContent: 'PDF 파일이 아니라 펼쳐 볼 수 없어요 — 내려받아 열어 주세요.' })); return; }
    if (!el.contains(frame)) return; // 그 사이 다시 그렸다
    const u = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
    pdfUrls.set(el, u);
    frame.src = u;
  });
  el.replaceChildren(row, box);
}
