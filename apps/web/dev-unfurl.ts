// 개발 · 미리보기 서버의 /api/unfurl?url=… (FR-050 웹 북마크): 서버(Node)가 그 주소의 HTML을 받아 제목 · 설명 · 그림 · 사이트 이름을 JSON으로.
// 브라우저는 다른 사이트 HTML을 직접 못 읽어서(CORS) 서버가 대신 읽는다. 배포(정적)에는 없다 — 앱은 그때 주소만 보인다.
// 안전: http(s) · 기본 포트만, 내부망 · 이 컴퓨터 주소는 거절(리다이렉트마다 다시 확인), 같은 출처 요청만, 5초 · 512KB까지.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const MAX_BYTES = 512 * 1024;

/** 내부망 · 루프백 · 링크 로컬 · 사설 대역 */
function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}

async function safeUrl(raw: string): Promise<URL | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.port || u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  return addrs.length && !addrs.some((a) => privateIp(a.address)) ? u : null;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s: string) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
}).replace(/\s+/g, ' ').trim();

/** <meta property|name="key" content="…"> (속성 순서 상관없이) */
function meta(html: string, keys: string[]): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!key || !keys.includes(key)) continue;
    const v = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1];
    if (v?.trim()) return decode(v);
  }
  return undefined;
}

export async function unfurl(raw: string): Promise<Record<string, string> | null> {
  let u = await safeUrl(raw);
  for (let hop = 0; u && hop < 4; hop++) {
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'Mozilla/5.0 (DamianNote link preview)', accept: 'text/html,application/xhtml+xml' } });
    if (r.status >= 300 && r.status < 400) { const loc = r.headers.get('location'); u = loc ? await safeUrl(new URL(loc, u).href) : null; continue; }
    if (!r.ok || !/html/i.test(r.headers.get('content-type') ?? '') || !r.body) return null;
    // 앞 512KB만 (<head>면 충분)
    const reader = r.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); size += value.length; }
    void reader.cancel().catch(() => {});
    const html = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
    const title = meta(html, ['og:title', 'twitter:title']) ?? (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)![1]!) : undefined);
    const description = meta(html, ['og:description', 'twitter:description', 'description']);
    const site = meta(html, ['og:site_name', 'application-name']);
    let image = meta(html, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
    try { image = image ? new URL(image, u).href : undefined; } catch { image = undefined; }
    if (image && !/^https?:/i.test(image)) image = undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries({ title, description, site, image })) if (v) out[k] = v.slice(0, k === 'image' ? 1000 : 300);
    return out;
  }
  return null;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // 다른 사이트의 페이지가 이 서버를 대신 부르지 못하게
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') { res.statusCode = 403; res.end(); return; }
  const url = new URL(req.url ?? '', 'http://x').searchParams.get('url') ?? '';
  const out = await unfurl(url).catch(() => null);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'private, max-age=3600');
  // 못 모았으면 빈 정보 (404로 두면 브라우저 콘솔에 오류가 찍힌다)
  res.end(JSON.stringify(out ?? {}));
}

export function devUnfurl(): Plugin {
  // 아무것도 돌려주지 않는다 — 함수를 돌려주면 vite가 "내부 미들웨어 뒤에 붙일 훅"으로 부른다
  const use = (s: { middlewares: { use(path: string, fn: (req: IncomingMessage, res: ServerResponse) => void): unknown } }): void => {
    s.middlewares.use('/api/unfurl', (req, res) => { void handle(req, res); });
  };
  return { name: 'dn-dev-unfurl', configureServer: use, configurePreviewServer: use };
}
