// 배포 응답 헤더(public/_headers)에 이번 빌드가 실제로 부르는 서버 주소를 CSP connect-src로 더한다.
// 로그인(Supabase Auth)은 VITE_SUPABASE_URL이 있을 때만 켜지는데, 그 주소가 connect-src에 없으면 배포에서만 로그인 요청이 막힌다
// (개발 서버는 _headers를 걸지 않아 드러나지 않는다). 주소는 빌드 환경 변수에서 오므로 파일에 손으로 적지 않고 빌드 때 넣는다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** 주소 → 출처(https만, 경로 · 쿼리 없이). 잘못된 주소면 null */
export function originOf(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' ? u.origin : null;
  } catch { return null; }
}

/** _headers 본문의 모든 CSP connect-src에 출처를 더한다 (이미 있으면 그대로) */
export function withConnectOrigins(headers: string, origins: readonly string[]): string {
  if (!origins.length) return headers;
  return headers.replace(/(Content-Security-Policy:[^\n]*?connect-src)([^;\n]*)/g, (_m, head: string, list: string) => {
    const have = list.trim().split(/\s+/).filter(Boolean);
    for (const o of origins) if (!have.includes(o)) have.push(o);
    return `${head} ${have.join(' ')}`;
  });
}

/** 빌드가 끝난 뒤 dist/_headers에 서버 주소를 넣는다 */
export function deployHeaders(env: Record<string, string>): Plugin {
  let outDir = 'dist';
  return {
    name: 'dn-deploy-headers',
    apply: 'build',
    configResolved(c) { outDir = join(c.root, c.build.outDir); },
    closeBundle() {
      const file = join(outDir, '_headers');
      if (!existsSync(file)) return;
      const origins = [originOf(env.VITE_SUPABASE_URL)].filter((o): o is string => !!o);
      if (env.VITE_SUPABASE_URL && !origins.length) this.warn(`VITE_SUPABASE_URL이 https 주소가 아니라 CSP에 넣지 않았어요: ${env.VITE_SUPABASE_URL}`);
      writeFileSync(file, withConnectOrigins(readFileSync(file, 'utf8'), origins));
    },
  };
}
