// 워드 문서(.docx) 가져오기 (워드 빈칸 1 · 노션 "Word 가져오기"): 파일 하나 = 노트 하나.
// 조각(글 · 표 · 그림, docx-read.ts)을 위에서 아래로 쌓아 문서 뷰 차례가 워드 차례와 같게 — 맞춤 · 새 쪽 · 캡션도 상자에.
// 글 상자 높이는 캔버스가 재어 준 값(없으면 어림)으로 — 아래 상자와 겹치지 않게.
import { Engine, keyBetween, newId, type OrderKey, type TableData, type TextDoc, type TextNode } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm/headless';
import type { NoteMeta } from '@dn/storage-idb';
import type { AttachedImage, ImportNote, ImportPlan } from '../import';
import { unzip } from '../unzip';
import { displayTitle } from '../ws-model';
import { DocxReader, type DocxTable, type Piece } from './docx-read';

const W = 640, GAP = 16, CAPTION_H = 34; // 캡션 한 줄 (상자 안에 그려져 높이를 늘린다)
type Measure = (doc: TextDoc, w: number) => number | null;
interface Existing { notes: readonly NoteMeta[]; measure?: Measure }

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
const parse = (bytes: Uint8Array | undefined) => (bytes ? new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml') : null);
const textOf = (n: TextNode): string => (n.text ?? '') + (n.content ?? []).map(textOf).join(' ');

/** 상대 경로(word/ 기준 '../media/a.png' 등) → ZIP 안 경로 */
function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const s of target.split('/')) { if (s === '..') parts.pop(); else if (s && s !== '.') parts.push(s); }
  return parts.join('/');
}

/** 글 높이 어림 (캔버스가 없을 때): 줄 수 × 줄 높이 */
function estimate(nodes: readonly TextNode[], w: number): number {
  let h = 16;
  for (const n of nodes) {
    const len = textOf(n).length, per = Math.max(10, Math.floor(w / 13));
    const lines = Math.max(1, Math.ceil(len / per)) + (n.content?.filter((c) => /list|item/.test(c.type)).length ?? 0);
    h += n.type === 'heading' ? 40 : lines * 23 + 10;
  }
  return h;
}

function tableData(t: DocxTable): TableData {
  const columns = t.columns.map((c) => ({ id: newId(), name: c.name, ...(c.width ? { width: Math.max(48, c.width) } : {}) }));
  let prev: OrderKey | null = null;
  const rows = t.rows.map((cells) => {
    const order = keyBetween(prev, null);
    prev = order;
    return { id: newId(), order, cells: Object.fromEntries(columns.map((c, k) => [c.id, (cells[k] ?? { type: 'doc', content: [{ type: 'paragraph' }] }) as TextDoc])) };
  });
  const merges = t.merges.filter((m) => rows[m.r1] && columns[m.c1]).map((m) => ({ r0: rows[m.r0]!.id, c0: columns[m.c0]!.id, r1: rows[m.r1]!.id, c1: columns[m.c1]!.id }));
  return { columns, rows, ...(merges.length ? { merges } : {}), ...(t.noHeader ? { noHeader: true } : {}) };
}

/** 스키마에 안 맞는 문서(드문 짜임)는 글만 문단으로 */
function safeDoc(nodes: TextNode[]): TextDoc {
  const doc = { type: 'doc', content: nodes } as TextDoc;
  if (pmCodec.validate(doc) === null) return doc;
  return { type: 'doc', content: nodes.map((n) => textOf(n).trim()).filter(Boolean).map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) } as TextDoc;
}

function build(meta: { id: string; title: string; created: number; headingNumbers?: boolean }, pieces: readonly Piece[], imageName: (p: string) => string, attached: ReadonlyMap<string, AttachedImage> | undefined, measure?: Measure): Engine {
  const e = new Engine({ note: { id: meta.id, title: meta.title, createdAt: meta.created, updatedAt: meta.created, ...(meta.headingNumbers ? { headingNumbers: true } : {}) } });
  e.transact((tx) => {
    let y = 0;
    for (const pc of pieces) {
      const brk = pc.pageBreak ? { pageBreak: true } : {};
      if (pc.kind === 'text') {
        const doc = safeDoc(pc.nodes);
        const h = Math.max(36, measure?.(doc, W) ?? estimate(doc.content as TextNode[], W));
        const b = tx.createBlock({ x: 0, y, w: W, h, ...(pc.align ? { align: pc.align } : {}), ...brk });
        tx.createContent({ blockId: b, type: 'text', role: 'body', doc });
        y += h + GAP;
      } else if (pc.kind === 'table') {
        const t = tableData(pc.table);
        const w = Math.max(240, Math.min(900, t.columns.reduce((s, c) => s + (c.width ?? 140), 0)));
        const colW = w / Math.max(1, t.columns.length);
        const h = (pc.caption ? CAPTION_H : 0) + (t.noHeader ? 8 : 40) + t.rows.reduce((s, r) => s + 12 + 21 * Math.max(1, ...Object.values(r.cells).map((d) => Math.ceil(textOf(d as TextNode).length / Math.max(4, colW / 13)))), 0);
        const b = tx.createBlock({ x: 0, y, w, h, ...(pc.caption ? { caption: pc.caption } : {}), ...brk });
        tx.createContent({ blockId: b, type: 'table', ...t } as never);
        y += h + GAP;
      } else {
        const a = attached?.get(imageName(pc.path));
        if (!a?.hash) continue;
        const nw = pc.w || a.w, nh = pc.h || a.h;
        const w = Math.max(40, Math.min(W, nw)), h = Math.round((w * nh) / Math.max(1, nw)) + (pc.caption ? CAPTION_H : 0);
        const b = tx.createBlock({ x: 0, y, w, h, ...(pc.caption ? { caption: pc.caption } : {}), ...brk });
        tx.createContent({ blockId: b, type: 'image', attachment: a.hash, ...(pc.alt ? { alt: pc.alt } : {}), natural: { w: a.w, h: a.h } } as never);
        y += h + GAP;
      }
    }
  }, { origin: 'user' });
  return e;
}

