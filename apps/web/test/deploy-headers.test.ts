// 배포 헤더: 빌드 환경의 Supabase 주소가 CSP connect-src에 들어가야 배포에서 로그인이 막히지 않는다
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { originOf, withConnectOrigins } from '../deploy-headers';

const HEADERS = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
const connectSrc = (h: string) => h.match(/Content-Security-Policy:[^\n]*?connect-src([^;\n]*)/)![1]!.trim().split(/\s+/);

describe('배포 헤더 connect-src', () => {
  it('Supabase 주소의 출처를 더하고, 원래 값은 그대로', () => {
    const out = withConnectOrigins(HEADERS, [originOf('https://abcd.supabase.co/')!]);
    expect(connectSrc(out)).toEqual([...connectSrc(HEADERS), 'https://abcd.supabase.co']);
    expect(out.replace(' https://abcd.supabase.co', '')).toBe(HEADERS); // 다른 줄 · 지시어는 안 바뀜
  });

  it('이미 있으면 두 번 넣지 않고, 주소가 없으면 그대로', () => {
    const once = withConnectOrigins(HEADERS, ['https://abcd.supabase.co']);
    expect(withConnectOrigins(once, ['https://abcd.supabase.co'])).toBe(once);
    expect(withConnectOrigins(HEADERS, [])).toBe(HEADERS);
  });

  it('출처만 — 경로를 떼고, https가 아니거나 잘못된 주소는 넣지 않는다', () => {
    expect(originOf('https://abcd.supabase.co/auth/v1')).toBe('https://abcd.supabase.co');
    expect(originOf('http://localhost:54321')).toBeNull();
    expect(originOf('not a url')).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });

  it('받아쓰기(FR-044): wasm 실행만 허용(eval은 막은 채) · 모델 내려받기 출처만 더함', () => {
    const script = HEADERS.match(/script-src([^;\n]*)/)![1]!.trim().split(/\s+/);
    expect(script).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(connectSrc(HEADERS)).toEqual(expect.arrayContaining(['https://huggingface.co', 'https://*.hf.co']));
  });

  it('마이크는 같은 출처에 허용(음성 녹음), 카메라 · 위치는 막음', () => {
    expect(HEADERS).toMatch(/Permissions-Policy: camera=\(\), microphone=\(self\), geolocation=\(\)/);
  });

  it('배포 막음 P-6 · DEMO-SECURITY-CHECK 4-1: 녹음 · 영상 blob 재생, 내보내기 그림 blob 읽기, 밖 이미지 · 인라인 스크립트는 막음', () => {
    const csp = HEADERS.match(/Content-Security-Policy:([^\n]*)/)![1]!;
    const dir = (name: string) => (csp.match(new RegExp(`${name}([^;]*)`))?.[1] ?? '').trim().split(/\s+/);
    expect(dir('media-src')).toEqual(["'self'", 'blob:']);
    expect(connectSrc(HEADERS)).toContain('blob:');
    expect(dir('img-src')).not.toContain('https:');
    expect(dir('script-src').some((x) => x.startsWith("'unsafe-"))).toBe(false);
    for (const h of ['X-Frame-Options: DENY', 'Strict-Transport-Security: max-age=', 'Cross-Origin-Opener-Policy:', 'Cross-Origin-Resource-Policy:']) expect(HEADERS).toContain(h);
  });
});
