// 구조 안전장치 (DEV-GUIDE 1 · 2절). 새 의존성 없이 소스를 직접 훑는다. 커밋 전 훅(.githooks/pre-commit)과 CI가 돌린다.
//   1. 파일 크기: 소스 파일 하나가 MAX_LINES줄을 넘으면 실패 — 한 파일에 기능이 몰리는 것을 막는다
//   2. 패키지 경계: 패키지가 가져다 쓸 수 있는 @dn 패키지를 정해 두고, 그 밖의 import는 실패 (ARCHITECTURE 5.1)
//   3. 금지 코드: console.log, innerHTML 직접 대입, HTML 문자열 넣기 · 코드 실행 · srcdoc (DEV-GUIDE 2절 · SECURITY 5.1 · DEMO-SECURITY-CHECK 15)
//   4. 비밀값: Claude 키처럼 보이는 문자열 · .env.local이 커밋 대상에 있으면 실패
// 사용: node scripts/check-arch.mjs [--staged]   (--staged: 커밋하려고 올린 파일만 비밀값 검사)
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX_LINES = 400;

/** 패키지 → 가져다 쓸 수 있는 @dn 패키지 (화살표 = import 방향, 순환 금지) */
const ALLOWED = {
  'engine-core': [],
  'text-pm': ['engine-core'],
  'engine-dom': ['engine-core', 'text-pm'],
  'storage-idb': ['engine-core'],
  search: ['engine-core'],
  sync: ['engine-core'],
  'ai-pipeline': ['engine-core', 'text-pm'],
  web: '*', // 앱 셸은 모든 패키지를 조립한다
};

const SOURCE_DIRS = [
  ...readdirSync(join(ROOT, 'packages')).map((p) => ({ pkg: p, dir: join(ROOT, 'packages', p, 'src') })),
  { pkg: 'web', dir: join(ROOT, 'apps', 'web', 'src') },
];

const errors = [];
const fail = (file, msg) => errors.push(`${relative(ROOT, file).split(sep).join('/')}: ${msg}`);

function walk(dir) {
  let out = [];
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (/\.(ts|tsx|css)$/.test(n) && !/\.gen\.ts$/.test(n) && !/\.d\.ts$/.test(n)) out.push(p);
  }
  return out;
}

for (const { pkg, dir } of SOURCE_DIRS) {
  const allowed = ALLOWED[pkg];
  if (allowed === undefined) { fail(dir, `ALLOWED에 없는 새 패키지 '${pkg}' — scripts/check-arch.mjs에 경계를 먼저 정해야 한다`); continue; }
  for (const file of walk(dir)) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n').length;
    if (lines > MAX_LINES) fail(file, `${lines}줄 — 파일당 ${MAX_LINES}줄 이하로 나눠야 한다`);
    // 겹침 단계 (DS-F9): 앱 화면 CSS의 z-index 20 이상은 tokens.css의 --z-* 토큰으로만 — 판이 창을 덮던 것이 다시 생기지 않게
    if (pkg === 'web' && file.endsWith('.css')) src.split('\n').forEach((line, i) => { const m = /z-index:\s*(\d+)/.exec(line); if (m && +m[1] >= 20) fail(file, `${i + 1}행: z-index ${m[1]} — 겹침 단계 토큰(--z-*, tokens.css)을 쓴다`); });
    if (!file.endsWith('.css')) {
      for (const m of src.matchAll(/from\s+'@dn\/([a-z-]+)/g)) {
        const target = m[1];
        if (target === pkg) continue;
        if (allowed !== '*' && !allowed.includes(target)) fail(file, `'${pkg}'는 '@dn/${target}'를 import할 수 없다 (허용: ${allowed.join(', ') || '없음'})`);
      }
      src.split('\n').forEach((line, i) => {
        if (/\bconsole\.log\(/.test(line)) fail(file, `${i + 1}행: console.log를 커밋하지 않는다`);
        if (/\.innerHTML\s*=(?!=)/.test(line)) fail(file, `${i + 1}행: innerHTML 직접 대입 금지 (텍스트는 textContent, 서식은 스키마 경유)`);
        // HTML을 문자열로 넣거나 코드로 실행하는 길 (DEMO-SECURITY-CHECK 4절 15번) — srcdoc는 인쇄 틀(print-render.ts) 한 곳만 승인
        if (/insertAdjacentHTML\(|\.outerHTML\s*=(?!=)|document\.write(ln)?\(|(^|[^.\w])eval\(|new Function\(/.test(line)) fail(file, `${i + 1}행: HTML 문자열 넣기 · 코드 실행(insertAdjacentHTML · outerHTML · document.write · eval · new Function) 금지`);
        if (/\.srcdoc\s*=(?!=)/.test(line) && !file.endsWith('print-render.ts')) fail(file, `${i + 1}행: srcdoc 대입은 print-render.ts(이스케이프한 인쇄 틀)만`);
      });
    }
  }
}

// 비밀값: git이 추적하거나(기본) 커밋하려고 올린(--staged) 파일
const staged = process.argv.includes('--staged');
const tracked = execFileSync('git', staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);
// Claude 키 + 흔한 다른 비밀값(구글 API 키 · GitHub 토큰 · Supabase 서비스 키 · PEM 개인 키) — DEMO-SECURITY-CHECK 4절 15번
const KEY = /sk-ant-[A-Za-z0-9_-]{24,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36,}|sbp_[A-Za-z0-9]{40}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/;
for (const f of tracked) {
  if (/(^|\/)\.env(\.[^/]*)?$/.test(f) && !f.endsWith('.env.example')) { fail(join(ROOT, f), '.env 파일은 커밋하지 않는다 (키가 들어 있다)'); continue; }
  if (/\.(png|jpe?g|gif|woff2?|ico|pdf)$/i.test(f)) continue;
  let text;
  try { text = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
  const m = text.match(KEY);
  if (m) fail(join(ROOT, f), `비밀 키처럼 보이는 문자열 (${m[0].slice(0, 12)}…) — 키는 .env.local에만`);
}

if (errors.length) {
  console.error(`구조 검사 실패 ${errors.length}건:\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`구조 검사 통과 — 파일 ${MAX_LINES}줄 이하 · 패키지 경계 · 금지 코드 · 겹침 단계 · 비밀값`);
