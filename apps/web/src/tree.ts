// 사이드바 트리 (FR-073): 폴더 · 노트. 순수 함수만 — 화면은 Sidebar.tsx.
// 노트 안에 노트(하위 문서)는 두지 않는다 — 노트 아래에는 그 노트의 블록이 보인다. 예전 하위 노트(parentNoteId)는 상위 노트가 든 폴더에,
// 데이터베이스 항목 페이지(dbRef)는 목록에서 빼고 데이터베이스의 '열기'로 연다. 가리키는 폴더가 없으면 루트에.
import type { Folder, NoteMeta } from '@dn/storage-idb';

export type TreeNode =
  | { kind: 'folder'; folder: Folder; children: TreeNode[] }
  | { kind: 'note'; note: NoteMeta; children: TreeNode[] };

/** `notes`는 이미 정렬된 살아 있는 노트 목록. 폴더는 이름순, 같은 단계에서 폴더가 노트보다 먼저. */
export function buildTree(notes: readonly NoteMeta[], folders: readonly Folder[]): TreeNode[] {
  const folderIds = new Set(folders.map((f) => f.id));
  const kids = new Map<string, TreeNode[]>();
  const push = (key: string, n: TreeNode) => { let a = kids.get(key); if (!a) kids.set(key, (a = [])); a.push(n); };
  const fnodes = new Map<string, TreeNode>();
  const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  for (const f of sortedFolders) fnodes.set(f.id, { kind: 'folder', folder: f, children: [] });
  // 폴더 순환(동기화 병합 등)은 루트로 끊는다
  const folderParent = (f: Folder): string => (f.parentId && folderIds.has(f.parentId) && !folderCycle(folders, f.id) ? `f:${f.parentId}` : 'root');
  for (const f of sortedFolders) push(folderParent(f), fnodes.get(f.id)!);
  const byId = new Map(notes.map((n) => [n.id, n]));
  /** 폴더: 자기 폴더 → 없으면 상위 노트를 따라 올라가 처음 만나는 폴더 */
  const folderOf = (n: NoteMeta): string | undefined => {
    const seen = new Set<string>();
    for (let cur: NoteMeta | undefined = n; cur && !seen.has(cur.id); cur = cur.parentNoteId ? byId.get(cur.parentNoteId) : undefined) {
      seen.add(cur.id);
      if (cur.folderId && folderIds.has(cur.folderId)) return cur.folderId;
    }
    return undefined;
  };
  for (const n of notes) {
    if (n.dbRef) continue;
    const f = folderOf(n);
    push(f ? `f:${f}` : 'root', { kind: 'note', note: n, children: [] });
  }
  for (const [id, node] of fnodes) node.children = kids.get(`f:${id}`) ?? [];
  return kids.get('root') ?? [];
}

function folderCycle(folders: readonly Folder[], id: string): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set<string>();
  for (let cur = byId.get(id); cur?.parentId; cur = byId.get(cur.parentId)) {
    if (cur.parentId === id || seen.has(cur.parentId)) return true;
    seen.add(cur.parentId);
  }
  return false;
}

/** `target`이 `id` 자신이거나 그 아래(하위 노트)에 있는가 — 노트를 자기 아래로 옮기는 것을 막는다 */
export function isNoteWithin(notes: readonly NoteMeta[], target: string, id: string): boolean {
  const byId = new Map(notes.map((n) => [n.id, n.parentNoteId]));
  return within((x) => byId.get(x), target, id);
}

/** `target` 폴더가 `id` 폴더 자신이거나 그 아래에 있는가 */
export function isFolderWithin(folders: readonly Folder[], target: string, id: string): boolean {
  const byId = new Map(folders.map((f) => [f.id, f.parentId]));
  return within((x) => byId.get(x), target, id);
}

function within(parentOf: (id: string) => string | undefined, target: string, id: string): boolean {
  const seen = new Set<string>();
  for (let cur: string | undefined = target; cur && !seen.has(cur); cur = parentOf(cur)) {
    if (cur === id) return true;
    seen.add(cur);
  }
  return false;
}

/** 폴더와 그 아래 모든 폴더 id */
export function folderSubtree(folders: readonly Folder[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}

/** 폴더 아래(하위 폴더 포함)에 든 노트와 그 하위 노트 전부 */
export function notesInFolders(notes: readonly NoteMeta[], folderIds: ReadonlySet<string>): string[] {
  const out = new Set(notes.filter((n) => !n.parentNoteId && n.folderId && folderIds.has(n.folderId)).map((n) => n.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of notes) if (n.parentNoteId && out.has(n.parentNoteId) && !out.has(n.id)) { out.add(n.id); grew = true; }
  }
  return [...out];
}

/** 폴더 f와 그 위 폴더 이름들 (바깥부터) — 서재 서가 이름 · 이어서 쓰기 경로. 순환에 대비해 16단까지 */
export function folderNames(f: Folder | undefined, byId: ReadonlyMap<string, Folder>): string[] {
  const names: string[] = [];
  for (let x = f, i = 0; x && i < 16; x = x.parentId ? byId.get(x.parentId) : undefined, i++) names.unshift(x.name);
  return names;
}

/** 노트가 있는 자리 — 폴더 경로 (휴지통 "원래 위치" · 검색 결과) */
export function notePath(n: NoteMeta, notes: readonly NoteMeta[], folders: readonly Folder[], title: (n: NoteMeta) => string): string {
  return pathCrumbs(n, notes, folders, title).map((c) => c.name).join(' / ');
}

export interface Crumb { kind: 'folder' | 'note'; id: string; name: string }
/** 노트 위 경로 (바깥부터): 든 폴더들 → 상위 노트들. 노트 자신은 빼고 */
export function pathCrumbs(n: NoteMeta, notes: readonly NoteMeta[], folders: readonly Folder[], title: (n: NoteMeta) => string): Crumb[] {
  const parts: Crumb[] = [];
  const nb = new Map(notes.map((x) => [x.id, x]));
  const fb = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set<string>();
  let cur: NoteMeta | undefined = n;
  while (cur?.parentNoteId && nb.has(cur.parentNoteId) && !seen.has(cur.parentNoteId)) {
    seen.add(cur.parentNoteId);
    cur = nb.get(cur.parentNoteId)!;
    parts.unshift({ kind: 'note', id: cur.id, name: title(cur) });
  }
  for (let f = cur?.folderId ? fb.get(cur.folderId) : undefined; f && !seen.has(f.id); f = f.parentId ? fb.get(f.parentId) : undefined) {
    seen.add(f.id);
    parts.unshift({ kind: 'folder', id: f.id, name: f.name });
  }
  return parts;
}
