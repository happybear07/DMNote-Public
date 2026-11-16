// 내보내기 (FR-130): 노트 → Markdown, 모든 노트 → ZIP(폴더 구조 그대로의 .md + 손실 없는 백업 JSON).
import { arrowChip, isBound, captionNumbers, chartCategories, embedTarget, isEmbedContent, isWebContent, isKnownRelation, RELATION_LABEL, dbCellTextIn, dbRows, documentOrder, figurePaths, figureSlot, inkFigures, isDatabaseContent, isFileContent, inkPaths, inkSvgString, isImageContent, isInkContent, isTableContent, isTextContent, isTocContent, tocEntries, sortedRows, textLines, type Content, type Engine, type NoteSnapshot, isButtonContent, isTabsContent, groupHeadings, isDividerContent } from '@dn/engine-core';
import type { Folder, NoteMeta, Tag } from '@dn/storage-idb';
import { docToMarkdown } from '@dn/text-pm';
import type { UserTemplate } from './templates';
import { blockFirstLine, displayTitle } from './ws-model';

export interface ExportContext {
  /** 노트 링크 · 화살표 이름에 쓸 지금 제목 */
  noteTitle(id: string): string | null;
  tags?: readonly Tag[];
  /** 상호 참조에 쓸 번호 (noteToMarkdown이 채운다) */
  xref?(id: string): string | null;
  /** 이미지 파일 경로 (ZIP 안, 이 노트 .md에서 본 상대 경로). 없으면 이미지는 캡션만 */
  imagePath?(hash: string): string | null;
  /** 빼고 쓸 블록 (노트 요약 입력에서 이전 'AI 요약' 상자) */
  skip?: ReadonlySet<string>;
}

const fmtDate = (t: number) => new Date(t).toISOString();

/** 노트 하나 → Markdown. 앞머리(YAML)에 제목 · 날짜 · 태그, 블록은 읽기 순서(위 → 아래, 같은 줄은 왼쪽 → 오른쪽), 끝에 화살표 관계 */
export function noteToMarkdown(engine: Engine, meta: NoteMeta, ctx: ExportContext): string {
  const title = displayTitle(meta);
  const tags = (meta.tagIds ?? []).map((id) => ctx.tags?.find((t) => t.id === id)?.name).filter((x): x is string => !!x);
  const front = ['---', `title: ${yamlStr(title)}`, `created: ${fmtDate(meta.createdAt)}`, `updated: ${fmtDate(meta.updatedAt)}`,
    ...(tags.length ? [`tags: [${tags.map(yamlStr).join(', ')}]`] : []),
    // 노트 아이콘 (FR-070) — 이모지일 때만 (선 아이콘은 앱 안에서만 보인다)
    ...(engine.note.icon && !engine.note.icon.startsWith('icon:') ? [`icon: ${yamlStr(engine.note.icon)}`] : []), '---'].join('\n');

  // 같은 줄 판정은 40px 단위 — 나란한 상자가 약간 어긋나 있어도 왼쪽부터 (문서 뷰 · 목차와 같은 규칙)
  const blocks = documentOrder(engine).map((x) => x.block).filter((b) => !ctx.skip?.has(b.id)); // 문서 뷰와 같은 순서 (화살표 흐름 차례)
  const parts: string[] = [`# ${title}`];
  // 블록에 묶지 않은 손그림도 자리 순서대로 그림으로 (문서 뷰와 같은 자리)
  const figs = inkFigures(engine).map((f) => ({ f, slot: figureSlot(blocks, f) }));
  const figAt = (i: number) => { for (const x of figs) if (x.slot === i && x.f.ids.length) parts.push(`![손그림](data:image/svg+xml;base64,${btoa(inkSvgString(figurePaths(engine, x.f)))})`); };
  const caps = captionNumbers(engine); // 그림 · 표 캡션 — 표는 위, 그림은 아래 (문서 뷰와 같게)
  ctx = { ...ctx, xref: (id) => caps.get(id)?.label ?? null }; // 상호 참조는 지금 번호로
  const named = new Set<string>(); // 이름 있는 묶음은 첫 상자 앞에 소제목 (문서 뷰와 같게, STRUCTURE-GUIDE 4.11) — 번호 켠 카드는 '번호. 이름'
  const heads = groupHeadings(engine);
  for (const [i, b] of blocks.entries()) {
    figAt(i);
    const gname = b.group && !named.has(b.group) ? heads.get(b.group) : undefined;
    if (gname) { named.add(b.group!); parts.push(`### ${gname}`); }
    const cap = caps.get(b.id), capLine = cap && b.caption ? `*${cap.label}. ${b.caption}*` : '';
    if (capLine && cap!.kind === '표') parts.push(capLine);
    const md = engine.contentsOf(b.id).map((c) => (isInkContent(c) ? inkMarkdown(engine, c.id) : isTocContent(c) ? tocMarkdown(engine, c.depth) : contentToMarkdown(c, ctx, engine))).filter(Boolean).join('\n\n');
    if (md.trim()) parts.push(md);
    if (capLine && cap!.kind === '그림') parts.push(capLine);
  }
  figAt(blocks.length);
  const arrows = [...engine.arrows()].filter(isBound); // 빈 곳 화살표(11/09)는 관계 목록에 안 넣는다
  if (arrows.length) {
    const name = (id: string) => blockName(engine, id);
    // 관계 종류(v6)가 있으면 이름으로 덧붙인다 — 라벨(원문 구절)과 따로
    const kind = (r?: string) => (r ? ` · 관계: ${isKnownRelation(r) ? RELATION_LABEL[r] : r}` : '');
    parts.push(['## 관계', ...arrows.map((a) => `- ${name(a.from.blockId)} → ${name(a.to.blockId)}${arrowChip(a) ? ` (${arrowChip(a)})` : ''}${kind(a.relation)}`)].join('\n'));
  }
  return `${front}\n\n${parts.join('\n\n')}\n`;
}

