// 운영 빌드(apps/web/dist)를 배포와 같은 응답 헤더(dist/_headers — CSP 등)로 내준다. 개발 서버에는 CSP가 없어
// 배포에서만 막히는 것(wasm 실행 · 외부 주소 · 워커)을 여기서 미리 본다. 사용: `node scripts/serve-dist.mjs [포트]` (먼저 `corepack pnpm build`)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
const PORT = Number(process.argv[2]) || 4173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

// Cloudflare Pages _headers: "/*" 아래 들여 쓴 "이름: 값" 줄 (이 앱은 전체 경로 한 묶음만 쓴다)
const headers = {};
for (const line of (await readFile(join(ROOT, '_headers'), 'utf8')).split('\n')) {
  const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
  if (m) headers[m[1]] = m[2].trim();
}

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^([/\\])+/, '');
  let file = join(ROOT, path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); }
  catch { file = join(ROOT, extname(path) ? path : 'index.html'); } // 앱 경로 · 해시 링크는 앱 셸
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', ...headers });
    res.end(body);
  } catch { res.writeHead(404).end(); }
}).listen(PORT, () => console.log(`dist + 배포 헤더: http://localhost:${PORT}`));
