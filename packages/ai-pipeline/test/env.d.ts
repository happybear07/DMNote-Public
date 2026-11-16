// 테스트가 쓰는 Node 내장 모듈 최소 선언 — @types/node를 저장소에 들이지 않기 위해 (engine-core/src/env.d.ts와 같은 방식).
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string): void;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function dirname(p: string): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
// 선택 실행 시험(세션 평가)의 환경 변수 · 출력
declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };
