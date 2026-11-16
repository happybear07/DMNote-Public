// 가져오기 계획 (FR-125 · FR-127): 파일을 읽어 "무엇을 만들지"만 정한다. 실제로 쓰는 일은 ws-import.ts.
// - 백업(.json · 내보내기 ZIP 안의 _백업/damiannote-backup.json): 손실 없이 되살린다 (상자 위치 · 화살표 · 필기 · 폴더 · 태그)
// - Markdown(.md 여러 개 · 폴더 · ZIP): 노트 하나 = 내용 상자 하나, 폴더 구조 · 앞머리 태그 · #태그 · [[링크]]를 옮긴다
// - 노션 내보내기(이름 끝 32자리 id): import-notion.ts — 페이지 계층 · CSV 데이터베이스 · 항목 페이지 · 링크
// - 워드(.docx): docx/docx-import.ts — 파일 하나 = 노트 하나, 글 · 표 · 그림을 워드 차례대로
// - CSV(노션 내보내기가 아닌 것): import-csv.ts — 파일 하나 = 데이터베이스 블록 하나인 노트
import { deserialize, Engine, newId, type TextDoc } from '@dn/engine-core';
import type { Folder, NoteMeta, Tag } from '@dn/storage-idb';
import { fromB64 } from '@dn/sync';
import { linkWikiLinks } from '@dn/text-pm/headless';
import type { Backup } from './export';
import type { UserTemplate } from './templates';
import { unzip } from './unzip';
import { buildPage, convertMarkdown } from './import-md';
import { isNotionExport, planNotion } from './import-notion';
import { planDocx } from './docx/docx-import';
import { planCsv } from './import-csv';
import { displayTitle } from './ws-model';

/** 백업 첨부 형식 허용 목록 — 그 밖(HTML · SVG · 스크립트)은 내용만 남기고 내려받기 형식으로 (보안 2-9) */
export function safeMime(mime: unknown): string {
  return typeof mime === 'string' && /^(image\/(png|jpeg|gif|webp|avif|bmp)|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+|text\/plain)$/.test(mime) ? mime : 'application/octet-stream';
}

export interface ImportNote {
  /** 만들 노트 id — 백업은 원래 id(충돌 없을 때), Markdown은 새 id */
  id: string;
  title: string;
  /** Markdown: 폴더 경로(이름들) */
  dir: string[];
  /** 백업: 원래 폴더 · 상위 노트 */
  folderId?: string;
  parentNoteId?: string;
  tags: string[];
  createdAt: number;
  /** 같은 노트(백업: 같은 id · Markdown: 같은 제목)가 이미 있다 */
  conflictId?: string;
  /** 노트 메타에 함께 넣을 값 (노션: 데이터베이스 항목 페이지 dbRef) */
  extra?: Partial<NoteMeta>;
  /** `attached`: 이미지 파일 이름 → 저장한 첨부 (Markdown만 쓴다) */
  build(attached?: ReadonlyMap<string, AttachedImage>): Engine;
}

export interface AttachedImage { hash: string; w: number; h: number }

export interface ImportPlan {
  kind: 'backup' | 'markdown';
  source: string;
  /** 가져오기 창 제목 (없으면 종류로) */
  heading?: string;
  notes: ImportNote[];
  /** 백업의 폴더 (원래 id) */
  folders: Folder[];
  templates: UserTemplate[];
  warnings: string[];
  /** 함께 가져올 파일 — 백업: 원래 해시로 되살리는 첨부, Markdown: 이름(소문자)으로 찾는 이미지 */
  files: { name: string; hash?: string; blob: Blob }[];
}

interface Existing {
  notes: readonly NoteMeta[]; trash: readonly NoteMeta[];
  /** 글 상자 높이 재기 (캔버스) — 워드 가져오기가 상자를 겹치지 않게 쌓는다 */
  measure?: (doc: TextDoc, w: number) => number | null;
}

const isMd = (p: string) => /\.(md|markdown|txt)$/i.test(p);
const hidden = (p: string) => p.split('/').some((s) => s.startsWith('.') || s === '__MACOSX');

