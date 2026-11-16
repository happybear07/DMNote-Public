// Node 내장 타입 제거(--experimental-strip-types, Node 22.18+/24 기본)로 TS를 그대로 실행하기 위한 해석 훅.
// engine-core는 번들러식 확장자 없는 import('./engine')를 쓰므로 .ts · /index.ts를 붙여 찾는다. 새 의존성 없이 벤치를 돌리려는 것.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    if ((spec.startsWith('./') || spec.startsWith('../')) && !/\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.endsWith('.ts')) {
      for (const ext of ['.ts', '/index.ts']) {
        try { return next(spec + ext, ctx); } catch { /* 다음 후보 */ }
      }
    }
    return next(spec, ctx);
  },
});
