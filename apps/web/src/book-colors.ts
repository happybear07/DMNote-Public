// 서재 책 표지 색 (11/10): 무광 천 8색 — 밝기를 비슷하게 · 채도를 낮춰 어떤 차례로 꽂혀도 어울리게.
// 색은 폴더가 정한다(출판사 시리즈처럼 — 같은 폴더의 책이 같은 색으로 나란히). 폴더 밖 노트는 숯색.
// ink = 표지 글자(박은 제목 · 폴더 이름) — 표지 바탕과 4.5:1이 넘게 골랐다(가장 낮은 세이지 4.8 · 황토 4.8).
import type { Folder, NoteMeta } from '@dn/storage-idb';

/** light: 밝은 천(어두운 글자) — 박은 글자 그림자를 밝게 */
export interface BookColor { readonly key: string; readonly name: string; readonly bg: string; readonly ink: string; readonly light?: true }

export const BOOK_PALETTE: readonly BookColor[] = [
  { key: 'navy', name: '먹색', bg: '#2e3a4f', ink: '#e1e8f2' },
  { key: 'forest', name: '숲색', bg: '#33493d', ink: '#dfe8dc' },
  { key: 'sage', name: '세이지', bg: '#5e6f5a', ink: '#f3f5ee' },
  { key: 'plum', name: '자주', bg: '#57405a', ink: '#f1e5f0' },
  { key: 'oxblood', name: '적갈', bg: '#6b2e2e', ink: '#f5e3de' },
  { key: 'terracotta', name: '테라코타', bg: '#a0573c', ink: '#fff4ee' },
  { key: 'ochre', name: '황토', bg: '#b08a3e', ink: '#2c210d', light: true },
  { key: 'charcoal', name: '숯색', bg: '#3b3a38', ink: '#e8e5de' },
];

const BY_KEY = new Map(BOOK_PALETTE.map((c) => [c.key, c]));
const NO_FOLDER = BY_KEY.get('charcoal')!;
/** 폴더 색을 따로 안 골랐을 때 고르는 색 — 숯색(폴더 밖)과 헷갈리지 않게 뺀다 */
const AUTO = BOOK_PALETTE.filter((c) => c !== NO_FOLDER);

/** 폴더의 책 색: 고른 색, 아니면 폴더 id로 고른 색 (열 때마다 같은 색) */
export function folderColor(f: Pick<Folder, 'id' | 'color'>): BookColor {
  const set = f.color ? BY_KEY.get(f.color) : undefined;
  if (set) return set;
  let h = 0;
  for (const ch of f.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return AUTO[Math.abs(h) % AUTO.length]!;
}

/** 노트의 책 색 = 이 노트만 고른 색, 아니면 그 노트가 든 폴더의 색, 폴더 밖이면 숯색 */
export function bookColorOf(n: Pick<NoteMeta, 'folderId' | 'bookColor'>, folders: ReadonlyMap<string, Folder>): BookColor {
  const own = n.bookColor ? BY_KEY.get(n.bookColor) : undefined;
  if (own) return own;
  const f = n.folderId ? folders.get(n.folderId) : undefined;
  return f ? folderColor(f) : NO_FOLDER;
}
