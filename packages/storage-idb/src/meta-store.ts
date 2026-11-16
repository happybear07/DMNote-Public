// 노트 메타 · 폴더 · 태그 · 검색 문서 — dn-app (DATABASE 4.3 · 4.4).
// v3(P3): folders · tags · search_docs 스토어와 notes_meta의 by_folder · by_parent · by_tag 인덱스.
import type { Id } from '@dn/engine-core';
import { done, openDb, req, write, type DbHooks } from './idb';

/** 알림 하나 (FR-136): 블록 · 날짜 · 시각 · 반복 · 그 줄 글자(잠긴 노트는 빈 글자) · 끝남(체크한 할 일) */
export interface NoteReminder { blockId: Id; date: string; time: string; repeat: '' | 'daily' | 'weekly'; text: string; done: boolean; /** 같은 블록 안에서 가르는 값 (콘텐츠 · 순서 또는 항목 · 속성) */ id?: string }

export interface NoteMeta {
  id: Id;
  title: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  stats?: { blocks: number };
  /** 첫 블록의 첫 줄 — 제목이 비었을 때 목록에 대신 보여 준다 (FR-069) */
  preview?: string;
  /** 노트 아이콘 (FR-070) — 노트의 note.icon을 목록 · 검색에 쓰려고 옮겨 둔다 */
  icon?: string;
  /** 알림 (FR-136) — 시각이 붙은 날짜 멘션. 노트를 열지 않고도 알림을 띄우려고 옮겨 둔다 */
  reminders?: NoteReminder[];
  /** 소속 폴더 (FR-073). 없으면 루트. parentNoteId와 함께 쓰지 않는다 */
  folderId?: Id;
  /** 상위 노트 (예전 중첩 노트 · 데이터베이스 항목 페이지의 상위) — 사이드바는 노트 안에 노트를 두지 않는다 */
  parentNoteId?: Id;
  /** 이 노트의 블록(콘텐츠 묶음) 이름 — 사이드바에서 노트를 열지 않고도 노트 아래에 보여 준다 (잠긴 노트는 비움) */
  blocks?: { id: Id; name: string }[];
  /** 태그 (FR-074) */
  tagIds?: Id[];
  /** 글 속 #해시태그로 붙은 태그 (tagIds의 일부) — 글에서 #낱말을 지우면 이 태그도 뗀다 (10/26) */
  hashTagIds?: Id[];
  /** 노트 역할 — 노트의 note.role을 목록 · 노트에 묻기 범위에 쓰려고 옮겨 둔다 */
  role?: string;
  /** 직접 정한 역할이 없을 때 제목 · 소제목으로 추정한 역할 (파생 — search guessRole) */
  roleGuess?: string;
  /** 표지 쪽 썸네일 (11/03, data URL — webp 폭 240) — 홈 책장의 책 표지. 잠긴 노트 · 표지 없는 노트는 없음 */
  coverThumb?: string;
  /** 서재(홈) 책 표지 색 — 이 노트만 (book-colors.ts 이름, 11/11). 없으면 폴더 색 */
  bookColor?: string;
  /** 즐겨찾기에 넣은 시각 (FR-075) — 없으면 즐겨찾기 아님. 이 순서로 보여 준다 */
  favoriteAt?: number;
  /** 잠긴 노트 (FR-144) — 내용은 금고 열쇠로 암호화해 저장, 미리보기 · 검색 문서는 두지 않는다 */
  locked?: true;
  /** 데이터베이스 항목 페이지면 그 항목 (FR-063) — 데이터베이스가 있는 노트 · 콘텐츠 · 항목 */
  dbRef?: { noteId: Id; contentId: Id; rowId: Id };
  schemaVersion: 1;
}

