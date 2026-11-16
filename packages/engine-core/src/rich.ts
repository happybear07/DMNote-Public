// 스키마 v4 콘텐츠 (FR-018 · DATABASE 4.2): 표 · 그래프. (이미지 · 수식은 같은 버전에 필드만 정해 두고 다음 단계에서 그린다)
// 표 셀은 텍스트 문서(B1 — 서식 · 링크 유지), 행 · 열에 id가 있어 동기화 때 칸 단위로 합칠 수 있다.
import { keyBetween, type OrderKey } from './order';
import { newId } from './id';
import type { Content, Id, TextDoc, TextNode } from './model';
import { textLines } from './text-doc';

export interface TableColumn { readonly id: Id; readonly name: string; readonly width?: number }
export interface TableRow { readonly id: Id; readonly order: OrderKey; readonly cells: Readonly<Record<Id, TextDoc>> }
/** 합친 칸 (table-merge.ts): 왼쪽 위 칸 ~ 오른쪽 아래 칸의 행 · 열 id */
export interface TableMerge { readonly r0: Id; readonly c0: Id; readonly r1: Id; readonly c1: Id }
export interface TableData {
  readonly title?: string; readonly columns: readonly TableColumn[]; readonly rows: readonly TableRow[]; readonly merges?: readonly TableMerge[];
  /** 마지막으로 열 머리에서 정렬한 열 · 방향 (table-sort.ts) — 차례가 아직 그대로일 때만 ↑ · ↓ 표시 */
  readonly sorted?: { readonly col: Id; readonly dir: 'asc' | 'desc' };
  /** 머리 행(열 이름 줄)을 숨김 · 첫 열을 머리 모양으로 (table-head.ts) */
  readonly noHeader?: boolean;
  readonly headerCol?: boolean;
}
export type TableContent = Content & TableData & { readonly type: 'table' };

export type ChartKind = 'bar' | 'line' | 'pie';
export interface ChartSeries {
  readonly id: Id; readonly name: string; readonly points: readonly { readonly x: string | number; readonly y: number }[];
  /** 계열 색 (#rrggbb) — 없으면 색 묶음의 차례 색 */
  readonly color?: string;
}
/** 그래프 색 묶음 — 실제 색은 engine-dom chart-render.ts CHART_PALETTES */
export type ChartPalette = 'basic' | 'warm' | 'cool' | 'pastel' | 'mono' | 'gray';
/** 그래프 모양 (그래프 창 › 모양). 빈 칸은 기본값 — 켜고 끄는 것은 모두 기본 켬, 색 묶음은 basic */
export interface ChartStyle {
  readonly palette?: ChartPalette;
  /** 항목(x 이름)마다 색 (#rrggbb) — 원 조각, '항목마다 다른 색' 막대 */
  readonly itemColors?: Readonly<Record<string, string>>;
  /** 계열이 하나인 막대를 항목마다 다른 색으로 (기본 끔) */
  readonly vary?: boolean;
  readonly values?: boolean;
  readonly legend?: boolean;
  readonly grid?: boolean;
  /** 꺾은선: 매끈한 곡선 · 아래 채우기 */
  readonly smooth?: boolean;
  readonly area?: boolean;
  /** 원: 가운데 구멍 (도넛) */
  readonly hole?: boolean;
}
export interface ChartData {
  readonly kind: ChartKind; readonly title?: string; readonly unit?: string; readonly series: readonly ChartSeries[];
  /** 항목(x) 순서 — 그래프 데이터 창이 적는다. 어떤 계열에 빈 칸이 있어도 순서가 흔들리지 않고, 값이 모두 빈 항목도 남는다 */
  readonly categories?: readonly string[];
  readonly style?: ChartStyle;
}

/** 그래프 항목 순서: 적어 둔 categories, 없으면 계열마다의 순서를 지키며 합친다(앞 계열에 없던 항목은 그 계열의 바로 앞 항목 뒤에) */
export function chartCategories(c: { readonly categories?: readonly string[]; readonly series: readonly { readonly points: readonly { readonly x: string | number }[] }[] }): string[] {
  const xs: string[] = c.categories?.length ? [...c.categories] : [];
  for (const s of c.series) {
    let at = -1;
    for (const p of s.points) {
      const x = String(p.x);
      let i = xs.indexOf(x);
      if (i < 0) { i = at + 1; xs.splice(i, 0, x); }
      at = i;
    }
  }
  return xs;
}
export type ChartContent = Content & ChartData & { readonly type: 'chart' };

export function isTableContent(c: Content | undefined): c is TableContent {
  return !!c && c.type === 'table' && Array.isArray((c as TableContent).columns) && Array.isArray((c as TableContent).rows)
    && (c as TableContent).columns.every((x) => typeof x === 'object' && x !== null && 'id' in x);
}

