// 노션 가져오기 (FR-124): 노션 "Markdown & CSV" 내보내기(ZIP · 폴더)를 노트로.
// 노션은 파일 이름 끝에 32자리 id를 붙인다 — "제목 <id>.md", 하위 페이지는 같은 이름 폴더 안, 데이터베이스는 "이름 <id>.csv"(+ _all.csv)와
// 항목 페이지 폴더 "이름 <id>/". 여기서:
// - 페이지 계층 → 중첩 노트(상위 페이지 폴더 안의 페이지 = 그 노트의 하위 노트), 페이지가 아닌 폴더 → 폴더
// - CSV → 데이터베이스 블록(열 값을 보고 속성 타입 추정), 항목 페이지 → 그 항목의 페이지 노트(dbRef)
// - 페이지 간 링크 → 노트 링크, 표 · 콜아웃 · 토글 → 대응 블록(import-md.ts), 옮기지 못한 것은 경고 목록 + 글자 그대로
import { csvToDatabase, newId, parseCsv } from '@dn/engine-core';
import { linkWikiLinks } from '@dn/text-pm/headless';
import type { ImportNote, ImportPlan } from './import';
import { parseMarkdownNote } from './import';
import { buildPage, convertMarkdown } from './import-md';
import { displayTitle } from './ws-model';
import type { NoteMeta } from '@dn/storage-idb';

const HEX = /\s([0-9a-f]{32})(?:_all)?$/i;
/** 노션 내보내기인가: 이름 끝에 32자리 id가 붙은 .md · .csv가 있다 */
export const isNotionExport = (paths: readonly string[]) => paths.some((p) => /\s[0-9a-f]{32}(?:_all)?\.(md|csv)$/i.test(p));

const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
const noExt = (p: string) => p.replace(/\.[^./]+$/, '');
const hexOf = (name: string) => HEX.exec(noExt(name))?.[1]?.toLowerCase();
const clean = (name: string) => noExt(name).replace(HEX, '').trim() || '제목 없음';
const dirKey = (parts: readonly string[]) => parts.join('/');

interface Page { path: string; dir: string[]; key: string; hex?: string; id: string; md: string; title: string }
interface Db { key: string; hex?: string; dir: string[]; name: string; header: string[]; rows: string[][]; holder?: Page; noteId: string; contentId: string }