/** 목차 블록 (FR-053) → 제목 목록 (단계만큼 들여쓰기) */
function tocMarkdown(engine: Engine, depth?: 1 | 2 | 3): string {
  const entries = tocEntries(engine, depth);
  if (!entries.length) return '';
  const top = Math.min(...entries.map((e) => e.level));
  return ['**목차**', ...entries.map((e) => `${'  '.repeat(e.level - top)}- ${e.text}`)].join('\n');
}

/** 묶인 잉크 → SVG 그림 (data URI — 파일 하나로 열어도 보인다) */
function inkMarkdown(engine: Engine, contentId: string): string {
  const ink = inkPaths(engine, contentId);
  if (!ink?.paths.length) return '';
  return `![손글씨](data:image/svg+xml;base64,${btoa(inkSvgString(ink))})`;
}

function contentToMarkdown(c: Content, ctx: ExportContext, engine: Engine): string {
  if (isTextContent(c)) {
    if (c.role === 'title') return `## ${textLines(c.doc).join(' ').trim()}`;
    return docToMarkdown(c.doc, { noteTitle: ctx.noteTitle, xref: (id) => ctx.xref?.(id) ?? null });
  }
  // 구분선 (노트형): 가로선은 ---, 가운데 글이 있으면 글이 보이게 — 세로선은 문서에서 건너뛴다
  if (isDividerContent(c)) return c.orient === 'v' ? '' : c.label ? `--- ${c.label} ---` : '---';
  const d = c as Content & Record<string, unknown>;
  const title = typeof d.title === 'string' && d.title ? d.title : '';
  if (isTableContent(c)) {
    const rows = sortedRows(c).map((r) => c.columns.map((x) => inlineMd(r.cells[x.id], ctx)));
    return [title && `**${title}**`, mdTable(c.columns.map((x) => x.name), rows)].filter(Boolean).join('\n\n');
  }
  // v0(스키마 v3 이전 임시 형식) — 열 이름 · 행 글자 배열
  if (c.type === 'table' && Array.isArray(d.columns) && Array.isArray(d.rows)) {
    return [title && `**${title}**`, mdTable(d.columns as string[], d.rows as string[][])].filter(Boolean).join('\n\n');
  }
  if (c.type === 'chart' && Array.isArray(d.series)) {
    const series = d.series as { name: string; points: { x: string | number; y: number }[] }[];
    const xs = chartCategories({ categories: Array.isArray(d.categories) ? (d.categories as string[]) : undefined, series });
    const kind = ({ bar: '막대', line: '꺾은선', pie: '원' } as Record<string, string>)[String(d.kind ?? d.chartKind)] ?? '';
    const caption = `*그래프${kind ? `(${kind})` : ''}: ${title || '제목 없음'}${typeof d.unit === 'string' && d.unit ? ` · 단위 ${d.unit}` : ''}*`;
    const rows = xs.map((x) => [x, ...series.map((s) => { const p = s.points.find((q) => String(q.x) === x); return p ? String(p.y) : '—'; })]);
    return `${caption}\n\n${mdTable(['', ...series.map((s) => s.name)], rows)}`;
  }
  if (isDatabaseContent(c)) {
    // 데이터베이스: 숨기지 않은 속성만, 보이는 글자로 (선택 = 옵션 이름, 체크 = 예)
    const props = c.properties.filter((p) => !p.hidden);
    const rows = dbRows(c).map((r) => props.map((p) => dbCellTextIn(engine, c, r, p)));
    return [`**${c.title || '데이터베이스'}**`, mdTable(props.map((p) => p.name), rows)].join('\n\n');
  }
  if (isEmbedContent(c)) {
    const t = ctx.noteTitle(c.srcNote);
    return `> *임베드한 블록 — 원본: ${t ? `[[${t.replace(/[[\]|]/g, ' ').trim()}]]` : '없는 노트'}*`;
  }
  // 웹 북마크 · 임베드 (FR-050 · FR-051): 링크 한 줄 + 설명
  if (isWebContent(c)) {
    if (!c.url) return '';
    const t = c.view === 'embed' ? embedTarget(c.url) : null;
    const label = (c.title || c.url).replace(/[[\]]/g, '');
    return [`${t ? `${t.provider}: ` : ''}[${label}](${c.url.replace(/\(/g, '%28').replace(/\)/g, '%29')})`, c.description && `> ${c.description}`].filter(Boolean).join('\n\n');
  }
  if (isFileContent(c)) {
    const path = ctx.imagePath?.(c.attachment);
    const name = c.name.replace(/[[\]]/g, '');
    return path ? `첨부 파일: [${name}](${encodeURI(path)})` : `*첨부 파일: ${name}*`;
  }
  if (isImageContent(c)) {
    const path = ctx.imagePath?.(c.attachment);
    const alt = (c.alt ?? '').replace(/[[]]/g, '');
    return path ? `![${alt}](${encodeURI(path)})` : `*이미지${alt ? `: ${alt}` : ''}*`;
  }
  if (isButtonContent(c)) return ''; // 버튼은 화면 단추 — 노션 내보내기처럼 뺀다
  // 탭: 탭마다 이름(굵게) + 글, 모든 탭을 차례로
  if (isTabsContent(c)) return c.tabs.map((t) => [`**${t.label}**`, docToMarkdown(t.doc, { noteTitle: ctx.noteTitle, xref: (id) => ctx.xref?.(id) ?? null })].filter(Boolean).join('\n\n')).join('\n\n');
  return `*(이 버전에서 내보낼 수 없는 콘텐츠: ${c.type})*`;
}