export function isChartContent(c: Content | undefined): c is ChartContent {
  return !!c && c.type === 'chart' && Array.isArray((c as ChartContent).series) && typeof (c as ChartContent).kind === 'string';
}

/** 한 줄 글자 → 셀 문서 (문단 하나) */
export function cellDoc(text: string): TextDoc {
  return { type: 'doc', content: [text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }] };
}

/** 셀 글자 (검색 · 내보내기 · 그래프 이름) */
export function cellText(doc: TextNode | undefined): string {
  return doc ? textLines(doc).join(' ').trim() : '';
}

/** 열 이름 · 행 글자 → v4 표 데이터 (AI 결과 · v0 변환 · 가져오기) */
export function makeTable(columns: readonly string[], rows: readonly (readonly string[])[], title?: string): TableData {
  const cols = columns.map((name) => ({ id: newId(), name }));
  let order: OrderKey | null = null;
  return {
    ...(title ? { title } : {}),
    columns: cols,
    rows: rows.map((r) => {
      order = keyBetween(order, null);
      return { id: newId(), order, cells: Object.fromEntries(cols.map((c, i) => [c.id, cellDoc(String(r[i] ?? ''))])) };
    }),
  };
}

/** 행 순서대로 */
export function sortedRows(t: TableData): TableRow[] {
  return [...t.rows].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
}

export function makeChart(kind: ChartKind, series: readonly { name: string; points: readonly { x: string | number; y: number }[] }[], title?: string, unit?: string): ChartData {
  return { kind, ...(title ? { title } : {}), ...(unit ? { unit } : {}), series: series.map((s) => ({ id: newId(), name: s.name, points: s.points.map((p) => ({ x: p.x, y: p.y })) })) };
}

// ───────── v3 → v4 변환 (임시 형식 table-v0 · chart-v0) ─────────

/** v0 표 · 그래프 콘텐츠면 v4 형식으로, 아니면 그대로 (id · blockId · order · frame · ai는 유지) */
export function upgradeV0Content(c: Record<string, unknown>): Record<string, unknown> {
  if (c.type === 'table' && c.schema === 'table-v0' && Array.isArray(c.columns)) {
    const { schema: _s, columns, rows, title, ...rest } = c;
    return { ...rest, ...makeTable(columns as string[], (rows as string[][]) ?? [], typeof title === 'string' ? title : undefined) };
  }
  if (c.type === 'chart' && c.schema === 'chart-v0' && Array.isArray(c.series)) {
    const { schema: _s, chartKind, series, title, unit, ...rest } = c;
    const kind = (['bar', 'line', 'pie'] as const).includes(chartKind as ChartKind) ? (chartKind as ChartKind) : 'bar';
    return { ...rest, ...makeChart(kind, series as ChartSeries[], typeof title === 'string' ? title : undefined, typeof unit === 'string' ? unit : undefined) };
  }
  return c;
}

// ───────── 이미지 (v4) ─────────

/** 이미지: 파일은 첨부 저장소에(내용 해시), 콘텐츠에는 해시 · 대체 글 · 원래 크기만 */
export interface ImageData { readonly attachment: string; readonly alt?: string; readonly natural: { readonly w: number; readonly h: number } }
export type ImageContent = Content & ImageData & { readonly type: 'image' };

export function isImageContent(c: Content | undefined): c is ImageContent {
  return !!c && c.type === 'image' && typeof (c as ImageContent).attachment === 'string';
}

/** 첨부 파일 (FR-052): 내용은 첨부 저장소에(해시), 콘텐츠에는 이름 · 형식 · 크기만 */
export interface FileData {
  readonly attachment: string; readonly name: string; readonly mime: string; readonly size: number;
  /** 소리 · 영상 길이(초) — 녹음 블록(FR-043)이 적어 둔다. 없으면 재생기가 읽는다 */
  readonly duration?: number;
  /** PDF를 노트 안에서 펼쳐 보기 (GAP #22, file-preview.ts) */
  readonly preview?: boolean;
}
export type FileContent = Content & FileData & { readonly type: 'file' };

export function isFileContent(c: Content | undefined): c is FileContent {
  return !!c && c.type === 'file' && typeof (c as FileContent).attachment === 'string' && typeof (c as FileContent).name === 'string';
}

/** 소리 · 영상이면 재생기로 그린다 (FR-043) */
export function mediaKind(mime: string): 'audio' | 'video' | null {
  return mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : null;
}

/** 재생 시간 1:05 · 1:02:03 */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** 사람이 읽는 크기 (1.2 MB) */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