export interface Folder {
  id: Id;
  name: string;
  parentId?: Id;
  /** 잠긴 폴더 (FR-144) — 안의 노트를 잠그고, 새로 만드는 노트도 잠근다 */
  locked?: true;
  /** 서재(홈)의 책 표지 색 — book-colors.ts의 이름(navy · forest …). 없으면 폴더 id로 고른 색 (11/10) */
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Tag {
  id: Id;
  name: string;
  /** 같은 이름 판정용 — 소문자 · NFC · 앞뒤 공백 제거 */
  nameKey: string;
  createdAt: number;
}

/** 검색 문서 (파생, FR-121): 노트의 블록별 글자. 노트를 편집하면 다시 쓴다. */
export interface SearchDoc {
  noteId: Id;
  /** links: 블록이 가리키는 노트 (FR-080 · 081 백링크) */
  blocks: { id: Id; text: string; links?: Id[]; kinds?: string[]; ai?: true }[];
  updatedAt: number;
  /** 형식 버전 — 앱의 검색 문서 형식과 다르면 다시 색인한다 */
  v?: number;
}

export function tagKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

export class MetaStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name = 'dn-app', hooks: DbHooks = {}): Promise<MetaStore> {
    const db = await openDb(name, 3, (db, old, tx) => {
      if (old < 1) {
        const s = db.createObjectStore('notes_meta', { keyPath: 'id' });
        s.createIndex('by_updated', 'updatedAt');
        s.createIndex('by_deleted', 'deletedAt');
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      // v2: 로컬 전용 모드 비밀값 (Claude API 키, SECURITY 4절)
      if (old < 2) db.createObjectStore('secrets', { keyPath: 'name' });
      // v3: 폴더 · 태그 (FR-073 · FR-074), 검색 문서 (FR-121)
      if (old < 3) {
        const n = tx.objectStore('notes_meta');
        n.createIndex('by_folder', 'folderId');
        n.createIndex('by_parent', 'parentNoteId');
        n.createIndex('by_tag', 'tagIds', { multiEntry: true });
        const f = db.createObjectStore('folders', { keyPath: 'id' });
        f.createIndex('by_parent', 'parentId');
        const t = db.createObjectStore('tags', { keyPath: 'id' });
        t.createIndex('by_name', 'nameKey', { unique: true });
        db.createObjectStore('search_docs', { keyPath: 'noteId' });
      }
    }, hooks);
    return new MetaStore(db);
  }

  async list(opts: { trash?: boolean } = {}): Promise<NoteMeta[]> {
    const all = (await req(this.db.transaction('notes_meta').objectStore('notes_meta').getAll())) as NoteMeta[];
    return all
      .filter((n) => (opts.trash ? n.deletedAt !== undefined : n.deletedAt === undefined))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 휴지통에서 `before`보다 먼저 지운 노트 id (30일 자동 영구 삭제 대상, DATABASE 10절) */
  async expired(before: number): Promise<Id[]> {
    return (await this.list({ trash: true })).filter((n) => n.deletedAt! < before).map((n) => n.id);
  }

  async get(id: Id): Promise<NoteMeta | undefined> {
    return (await req(this.db.transaction('notes_meta').objectStore('notes_meta').get(id))) as NoteMeta | undefined;
  }

  put(m: NoteMeta): Promise<void> { return write(this.db, 'notes_meta', (s) => s.put(m)); }

  async patch(id: Id, patch: Partial<Omit<NoteMeta, 'id'>>): Promise<NoteMeta | undefined> {
    const tx = this.db.transaction('notes_meta', 'readwrite');
    const s = tx.objectStore('notes_meta');
    const cur = (await req(s.get(id))) as NoteMeta | undefined;
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as Record<string, unknown>)[k];
    s.put(next);
    await done(tx);
    return next;
  }

  async remove(id: Id): Promise<void> {
    const tx = this.db.transaction(['notes_meta', 'search_docs'], 'readwrite');
    tx.objectStore('notes_meta').delete(id);
    tx.objectStore('search_docs').delete(id);
    await done(tx);
  }

  // ───────── 폴더 (FR-073) ─────────

  async listFolders(): Promise<Folder[]> {
    return (await req(this.db.transaction('folders').objectStore('folders').getAll())) as Folder[];
  }

  putFolder(f: Folder): Promise<void> { return write(this.db, 'folders', (s) => s.put(f)); }