/** 고른 .docx들 → 노트 계획 (Markdown · 노션 계획에 더해진다) */
export async function planDocx(files: readonly File[], ex: Existing): Promise<Pick<ImportPlan, 'notes' | 'files' | 'warnings'>> {
  const byTitle = new Map(ex.notes.map((n) => [displayTitle(n).toLowerCase(), n.id]));
  const notes: ImportNote[] = [], out: ImportPlan['files'] = [], warnings: string[] = [];
  let tables = 0, images = 0, footnotes = 0, skipped = 0, broken = 0;
  for (const [k, f] of files.entries()) {
    try {
      const entries = await unzip(new Uint8Array(await f.arrayBuffer()));
      const get = (p: string) => entries.find((x) => x.path === p)?.data;
      const main = /Target="\/?([^"]+)"[^>]*officeDocument"|officeDocument"[^>]*Target="\/?([^"]+)"/.exec(new TextDecoder().decode(get('_rels/.rels') ?? new Uint8Array()));
      const docPath = main?.[1] ?? main?.[2] ?? 'word/document.xml';
      const doc = parse(get(docPath));
      if (!doc || doc.querySelector('parsererror')) throw new Error('document.xml');
      const relsPath = docPath.replace(/([^/]+)$/, '_rels/$1.rels');
      const relEls = [...(parse(get(relsPath))?.documentElement.children ?? [])];
      const rels = new Map<string, string>(relEls.flatMap((r) => { const id = r.getAttribute('Id'), t = r.getAttribute('Target'); return id && t ? [[id, r.getAttribute('TargetMode') === 'External' ? t : resolve(docPath, t)] as const] : []; }));
      const part = (type: string) => { const r = relEls.find((x) => x.getAttribute('Type')?.endsWith(`/${type}`)); return r ? parse(get(resolve(docPath, r.getAttribute('Target')!))) : null; };
      const reader = new DocxReader({ doc, styles: part('styles'), numbering: part('numbering'), footnotes: part('footnotes'), rels });
      const pieces = reader.read();
      const core = parse(get('docProps/core.xml'));
      const title = (core?.getElementsByTagNameNS('*', 'title')[0]?.textContent ?? '').trim() || reader.title || f.name.replace(/\.docx$/i, '');
      const created = Date.parse(core?.getElementsByTagNameNS('*', 'created')[0]?.textContent ?? '') || Date.now();
      const imageName = (p: string) => `docx${k}/${p}`.toLowerCase();
      for (const pc of pieces) {
        if (pc.kind !== 'image') continue;
        const ext = pc.path.split('.').pop()!.toLowerCase(), data = get(pc.path);
        if (!data || !MIME[ext]) { skipped++; continue; } // EMF · WMF 같은 형식은 그릴 수 없다
        if (!out.some((x) => x.name === imageName(pc.path))) out.push({ name: imageName(pc.path), blob: new Blob([data as BlobPart], { type: MIME[ext] }) });
      }
      tables += reader.stats.tables; images += reader.stats.images; footnotes += reader.stats.footnotes; skipped += reader.stats.skipped;
      const id = newId(), conflictId = byTitle.get(title.toLowerCase());
      notes.push({ id, title, dir: [], tags: [], createdAt: created, ...(conflictId ? { conflictId } : {}), build: (attached) => build({ id, title, created, headingNumbers: reader.headingNumbers }, pieces, imageName, attached, ex.measure) });
    } catch (err) {
      console.warn('[dn] 워드 파일을 읽지 못했어요', f.name, err);
      broken++;
    }
  }
  if (notes.length) warnings.push(`워드 문서 ${notes.length}개 — 제목 · 목록 · 글자 꾸밈 · 링크${tables ? ` · 표 ${tables}개` : ''}${images ? ` · 그림 ${images - skipped > 0 ? images - skipped : 0}개` : ''}${footnotes ? ` · 각주 ${footnotes}개` : ''}를 옮겨요. 글 상자 · 표 · 그림은 워드 차례대로 위에서 아래로 쌓여요.`);
  if (skipped) warnings.push(`그릴 수 없는 그림(EMF · WMF · 도형 등) ${skipped}개는 빼요.`);
  if (broken) warnings.push(`워드 파일 ${broken}개는 읽지 못했어요 (암호가 걸렸거나 .doc 같은 옛 형식일 수 있어요).`);
  return { notes, files: out, warnings };
}
