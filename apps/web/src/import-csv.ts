// CSV 가져오기 (GAP #13 — 노션 "CSV 가져오기"): 노션 내보내기가 아닌 .csv 파일 하나 = 데이터베이스 블록 하나인 노트.
// 첫 줄 = 속성 이름, 첫 열 = 항목 이름, 나머지 열은 값을 보고 타입 추정(engine-core db-csv.ts — DamianNote가 내보낸 CSV는 그대로 되돌아온다).
import { csvToDatabase, newId, parseCsv } from '@dn/engine-core';
import type { ImportNote } from './import';
import { buildPage } from './import-md';
import { displayTitle } from './ws-model';
import type { NoteMeta } from '@dn/storage-idb';

export function planCsv(csv: readonly { path: string; text: string }[], ex: { notes: readonly NoteMeta[] }): { notes: ImportNote[]; warnings: string[] } {
  const now = Date.now();
  const existing = new Map(ex.notes.map((n) => [displayTitle(n).toLowerCase(), n.id]));
  let rows = 0;
  const notes = csv.map((c): ImportNote => {
    const parts = c.path.split('/').filter(Boolean);
    const title = parts.pop()!.replace(/\.csv$/i, '').trim() || '제목 없는 데이터베이스';
    const table = parseCsv(c.text);
    const { data } = csvToDatabase(table[0] ?? ['이름'], table.slice(1), title);
    rows += data.rows.length;
    const id = newId(), conflictId = existing.get(title.toLowerCase());
    return {
      id, title, dir: parts, tags: [], createdAt: now, ...(conflictId ? { conflictId } : {}),
      build: () => buildPage({ id, title, created: now, updated: now, doc: { type: 'doc', content: [{ type: 'paragraph' }] }, tables: [], images: [], databases: [data] }),
    };
  });
  return { notes, warnings: [`CSV ${csv.length}개를 데이터베이스 블록으로 가져와요 — 항목 ${rows}개, 속성 타입은 값을 보고 추정해요.`] };
}