  removeFolder(id: Id): Promise<void> { return write(this.db, 'folders', (s) => s.delete(id)); }

  // ───────── 태그 (FR-074) ─────────

  async listTags(): Promise<Tag[]> {
    return (await req(this.db.transaction('tags').objectStore('tags').getAll())) as Tag[];
  }

  /** 같은 이름(nameKey)의 다른 태그가 있으면 false — 이름은 고유하다 */
  async putTag(t: Tag): Promise<boolean> {
    const tx = this.db.transaction('tags', 'readwrite');
    const s = tx.objectStore('tags');
    const same = (await req(s.index('by_name').get(t.nameKey))) as Tag | undefined;
    if (same && same.id !== t.id) { tx.abort(); return false; }
    s.put(t);
    await done(tx);
    return true;
  }

  /** 태그를 지우고 모든 노트에서 뗀다 (한 트랜잭션) */
  async removeTag(id: Id): Promise<void> {
    const tx = this.db.transaction(['tags', 'notes_meta'], 'readwrite');
    tx.objectStore('tags').delete(id);
    const s = tx.objectStore('notes_meta');
    const hits = (await req(s.index('by_tag').getAll(id))) as NoteMeta[];
    for (const n of hits) s.put({ ...n, tagIds: n.tagIds!.filter((x) => x !== id) });
    await done(tx);
  }

  // ───────── 검색 문서 (FR-121) ─────────

  async listSearchDocs(): Promise<SearchDoc[]> {
    return (await req(this.db.transaction('search_docs').objectStore('search_docs').getAll())) as SearchDoc[];
  }

  deleteSearchDoc(noteId: Id): Promise<void> { return write(this.db, 'search_docs', (s) => s.delete(noteId)); }

  putSearchDoc(d: SearchDoc): Promise<void> { return write(this.db, 'search_docs', (s) => s.put(d)); }

  // ───────── 비밀값 (SECURITY 4절) ─────────
  // AES-GCM으로 암호화해 저장하고, 키 암호화 키는 추출 불가 CryptoKey로 같은 스토어에 둔다.
  // "디스크에서 평문으로 보이지 않게" 하는 수준 — 같은 오리진 스크립트는 복호화할 수 있다(설정 화면에서 고지).

  private async kek(): Promise<CryptoKey> {
    const got = (await req(this.db.transaction('secrets').objectStore('secrets').get('__kek'))) as { key: CryptoKey } | undefined;
    if (got) return got.key;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await write(this.db, 'secrets', (s) => s.put({ name: '__kek', key }));
    return key;
  }

  async setSecret(name: string, value: string, meta: Record<string, unknown> = {}): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.kek(), new TextEncoder().encode(value));
    await write(this.db, 'secrets', (s) => s.put({ name, iv, data, meta, updatedAt: Date.now() }));
  }

  async getSecret(name: string): Promise<string | undefined> {
    const r = (await req(this.db.transaction('secrets').objectStore('secrets').get(name))) as { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer } | undefined;
    if (!r) return undefined;
    try {
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv }, await this.kek(), r.data));
    } catch {
      return undefined; // 키 암호화 키가 사라졌으면(사이트 데이터 일부 삭제) 다시 입력받는다
    }
  }

  /** 복호화 없이 메타만 (끝 4자리 · 확인 시각 표시용) */
  async secretMeta(name: string): Promise<Record<string, unknown> | undefined> {
    const r = (await req(this.db.transaction('secrets').objectStore('secrets').get(name))) as { meta: Record<string, unknown> } | undefined;
    return r?.meta;
  }

  deleteSecret(name: string): Promise<void> { return write(this.db, 'secrets', (s) => s.delete(name)); }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const r = (await req(this.db.transaction('settings').objectStore('settings').get(key))) as { value: T } | undefined;
    return r?.value;
  }

  setSetting(key: string, value: unknown): Promise<void> { return write(this.db, 'settings', (s) => s.put({ key, value, scope: 'device', updatedAt: Date.now() })); }
}