function mdTable(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${columns.map(cell).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${columns.map((_, i) => cell(r[i])).join(' | ')} |`)].join('\n');
}

/** 화살표 목록에 쓸 블록 이름: 첫 줄 글자 (없으면 표 · 그래프 제목, 그것도 없으면 '상자') */
function blockName(engine: Engine, id: string): string {
  const contents = engine.contentsOf(id);
  const line = blockFirstLine(contents);
  if (line) return line.slice(0, 60);
  const t = contents.map((c) => (c as Record<string, unknown>).title).find((x) => typeof x === 'string' && x);
  return typeof t === 'string' ? t : '상자';
}

/** 셀 문서 → 표 칸에 넣을 한 줄 Markdown (줄바꿈은 공백) */
function inlineMd(doc: Parameters<typeof docToMarkdown>[0] | undefined, ctx: ExportContext): string {
  return doc ? docToMarkdown(doc, { noteTitle: ctx.noteTitle, xref: (id) => ctx.xref?.(id) ?? null }).replace(/\n+/g, ' ') : '';
}

const yamlStr = (s: string) => JSON.stringify(s);

/** 파일 이름에 못 쓰는 글자 빼기 (Windows 기준) */
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, 80) || '제목 없음';
}

/** 노트의 ZIP 안 폴더: 폴더 이름 사슬, 하위 노트면 상위 노트 이름 폴더 안 */
export function notePathParts(n: NoteMeta, notes: readonly NoteMeta[], folders: readonly Folder[]): string[] {
  const byNote = new Map(notes.map((x) => [x.id, x]));
  const byFolder = new Map(folders.map((f) => [f.id, f]));
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: NoteMeta | undefined = n;
  while (cur?.parentNoteId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = byNote.get(cur.parentNoteId);
    if (!parent) break;
    out.unshift(safeName(displayTitle(parent)));
    cur = parent;
  }
  let f = cur?.folderId ? byFolder.get(cur.folderId) : undefined;
  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    out.unshift(safeName(f.name));
    f = f.parentId ? byFolder.get(f.parentId) : undefined;
  }
  return out;
}

/** 손실 없는 백업 — 나중에 가져오기(FR-125 · 127)로 되살린다 */
export interface Backup {
  app: 'DamianNote';
  backupVersion: 1;
  exportedAt: string;
  notes: { meta: NoteMeta; snapshot: NoteSnapshot }[];
  folders: Folder[];
  tags: Tag[];
  templates: UserTemplate[];
  /** 첨부 (이미지): ZIP 백업은 path(ZIP 안 파일), 노트 하나 JSON 백업은 data(base64)에 내용을 담는다 */
  attachments?: { hash: string; mime: string; path: string; data?: string }[];
}

/** 브라우저 다운로드 */
export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 첨부 파일 확장자 (이미지 형식) */
export function extOf(mime: string): string {
  return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp' } as Record<string, string>)[mime] ?? 'bin';
}
