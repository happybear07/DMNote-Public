// 첨부 저장소 (FR-018 이미지 · DATABASE 4.4): 파일 내용의 SHA-256을 키로 한 번만 저장한다(같은 이미지를 여러 번 붙여도 하나).
// 노트 데이터와 떨어진 DB('dn-files')라 큰 파일이 노트 열기 · 백업 경로에 섞이지 않는다. (OPFS 이전은 나중 — 인터페이스는 그대로)
import { openDb, req, write, type DbHooks } from './idb';

export interface Attachment {
  hash: string;
  blob: Blob;
  mime: string;
  size: number;
  /** 이미지면 원래 크기 */
  w?: number;
  h?: number;
  createdAt: number;
}

const DB_NAME = 'dn-files';
const DB_VERSION = 1;

/** 내용 해시 (hex). 보안 컨텍스트가 아니면(crypto.subtle 없음) 무작위 id — 같은 파일 합치기만 못 할 뿐 */
async function hashBlob(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const d = new Uint8Array(await subtle.digest('SHA-256', await blob.arrayBuffer()));
    return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `r${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`;
}

export class AttachmentStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name = DB_NAME, hooks: DbHooks = {}): Promise<AttachmentStore> {
    const db = await openDb(name, DB_VERSION, (d, old) => {
      if (old < 1) d.createObjectStore('attachments', { keyPath: 'hash' });
    }, hooks);
    return new AttachmentStore(db);
  }

  /** 저장하고 해시를 돌려준다 (이미 있으면 그대로) */
  async put(blob: Blob, meta: { w?: number; h?: number; hash?: string } = {}): Promise<string> {
    const hash = meta.hash ?? (await hashBlob(blob));
    // 같은 해시면 같은 내용 — 확인 없이 덮어써도 된다 (확인 뒤 쓰면 await 사이에 트랜잭션이 닫힐 수 있다)
    await write(this.db, 'attachments', (s) => s.put({ hash, blob, mime: blob.type || 'application/octet-stream', size: blob.size, ...(meta.w ? { w: meta.w, h: meta.h } : {}), createdAt: Date.now() } satisfies Attachment));
    return hash;
  }

  async get(hash: string): Promise<Attachment | undefined> {
    return (await req(this.db.transaction('attachments').objectStore('attachments').get(hash))) as Attachment | undefined;
  }
}
