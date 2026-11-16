// engine-core는 DOM 타입 없이 컴파일한다 (FR-001). Node 19+ · 모든 대상 브라우저에 있는 전역만 선언한다.
declare function structuredClone<T>(value: T): T;
declare var crypto: { getRandomValues<T extends ArrayBufferView>(array: T): T };
/** 웹 주소 해석 (web.ts) — 쓰는 멤버만 */
declare class URL {
  constructor(url: string, base?: string);
  readonly href: string;
  readonly protocol: string;
  readonly hostname: string;
  readonly pathname: string;
  readonly searchParams: { get(name: string): string | null };
}