export function planNotion(md: readonly { path: string; text: string }[], csv: readonly { path: string; text: string }[],
  imageFiles: ReadonlyMap<string, Blob>, ex: { notes: readonly NoteMeta[] }, source: string): ImportPlan {
  const now = Date.now();
  const warnings: string[] = [];
  const unconverted = new Map<string, number>();
  const pages: Page[] = md.map((f) => {
    const parts = f.path.split('/').filter(Boolean);
    const name = parts.pop()!;
    const p = parseMarkdownNote(f.text, name);
    return { path: f.path, dir: parts, key: dirKey([...parts, noExt(name)]), hex: hexOf(name), id: newId(), md: p.body, title: hexOf(p.title) ? clean(p.title) : p.title || clean(name) };
  });
  const byKey = new Map(pages.map((p) => [p.key, p]));
  const byHex = new Map(pages.filter((p) => p.hex).map((p) => [p.hex!, p]));
  // 데이터베이스: _all.csv가 있으면 그것(전체 항목)을
  const csvByKey = new Map<string, { path: string; text: string }>();
  for (const c of csv) {
    const k = noExt(c.path).replace(/_all$/, '');
    if (!csvByKey.has(k) || /_all\.csv$/i.test(c.path)) csvByKey.set(k, c);
  }
  const dbs: Db[] = [...csvByKey.entries()].map(([key, c]) => {
    const parts = key.split('/');
    const name = clean(parts.at(-1)!);
    const table = parseCsv(c.text);
    const dir = parts.slice(0, -1);
    // 데이터베이스를 품는 페이지: 이 CSV에 링크를 건 페이지, 없으면 같은 폴더의 상위 페이지
    const base = parts.at(-1)!;
    const holder = pages.find((p) => dec(p.md).includes(`${base}.csv`) || dec(p.md).includes(`${base}_all.csv`)) ?? byKey.get(dirKey(dir));
    return { key, hex: hexOf(base), dir, name, header: table[0] ?? ['이름'], rows: table.slice(1), ...(holder ? { holder } : {}), noteId: holder?.id ?? newId(), contentId: newId() };
  });
  const dbByKey = new Map(dbs.map((d) => [d.key, d]));
  const dbData = new Map(dbs.map((d) => [d, csvToDatabase(d.header, d.rows, d.name, d.contentId)]));

  // 링크 이름표: §hex → 노트
  const resolve = (name: string) => {
    if (!name.startsWith('§')) return null;
    const p = byHex.get(name.slice(1));
    return p ? { id: p.id, title: p.title } : null;
  };
  const existing = new Map(ex.notes.map((n) => [displayTitle(n).toLowerCase(), n.id]));
  let missingImages = 0;
  const usedImages = new Set<string>();
  const notes: ImportNote[] = [];

  const pageNote = (p: Page): ImportNote => {
    // 상위: 같은 경로의 페이지 → 하위 노트 / 데이터베이스 항목 폴더 → 그 데이터베이스가 있는 노트의 항목 페이지
    const parentPage = byKey.get(dirKey(p.dir));
    const rowDb = dbByKey.get(dirKey(p.dir));
    let body = p.md;
    let dbRef: NoteMeta['dbRef'] | undefined;
    if (rowDb) {
      const d = dbData.get(rowDb)!;
      const i = rowDb.rows.findIndex((r) => (r[0] ?? '').trim() === p.title);
      if (i >= 0) {
        const rows = d.data.rows as unknown as { id: string; page?: string }[]; // 막 만든 행 — 항목 페이지를 이어 붙인다
        rows[i]!.page = p.id;
        dbRef = { noteId: rowDb.noteId, contentId: rowDb.contentId, rowId: rows[i]!.id };
      }
      // 항목 페이지 맨 앞 "속성: 값" 줄은 데이터베이스에 있으므로 뺀다
      const names = new Set(rowDb.header.map((h) => h.trim()));
      const ls = body.split('\n');
      let k = 0;
      while (k < ls.length && (!ls[k]!.trim() || names.has(ls[k]!.split(':')[0]!.trim()))) k++;
      body = ls.slice(k).join('\n');
    }
    // 링크: 페이지 → [[§hex]], CSV(데이터베이스) 링크 줄은 블록으로 대신하므로 뺀다
    body = body.replace(/\[([^\]]*)\]\(([^)\s]+\.(md|csv))\)/gi, (all, text: string, href: string, ext: string) => {
      const hx = hexOf(dec(href).split('/').pop()!);
      if (ext.toLowerCase() === 'csv') return '';
      return hx && byHex.has(hx) ? `[[§${hx}]]` : text || all;
    });
    // 이미지
    const images: { name: string; alt: string }[] = [];
    body = body.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (all, alt: string, href: string) => {
      if (/^https?:/i.test(href)) return all;
      const name = dec(href).split('/').pop()!.toLowerCase();
      if (!imageFiles.has(name)) { missingImages++; return all; }
      usedImages.add(name);
      images.push({ name, alt: alt || name.replace(/\.[^.]+$/, '') });
      return '';
    });
    // 첨부 파일(pdf 등) 링크는 글자로 남긴다
    for (const m of body.matchAll(/\]\(([^)\s]+\.(pdf|docx?|xlsx?|pptx?|mp3|mp4|mov|zip))\)/gi)) unconverted.set(`첨부 파일 (.${m[2]!.toLowerCase()})`, (unconverted.get(`첨부 파일 (.${m[2]!.toLowerCase()})`) ?? 0) + 1);
    const conv = convertMarkdown(body.trim());
    for (const l of conv.leftovers) unconverted.set(l, (unconverted.get(l) ?? 0) + 1);
    const doc = linkWikiLinks(conv.doc, resolve).doc;
    const held = dbs.filter((d) => d.holder === p);
    const conflictId = existing.get(p.title.toLowerCase());
    return {
      id: p.id, title: p.title, dir: parentPage || rowDb ? [] : p.dir.map(clean), tags: [], createdAt: now,
      ...(parentPage ? { parentNoteId: parentPage.id } : rowDb ? { parentNoteId: rowDb.noteId } : {}),
      ...(conflictId ? { conflictId } : {}),
      ...(dbRef ? { extra: { dbRef } } : {}),
      build: (attached) => buildPage({
        id: p.id, title: p.title, created: now, updated: now, doc, tables: conv.tables,
        images: images.map((i) => ({ ...(attached?.get(i.name) ?? { hash: '', w: 1, h: 1 }), alt: i.alt })).filter((i) => i.hash),
        databases: held.map((d) => dbData.get(d)!.data),
      }),
    };
  };
  for (const p of pages) notes.push(pageNote(p));
  // 품는 페이지가 없는 데이터베이스는 이름으로 노트를 만든다
  for (const d of dbs) {
    if (d.holder) continue;
    notes.push({
      id: d.noteId, title: d.name, dir: d.dir.filter((x) => !byKey.has(x)).map(clean), tags: [], createdAt: now,
      build: () => buildPage({ id: d.noteId, title: d.name, created: now, updated: now, doc: { type: 'doc', content: [{ type: 'paragraph' }] }, tables: [], images: [], databases: [dbData.get(d)!.data] }),
    });
  }
  if (dbs.length) warnings.push(`데이터베이스 ${dbs.length}개를 데이터베이스 블록으로 가져와요 (속성 타입은 값을 보고 추정해요).`);
  if (usedImages.size) warnings.push(`이미지 ${usedImages.size}개를 이미지 블록으로 함께 가져와요.`);
  if (missingImages) warnings.push(`파일이 함께 없는 이미지 ${missingImages}개는 글자로 남아요.`);
  if (unconverted.size) warnings.push(`변환하지 못해 글자 그대로 둔 것: ${[...unconverted].map(([k, v]) => `${k} ${v}개`).join(', ')}`);
  return { kind: 'markdown', source: `노션 · ${source}`, notes, folders: [], templates: [], warnings, files: [...usedImages].map((name) => ({ name, blob: imageFiles.get(name)! })) };
}
