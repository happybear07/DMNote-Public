// IndexedDB 얇은 프로미스 래퍼.

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IDB 트랜잭션 중단'));
  });
}

/** 스토어 하나에 쓰고 끝날 때까지 기다린다 (async라 transaction()의 동기 예외도 거부로 돌아간다) */
export async function write(db: IDBDatabase, store: string, fn: (s: IDBObjectStore) => unknown): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  fn(tx.objectStore(store));
  await done(tx);
}

/** 다른 탭과의 버전 충돌 알림 (배포 QA E2) */
export interface DbHooks {
  /** 다른 탭이 옛 버전 연결을 쥐고 있어 업그레이드를 기다리는 중 — 그 탭이 닫히면 열기가 이어진다 */
  blocked?(): void;
  /** 다른 탭(새 버전)이 DB를 올리려 한다. 이 함수가 끝나면(대기 중인 쓰기를 마칠 기회) 연결을 닫아 길을 비켜 준다 */
  versionChange?(): void | Promise<void>;
}

export function openDb(name: string, version: number, upgrade: (db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => void, hooks: DbHooks = {}): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion, r.transaction!);
    r.onsuccess = () => {
      const db = r.result;
      // 닫지 않으면 새 버전 탭의 업그레이드가 영원히 막힌다
      db.onversionchange = () => {
        void Promise.resolve().then(() => hooks.versionChange?.()).catch(() => {}).finally(() => db.close());
      };
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    // 실패로 끝내지 않는다 — 요청은 살아 있어서 옛 탭이 닫히면 success가 온다
    r.onblocked = () => hooks.blocked?.();
  });
}
