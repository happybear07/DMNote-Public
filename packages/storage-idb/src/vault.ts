// 잠금 금고 (FR-144 · FR-146): 잠긴 노트를 기기에서 암호화하는 열쇠.
// 비밀번호 → PBKDF2-SHA256(60만 회, 무작위 salt) → 열쇠 암호화 키(KEK) → 무작위 데이터 키(DEK, AES-GCM 256)를 감싸 보관한다.
// 비밀번호를 바꿔도 DEK만 다시 감싸므로 노트를 다시 암호화하지 않는다. 비밀번호를 잊으면 잠긴 노트는 되살릴 수 없다(복구 열쇠 없음 — 설계상).
// 메모리에는 풀린 DEK(추출 불가 CryptoKey)만 두고, 비밀번호 · 원시 키는 남기지 않는다.

export interface VaultRecord {
  v: 1;
  salt: Uint8Array<ArrayBuffer>;
  iter: number;
  /** KEK로 감싼 DEK */
  wrapped: { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer };
  createdAt: number;
}

/** 암호문 한 덩이 (IDB에 그대로 저장) */
export interface Sealed { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }
export const isSealed = (x: unknown): x is Sealed => !!x && typeof x === 'object' && (x as Sealed).iv instanceof Uint8Array && (x as Sealed).data instanceof ArrayBuffer;

const ITER = 600_000;
const enc = new TextEncoder(), dec = new TextDecoder();
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));

async function kekOf(password: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

async function wrap(dek: CryptoKey, password: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<VaultRecord['wrapped']> {
  const iv = rand(12);
  return { iv, data: await crypto.subtle.wrapKey('raw', dek, await kekOf(password, salt, iter), { name: 'AES-GCM', iv }) };
}

/** 새 금고: DEK를 만들고 비밀번호로 감싼다 */
export async function createVault(password: string, iter = ITER): Promise<{ record: VaultRecord; cipher: VaultCipher }> {
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const salt = rand(16);
  const record: VaultRecord = { v: 1, salt, iter, wrapped: await wrap(dek, password, salt, iter), createdAt: Date.now() };
  // 메모리에는 추출 불가로 다시 들인 키만
  const live = await openVault(record, password);
  if (!live) throw new Error('금고를 만들지 못했어요');
  return { record, cipher: live };
}

/** 비밀번호로 열기 — 틀리면 null (GCM 인증 실패) */
export async function openVault(record: VaultRecord, password: string): Promise<VaultCipher | null> {
  try {
    const kek = await kekOf(password, record.salt, record.iter);
    const dek = await crypto.subtle.unwrapKey('raw', record.wrapped.data, kek, { name: 'AES-GCM', iv: record.wrapped.iv }, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return new VaultCipher(dek);
  } catch { return null; }
}

/** 비밀번호 바꾸기 — 같은 DEK를 새 비밀번호로 다시 감싼다 (노트는 그대로). 옛 비밀번호가 틀리면 null */
export async function changeVaultPassword(record: VaultRecord, oldPw: string, newPw: string): Promise<VaultRecord | null> {
  try {
    const dek = await crypto.subtle.unwrapKey('raw', record.wrapped.data, await kekOf(oldPw, record.salt, record.iter), { name: 'AES-GCM', iv: record.wrapped.iv },
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const salt = rand(16);
    return { ...record, salt, iter: ITER, wrapped: await wrap(dek, newPw, salt, ITER) };
  } catch { return null; }
}

/** 풀린 금고: JSON 값 ↔ 암호문 */
export class VaultCipher {
  constructor(private readonly key: CryptoKey) {}
  async seal(value: unknown): Promise<Sealed> {
    const iv = rand(12);
    return { iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, enc.encode(JSON.stringify(value))) };
  }
  async open<T = unknown>(s: Sealed): Promise<T> {
    return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv }, this.key, s.data))) as T;
  }
}

/** 금고가 잠겨 있어 잠긴 노트를 읽거나 쓸 수 없다 */
export class VaultLockedError extends Error {
  constructor(readonly noteId: string) { super('잠긴 노트예요 — 잠금 비밀번호로 풀어 주세요'); this.name = 'VaultLockedError'; }
}
