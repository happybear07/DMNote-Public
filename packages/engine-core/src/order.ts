// fractional 순서 키 (ENGINE 3.6). 정렬은 항상 (order, id) 사전순.
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

export type OrderKey = string;

export function keyBetween(a: OrderKey | null, b: OrderKey | null): OrderKey {
  return generateKeyBetween(a, b);
}

export function keysBetween(a: OrderKey | null, b: OrderKey | null, n: number): OrderKey[] {
  return generateNKeysBetween(a, b, n);
}

/** 문자열 코드 단위 비교. localeCompare는 fractional 키 순서를 깨므로 쓰지 않는다. */
export function compareKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareByOrder<T extends { order: string; id: string }>(a: T, b: T): number {
  return compareKey(a.order, b.order) || compareKey(a.id, b.id);
}

export function isOrderKey(s: unknown): s is OrderKey {
  if (typeof s !== 'string' || s.length === 0 || s.length > 256) return false;
  try {
    generateKeyBetween(s, null);
    return true;
  } catch {
    return false;
  }
}
