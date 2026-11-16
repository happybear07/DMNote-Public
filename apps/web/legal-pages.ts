// 법적 문서 정적 페이지 (/terms · /privacy · /ai — DEPLOY-PLAN 6.5 · LEGAL-RISK R1): src/legal/*.md를 빌드 때 terms.html 등으로 내고,
// 개발 서버에서는 같은 주소로 바로 보여 준다. 앱(약 700KB)을 받지 않아도 읽히고, 스토어 · 링크에 주소를 적을 수 있다.
// 서비스 워커는 이 주소들을 가로채지 않는다(sw.template.js) — 앱 안에서는 LegalDialog가 같은 글을 보여 준다.
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { esc, mdHtml, parseMd, plain } from './src/legal/md';
import { LEGAL_DOCS, LEGAL_PLACEHOLDER, type LegalId } from './src/legal/meta';

const source = (file: string) => readFileSync(new URL(`./src/legal/${file}`, import.meta.url), 'utf8');

const CSS = `:root{color-scheme:light dark;--bg:#fff;--text:#37352f;--muted:#6b6b68;--line:#e9e9e7;--soft:#f7f7f5;--accent:#3d5fe0}
@media (prefers-color-scheme:dark){:root{--bg:#191919;--text:#e6e6e3;--muted:#a3a39f;--line:#33332f;--soft:#232321;--accent:#8ea4ff}}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,system-ui,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;line-height:1.7;word-break:keep-all;overflow-wrap:anywhere;-webkit-font-smoothing:antialiased}
header,main{max-width:760px;margin:0 auto;padding:0 16px}
header{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px;padding-top:20px;padding-bottom:16px;border-bottom:1px solid var(--line)}
header .home{font-weight:700;color:var(--text);text-decoration:none;margin-right:auto}
nav{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:14px}nav a{color:var(--muted);text-decoration:none}nav a[aria-current]{color:var(--text);font-weight:600}
main{padding-bottom:64px;font-size:15px}h1{font-size:24px;margin:28px 0 4px}h2{font-size:17px;margin:32px 0 8px}h3{font-size:15px;margin:24px 0 6px}
p,li{color:var(--text)}a{color:var(--accent)}ul,ol{padding-left:22px}li{margin:4px 0}
table{display:block;overflow-x:auto;border-collapse:collapse;font-size:14px;margin:12px 0}th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}th{background:var(--soft);white-space:nowrap}`;

/** 문서 하나의 정적 HTML */
export function legalPage(id: LegalId): string {
  const doc = LEGAL_DOCS.find((d) => d.id === id)!;
  const blocks = parseMd(source(doc.file));
  const h1 = blocks.find((b) => b.t === 'h' && b.level === 1);
  const nav = LEGAL_DOCS.map((d) => `<a href="${d.path}"${d.id === id ? ' aria-current="page"' : ''}>${esc(d.title)}</a>`).join('');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(h1 && h1.t === 'h' ? plain(h1.text) : doc.title)}</title><link rel="stylesheet" href="/fonts/pretendard/pretendard.css"><style>${CSS}</style></head>
<body><header><a class="home" href="/">DamianNote</a><nav aria-label="문서">${nav}</nav></header>
<main>
${mdHtml(blocks)}
</main></body></html>
`;
}

export function legalPages(): Plugin {
  return {
    name: 'dn-legal-pages',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const doc = LEGAL_DOCS.find((d) => path === d.path || path === `${d.path}.html`);
        if (!doc) { next(); return; }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(legalPage(doc.id));
      });
    },
    generateBundle() {
      for (const d of LEGAL_DOCS) {
        const left = source(d.file).match(LEGAL_PLACEHOLDER);
        if (left) this.warn(`${d.file}: 출시 전에 채울 자리표시자가 남아 있어요 — ${[...new Set(left)].join(' · ')}`);
        this.emitFile({ type: 'asset', fileName: `${d.path.slice(1)}.html`, source: legalPage(d.id) });
      }
    },
  };
}
