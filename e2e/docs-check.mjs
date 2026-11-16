// docs/*.md 안의 mermaid 블록을 실제 mermaid 파서로 검사한다 (헤드리스 Edge).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const dir = new URL('../docs/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const blocks = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
  const s = readFileSync(join(dir, f), 'utf8');
  let i = 0;
  for (const m of s.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)) blocks.push({ file: f, i: i++, code: m[1] });
}
const b = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true }) // CI(리눅스)는 DN_CHANNEL=chrome;
const p = await b.newPage();
await p.goto('about:blank');
const results = await p.evaluate(async (blocks) => {
  const m = (await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')).default;
  m.initialize({ startOnLoad: false });
  const out = [];
  for (const bl of blocks) {
    try { await m.parse(bl.code); out.push({ file: bl.file, i: bl.i, ok: true }); }
    catch (e) { out.push({ file: bl.file, i: bl.i, ok: false, err: String(e.message || e).slice(0, 240) }); }
  }
  return out;
}, blocks);
await b.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`FAIL ${r.file}#${r.i}: ${r.err}`);
console.log(`${results.length - bad.length}/${results.length} mermaid blocks OK`);
process.exit(bad.length ? 1 : 0);