/** 고른 파일들 → 계획. 백업이 들어 있으면 백업을 우선한다 (Markdown은 손실이 있는 사본). */
export async function planImport(files: readonly File[], ex: Existing): Promise<ImportPlan> {
  const md: { path: string; text: string }[] = [];
  const csv: { path: string; text: string }[] = [];
  const imageFiles = new Map<string, Blob>();
  const docx: File[] = [];
  const dec = new TextDecoder('utf-8');
  for (const f of files) {
    if (/\.docx$/i.test(f.name)) { docx.push(f); continue; } // 워드 — ZIP이지만 따로
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
    const path = rel || f.name;
    if (hidden(path)) continue; // .obsidian 설정 · 숨김 파일
    // 백업 JSON은 파일로 직접 고른 것만 — 폴더 안의 다른 .json(플러그인 설정 등)은 무시
    if (/\.json$/i.test(f.name)) { if (!rel) return planBackup(JSON.parse(await f.text()) as Backup, f.name, ex); continue; }
    if (/\.zip$/i.test(f.name)) {
      const entries = await unzip(new Uint8Array(await f.arrayBuffer()));
      const b = entries.find((e) => /damiannote-backup\.json$/i.test(e.path));
      if (b) return planBackup(JSON.parse(dec.decode(b.data)) as Backup, f.name, ex, entries);
      for (const e of entries) {
        if (hidden(e.path)) continue;
        if (isMd(e.path)) md.push({ path: e.path, text: dec.decode(e.data) });
        else if (/\.csv$/i.test(e.path)) csv.push({ path: e.path, text: dec.decode(e.data) });
        else if (IMAGE.test(e.path)) imageFiles.set(baseName(e.path), new Blob([e.data as BlobPart], { type: mimeOf(e.path) }));
      }
      continue;
    }
    if (isMd(path)) md.push({ path: stripRoot(path, files), text: await f.text() });
    else if (/\.csv$/i.test(path)) csv.push({ path: stripRoot(path, files), text: await f.text() });
    else if (IMAGE.test(path)) imageFiles.set(baseName(path), f);
  }
  const label = files.map((f) => f.name).slice(0, 3).join(', ') + (files.length > 3 ? ` 외 ${files.length - 3}개` : '');
  if (!md.length && !docx.length && !csv.length) throw new Error('가져올 수 있는 파일이 없어요. DamianNote 백업(.zip · .json), Markdown(.md), 워드(.docx), CSV(.csv), 노션 내보내기(Markdown & CSV ZIP)를 골라 주세요.');
  const notion = isNotionExport([...md, ...csv].map((x) => x.path));
  let base: ImportPlan = notion ? await planNotion(md, csv, imageFiles, ex, label) : md.length ? planMarkdown(md, label, imageFiles, ex)
    : { kind: 'markdown', source: label, heading: docx.length ? '워드 가져오기' : 'CSV 가져오기', notes: [], folders: [], templates: [], warnings: [], files: [] };
  // 노션 내보내기가 아닌 CSV — 파일마다 데이터베이스 노트
  if (!notion && csv.length) { const c = planCsv(csv, ex); base = { ...base, notes: [...base.notes, ...c.notes], warnings: [...base.warnings, ...c.warnings] }; }
  if (!docx.length) return base;
  const d = await planDocx(docx, ex);
  if (!d.notes.length && !base.notes.length) throw new Error('워드 파일을 읽지 못했어요. 암호가 걸렸거나 .doc 같은 옛 형식이면 워드에서 .docx로 저장해 다시 골라 주세요.');
  return { ...base, notes: [...base.notes, ...d.notes], files: [...base.files, ...d.files], warnings: [...base.warnings, ...d.warnings] };
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
function baseName(p: string): string {
  try { p = decodeURI(p); } catch { /* 그대로 */ }
  return p.split(/[\\/]/).pop()!.toLowerCase();
}
function mimeOf(p: string): string {
  const ext = p.split('.').pop()!.toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

/** 본문의 이미지 넣기: 옵시디언 ![[a.png|크기]] · Markdown ![대체 글](경로 "제목") */
const EMBED = /!\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]|!\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;

/** 폴더를 골랐을 때 맨 위 폴더(볼트 이름)는 빼고 그 안의 구조만 */
function stripRoot(path: string, files: readonly File[]): string {
  const rel = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel && path.includes('/') ? path.slice(path.indexOf('/') + 1) : path;
}

// ───────── 백업 ─────────

function planBackup(b: Backup, source: string, ex: Existing, zip: { path: string; data: Uint8Array }[] = []): ImportPlan {
  if (b?.app !== 'DamianNote' || b.backupVersion !== 1 || !Array.isArray(b.notes)) throw new Error('DamianNote 백업 파일이 아니거나, 이 버전이 읽을 수 없는 형식이에요.');
  const have = new Set([...ex.notes, ...ex.trash].map((n) => n.id));
  const warnings: string[] = [];
  const tagName = new Map((b.tags ?? []).map((t: Tag) => [t.id, t.name]));
  const notes: ImportNote[] = [];
  let trash = 0, broken = 0;
  for (const { meta, snapshot } of b.notes) {
    if (meta.deletedAt) { trash++; continue; }
    const r = deserialize(snapshot);
    if (!r.ok) { broken++; continue; }
    notes.push({
      id: meta.id, title: displayTitle(meta), dir: [], folderId: meta.folderId, parentNoteId: meta.parentNoteId,
      tags: (meta.tagIds ?? []).map((id) => tagName.get(id)).filter((x): x is string => !!x),
      createdAt: meta.createdAt,
      ...(have.has(meta.id) ? { conflictId: meta.id } : {}),
      build: () => new Engine(r.data),
    });
  }
  if (trash) warnings.push(`백업의 휴지통 노트 ${trash}개는 가져오지 않아요.`);
  if (broken) warnings.push(`노트 ${broken}개는 읽지 못해 건너뛰어요 (이 앱보다 새 버전에서 만든 노트일 수 있어요).`);
  // 이미지 첨부: ZIP 안 attachments/ 파일을 원래 해시로 되살린다 (JSON만 고르면 이미지는 없다)
  const byPath = new Map(zip.map((e) => [e.path, e.data]));
  const files: ImportPlan['files'] = [];
  for (const a of b.attachments ?? []) {
    const data = a.data ? fromB64(a.data) : byPath.get(a.path);
    if (data) files.push({ name: a.path || a.hash, hash: a.hash, blob: new Blob([data as BlobPart], { type: safeMime(a.mime) }) });
  }
  const missing = (b.attachments ?? []).length - files.length;
  if (missing > 0) warnings.push(`이미지 ${missing}개는 파일이 없어 빈 자리로 보여요 (백업 ZIP 전체를 고르면 함께 되살아나요).`);
  return { kind: 'backup', source, notes, folders: b.folders ?? [], templates: b.templates ?? [], warnings, files };
}

// ───────── Markdown ─────────

interface ParsedMd { title: string; tags: string[]; body: string; created?: number; updated?: number }

/** 앞머리(YAML 일부) · 첫 # 제목 · 본문 #태그 */
export function parseMarkdownNote(text: string, fileName: string): ParsedMd {
  let body = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const fm: Record<string, string> = {};
  const tags = new Set<string>();
  const m = /^---\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(body);
  if (m) {
    body = body.slice(m[0].length);
    let listKey = '';
    for (const line of m[1]!.split('\n')) {
      const item = /^\s*-\s+(.+)$/.exec(line);
      if (item && listKey === 'tags') { tags.add(unquote(item[1]!)); continue; }
      const kv = /^([\w-]+):\s*(.*)$/.exec(line);
      if (!kv) continue;
      listKey = kv[1]!.toLowerCase();
      fm[listKey] = kv[2]!;
      if (listKey === 'tags' || listKey === 'tag') {
        kv[2]!.replace(/^\[|\]$/g, '').split(',').map((t) => unquote(t)).filter(Boolean).forEach((t) => tags.add(t));
      }
    }
  }
  let title = unquote(fm.title ?? '');
  const h1 = /^\s*#\s+(.+?)[ \t]*#*[ \t]*(?:\n|$)/.exec(body);
  if (h1 && body.slice(0, h1.index).trim() === '') {
    if (!title || title === h1[1]) body = body.slice(h1.index + h1[0].length);
    title ||= h1[1]!;
  }
  title ||= fileName.replace(/\.[^.]+$/, '');
  // 본문 #태그 (제목 줄 · 코드 블록 · 링크 주소 안은 빼고)
  let inCode = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; continue; }
    if (inCode || /^\s{0,3}#{1,6}\s/.test(line)) continue;
    for (const t of line.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu)) tags.add(t[1]!);
  }
  const date = (s?: string) => { const t = s ? Date.parse(unquote(s)) : NaN; return Number.isFinite(t) ? t : undefined; };
  return { title: title.trim(), tags: [...tags].map((t) => t.replace(/^#/, '')).filter(Boolean), body: body.trim(), created: date(fm.created), updated: date(fm.updated) };
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '').trim();

function planMarkdown(files: { path: string; text: string }[], source: string, imageFiles: ReadonlyMap<string, Blob>, ex: Existing): ImportPlan {
  const now = Date.now();
  const byTitle = new Map(ex.notes.map((n) => [displayTitle(n).toLowerCase(), n.id]));
  const parsed = files.map((f) => {
    const parts = f.path.split('/').filter(Boolean);
    const name = parts.pop()!;
    return { dir: parts, name, p: parseMarkdownNote(f.text, name), id: newId() };
  });
  // [[링크]] 대상: 가져오는 노트(제목 · 파일 이름) 먼저, 없으면 이미 있는 노트
  const local = new Map<string, { id: string; title: string }>();
  for (const x of parsed) {
    local.set(x.p.title.toLowerCase(), { id: x.id, title: x.p.title });
    local.set(x.name.replace(/\.[^.]+$/, '').toLowerCase(), { id: x.id, title: x.p.title });
  }
  const existingTitle = new Map(ex.notes.map((n) => [displayTitle(n).toLowerCase(), { id: n.id, title: displayTitle(n) }]));
  const resolve = (name: string) => local.get(name.toLowerCase()) ?? existingTitle.get(name.toLowerCase()) ?? null;
  const warnings: string[] = [];
  let missingImages = 0;
  const used = new Set<string>();
  const notes = parsed.map((x): ImportNote => {
    const conflictId = byTitle.get(x.p.title.toLowerCase());
    // 본문이 가리키는 이미지 — 함께 고른 파일이 있으면 이미지 블록으로, 없으면 글자 그대로 (경고)
    const images: { name: string; alt: string }[] = [];
    for (const m of x.p.body.matchAll(EMBED)) {
      const name = baseName(m[1] ?? m[3] ?? '');
      if (!IMAGE.test(name) || /^https?:/i.test(m[3] ?? '')) continue;
      if (imageFiles.has(name)) { if (!images.some((i) => i.name === name)) images.push({ name, alt: (m[2] ?? name.replace(/\.[^.]+$/, '')).trim() }); used.add(name); }
      else missingImages++;
    }
    return {
      id: x.id, title: x.p.title, dir: x.dir, tags: x.p.tags,
      createdAt: x.p.created ?? now,
      ...(conflictId ? { conflictId } : {}),
      build: (attached) => {
        // 이미지 블록으로 옮긴 것은 글에서 뺀다
        const body = attached?.size ? x.p.body.replace(EMBED, (all, a?: string, _alt?: string, b?: string) => (attached.has(baseName(a ?? b ?? '')) ? '' : all)) : x.p.body;
        // 표는 표 블록으로 떼고, 이미지 · 표는 글 상자 오른쪽에 위에서부터
        const conv = convertMarkdown(body.trim());
        const linked = linkWikiLinks(conv.doc, resolve);
        return buildPage({
          id: x.id, title: x.p.title, created: x.p.created ?? now, updated: x.p.updated ?? now, doc: linked.doc, tables: conv.tables, databases: [],
          images: images.map((img) => ({ ...(attached?.get(img.name) ?? { hash: '', w: 1, h: 1 }), alt: img.alt })).filter((img) => img.hash),
        });
      },
    };
  });
  if (missingImages) warnings.push(`본문이 가리키는 이미지 ${missingImages}개는 파일이 함께 없어 글자로 남아요 (볼트 폴더나 ZIP 전체를 고르면 이미지 블록으로 들어가요).`);
  if (used.size) warnings.push(`이미지 ${used.size}개를 이미지 블록으로 함께 가져와요.`);
  const nTables = files.reduce((n, f) => n + (f.text.match(/^\s*\|?\s*:?-{2,}:?\s*\|/gm)?.length ?? 0), 0);
  if (nTables) warnings.push(`Markdown 표 ${nTables}개는 표 블록으로 들어가요.`);
  const files2: ImportPlan['files'] = [...used].map((name) => ({ name, blob: imageFiles.get(name)! }));
  return { kind: 'markdown', source, notes, folders: [], templates: [], warnings, files: files2 };
}
