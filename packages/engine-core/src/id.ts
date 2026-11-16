// 클라이언트 생성 id: 22자 base62, 약 131비트 난수 (ENGINE 3.2, 제약 C1).

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ID_LENGTH = 22;

export function newId(): string {
  let out = '';
  const buf = new Uint8Array(32);
  while (out.length < ID_LENGTH) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      // 248 = 62 * 4. 그 이상은 버려 모듈로 편향을 없앤다.
      if (b < 248) out += ALPHABET[b % 62];
      if (out.length === ID_LENGTH) break;
    }
  }
  return out;
}

export function isId(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9A-Za-z]{22}$/.test(s);
}
