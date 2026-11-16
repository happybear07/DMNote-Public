// 배포 QA (docs/RELEASE-QA.md): 배포했을 때만 드러나는 문제 — 탭 두 개 · DB 업그레이드 막힘 · 보안 컨텍스트 밖 · 렌더 오류 · AI 네트워크 오류.
// 사용: 서버 실행 후 `node e2e/release.mjs [스크린샷 폴더]` (DN_URL로 주소 변경).
// 개발 서버 또는 VITE_E2E=1로 만든 프로덕션 빌드에서 돈다 (window.__dn 필요). sw.js가 있으면(프로덕션 빌드) 오프라인 · 업데이트도 확인.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ // CI(리눅스)는 DN_CHANNEL=chrome
  channel: process.env.DN_CHANNEL ?? 'msedge', headless: true,
  args: ['--use-fake-device-for-media-stream'], // C: 가짜 마이크로 실제 녹음을 시작해 본다
});
const wait = (p, ms) => p.waitForTimeout(ms);

/** 새 컨텍스트(빈 IndexedDB) */
async function fresh(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ...opts });
  await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1')); // .env.local 키로 실제 Claude를 부르지 않게
  return ctx;
}
function watch(page, errors) {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|저장 실패/.test(m.text())) errors.push(m.text()); });
}
async function boot(page) {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__dn?.view && window.__dn.state.currentId, null, { timeout: 15000 });
  await wait(page, 300);
}
/** 같은 오리진의 빈 페이지 (앱을 띄우지 않고 IndexedDB만 만질 때) */
async function blank(ctx) {
  const p = await ctx.newPage();
  await p.route(`${BASE}/__blank`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>blank</title>' }));
  await p.goto(`${BASE}/__blank`);
  return p;
}
/** 지금 열린 노트에 블록 하나를 만들고 글자를 친다. 엔진에 들어갔으면 true */
async function typeBlock(page, text) {
  await page.evaluate(() => window.__dn.view.addBlockAtCenter());
  await wait(page, 150);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await wait(page, 100);
  return page.evaluate((t) => [...window.__dn.view.engine.contents()].some((c) => JSON.stringify(c.doc ?? '').includes(t)), text);
}
const noteText = (page) => page.evaluate(() => JSON.stringify([...window.__dn.view.engine.contents()].map((c) => c.doc)));

// ───── E3: 탭 두 개에서 같은 노트 편집 ─────
{
  const ctx = await fresh();
  const a = await ctx.newPage();
  const errors = [];
  watch(a, errors);
  await boot(a);
  await a.evaluate(() => window.__dn.newNote());
  await wait(a, 400);
  const noteId = await a.evaluate(() => window.__dn.state.currentId);
  const b = await ctx.newPage();
  watch(b, errors);
  await boot(b); // 마지막에 연 노트(같은 노트)로 열린다
  const sameNote = (await b.evaluate(() => window.__dn.state.currentId)) === noteId;
  const accA = await typeBlock(a, '탭A펭귄');
  const accB = await typeBlock(b, '탭B고래');
  const accA2 = await typeBlock(a, '탭A두번째');
  await wait(a, 1500); // 자동 저장(최대 1초) 대기
  const bStatus = await b.locator('.save-status').innerText();
  await b.screenshot({ path: `${OUT}/release-two-tabs-b.png` });
  await a.close(); // A를 닫으면 잠금이 풀려 B가 저장하는 탭이 된다
  await wait(b, 1500);
  const bAfter = await b.locator('.save-status').innerText();
  const accB2 = await typeBlock(b, '탭B이어서');
  await wait(b, 1500);
  await b.close();
  const c = await ctx.newPage();
  await boot(c);
  await c.evaluate((id) => window.__dn.openById(id), noteId);
  await wait(c, 400);
  const final = await noteText(c);
  const lost = [['탭A펭귄', accA], ['탭B고래', accB], ['탭A두번째', accA2], ['탭B이어서', accB2]].filter(([t, acc]) => acc && !final.includes(t)).map(([t]) => t);
  check('E3 두 탭에서 같은 노트: 화면에서 받아들인 편집은 하나도 사라지지 않음', sameNote && lost.length === 0, `사라진 편집: ${lost.join(', ') || '없음'} · 받아들임 A=${accA} B=${accB} A2=${accA2}`);
  // 10/05부터 두 번째 탭도 함께 고친다(탭 동기화, FR-095) — 저장은 첫 탭이 하고 상태에 그렇게 알린다
  check('E3 두 번째 탭도 함께 편집 · 저장은 첫 탭이 한다고 알림', accB && /다른 탭이 저장/.test(bStatus), `B 상태 '${bStatus}'`);
  check('E3 첫 탭을 닫으면 두 번째 탭이 바로 편집 가능해지고 그 편집도 저장됨', accB2 && !/읽기 전용/.test(bAfter) && final.includes('탭B이어서'), `B 상태 '${bAfter}'`);
  await c.close();
  await ctx.close();
}

// ───── E2: DB 업그레이드 막힘 (옛 버전 탭이 열린 채 새 버전 열기) ─────
{
  const ctx = await fresh();
  const old = await blank(ctx);
  // 옛 앱(v2)이 연결을 쥐고 있는 상태 — onversionchange가 없는 옛 코드처럼 닫지 않는다
  await old.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('dn-app', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      const s = db.createObjectStore('notes_meta', { keyPath: 'id' });
      s.createIndex('by_updated', 'updatedAt'); s.createIndex('by_deleted', 'deletedAt');
      db.createObjectStore('settings', { keyPath: 'key' }).put({ key: 'noteSort', value: 'title', scope: 'device', updatedAt: 1 });
      db.createObjectStore('secrets', { keyPath: 'name' });
    };
    r.onsuccess = () => { window.__old = r.result; res(); };
    r.onerror = () => rej(r.error);
  }));
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(BASE);
  await wait(page, 2500);
  const msg = await page.locator('.banner, .reload-banner').allInnerTexts();
  await page.screenshot({ path: `${OUT}/release-upgrade-blocked.png` });
  check('E2 업그레이드가 막히면 "다른 탭을 닫아 달라"고 알림 (빈 화면 · "노트 없음"으로 보이지 않음)', msg.some((t) => /다른 탭/.test(t)), msg.join(' | ') || '안내 없음');
  await old.evaluate(() => window.__old.close());
  const opened = await page.waitForSelector('.dn-block', { timeout: 8000 }).then(() => true, () => false);
  const sort = opened ? await page.evaluate(() => window.__dn.state.sort) : null;
  check('E2 옛 탭이 닫히면 이어서 열리고 옛 설정이 남아 있음', opened && sort === 'title', `열림=${opened} 정렬=${sort}`);
  await ctx.close();
}

// ───── E2: 열린 탭이 새 버전 요청에 길을 비켜 줌 (onversionchange) ─────
{
  const ctx = await fresh();
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await boot(page);
  await typeBlock(page, '버전전환직전');
  const newer = await blank(ctx);
  const upgraded = await newer.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('dn-app', 99);
    const t = setTimeout(() => res('blocked'), 5000);
    r.onupgradeneeded = () => {};
    r.onsuccess = () => { clearTimeout(t); r.result.close(); res('ok'); };
    r.onerror = () => { clearTimeout(t); res('error'); };
  }));
  await page.bringToFront(); // 뒤에 있는 탭은 스크린샷이 멈춘다
  await wait(page, 500);
  const banner = await page.locator('.reload-banner').allInnerTexts();
  await page.screenshot({ path: `${OUT}/release-versionchange.png` });
  check('E2 열린 탭은 새 버전이 DB를 올리도록 연결을 닫음 (새 탭이 막히지 않음)', upgraded === 'ok', upgraded);
  check('E2 비켜 준 탭은 "새 버전 — 다시 열기"를 안내', banner.some((t) => /다시 열기/.test(t)), banner.join(' | ') || '안내 없음');
  await ctx.close();
}

// ───── E4: 저장 공간 부족(QuotaExceededError) ─────
{
  const ctx = await fresh();
  const page = await ctx.newPage();
  await boot(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.__quota = true;
    IDBObjectStore.prototype.put = function (...a) {
      if (window.__quota && (this.name === 'oplog' || this.name === 'snapshots')) throw new DOMException('quota', 'QuotaExceededError');
      return put.apply(this, a);
    };
  });
  await typeBlock(page, '공간부족중편집');
  await wait(page, 1500);
  const status = await page.locator('.save-status').innerText();
  const told = (await page.locator('.banner, .dialog').allInnerTexts()).join(' | ');
  const guard = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  await page.screenshot({ path: `${OUT}/release-quota.png` });
  check('E4 저장 공간 부족: "저장 공간이 가득 찼어요 · 화면 내용은 그대로" 안내', /저장 공간/.test(told), `상태 '${status}' · 안내 '${told || '없음'}'`);
  check('E4 저장 못 한 변경이 있으면 창 닫기 전 확인(beforeunload)', guard);
  await page.evaluate(() => { window.__quota = false; });
  const recovered = await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === '저장됨', null, { timeout: 12000 }).then(() => true, () => false);
  await page.reload();
  await page.waitForFunction(() => window.__dn?.view && window.__dn.state.currentId, null, { timeout: 15000 });
  await wait(page, 300);
  const kept = (await noteText(page)).includes('공간부족중편집');
  check('E4 공간이 생기면 저절로 다시 저장 · 새로 고침 후에도 남음', recovered && kept, `다시 저장=${recovered} 남음=${kept}`);
  await ctx.close();
}

// ───── B: 렌더 오류 하나로 흰 화면이 되지 않음 ─────
{
  const ctx = await fresh();
  const page = await ctx.newPage();
  await boot(page);
  await page.evaluate(() => { window.__dn.set({ notes: null }); }).catch(() => {});
  await wait(page, 300);
  const text = (await page.locator('#root').innerText()).trim();
  await page.screenshot({ path: `${OUT}/release-error-boundary.png` });
  check('B 렌더 오류 → 흰 화면 대신 안내 + 다시 열기', /다시 열기/.test(text), text.slice(0, 80) || '(빈 화면)');
  await ctx.close();
}

// ───── D: 보안 컨텍스트 밖(http LAN 주소)에서 API 키 저장 ─────
{
  const ctx = await fresh();
  // http://192.168.x.x 처럼 보안 컨텍스트가 아니면 crypto.subtle이 없다
  await ctx.addInitScript(() => { Object.defineProperty(Crypto.prototype, 'subtle', { get: () => undefined, configurable: true }); });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  await page.route('https://api.anthropic.com/**', (r) => (r.request().method() === 'OPTIONS'
    ? r.fulfill({ status: 204, headers: CORS })
    : r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5' }) })));
  await boot(page);
  check('D crypto.subtle 없이도 앱이 열림', true);
  await page.evaluate(() => window.__dn.openSettings());
  await page.locator('.settings-nav button', { hasText: 'AI' }).click();
  await page.locator('.key-input input').fill('sk-ant-test-key-abcd');
  await page.locator('.key-row .btn').click();
  await wait(page, 1500);
  const msg = await page.locator('.key-msg').allInnerTexts();
  const btn = await page.locator('.key-row .btn').innerText();
  await page.screenshot({ path: `${OUT}/release-insecure-key.png` });
  check('D 보안 컨텍스트 밖: 키 저장 실패 이유(https)를 알리고 버튼이 멈추지 않음', msg.some((t) => /https/i.test(t)) && btn === '확인', `문구=${msg.join('|') || '없음'} 버튼='${btn}'`);
  check('D 처리되지 않은 오류 없음', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ───── H: AI 네트워크 끊김 · 429 ─────
{
  const ctx = await fresh();
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  let mode = 'ok';
  const headers = [];
  await page.route('https://api.anthropic.com/**', (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().includes('/v1/models/')) return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5' }) });
    headers.push(req.headers());
    if (mode === 'offline') return r.abort('internetdisconnected');
    // retry-after는 CORS로 노출돼야 브라우저가 읽는다 — 실제 API가 노출하는지는 키 없이 확인 못 함 (RELEASE-QA QA-009)
    return r.fulfill({ status: 429, headers: { ...CORS, 'access-control-expose-headers': 'retry-after, request-id', 'content-type': 'application/json', 'retry-after': '120' }, body: JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } }) });
  });
  await boot(page);
  await page.evaluate(async () => { await window.__dn.acceptConsent(); await window.__dn.saveKey('sk-ant-test-key-abcd'); window.__dn.closeDialog(); });
  const SRC = '금리 인상은 대출 감소로 이어지고, 대출 감소는 소비 위축을 낳습니다. 그래서 경기 둔화가 옵니다.';
  await page.evaluate((t) => {
    const dt = new DataTransfer(); dt.setData('text/plain', t);
    const root = window.__dn.view.root; root.focus();
    root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, SRC);
  await wait(page, 200);
  const blockId = await page.evaluate(() => window.__dn.state.chip);
  const count = () => page.evaluate(() => window.__dn.view.engine.blockCount);
  const before = await count();
  mode = 'rate';
  await page.evaluate((id) => window.__dn.structure(id), blockId);
  const t429 = await page.locator('.toast').innerText().catch(() => '');
  check('H 429: "잠시 쉬어야 해요 · 2분 뒤" 안내 · 원문 그대로', /2분/.test(t429) && (await count()) === before, t429);
  mode = 'offline';
  await page.evaluate((id) => window.__dn.structure(id), blockId);
  const tNet = await page.locator('.toast').innerText().catch(() => '');
  check('H 네트워크 끊김: 재시도 후 연결 안내 · 원문 그대로', /연결/.test(tNet) && (await count()) === before, tNet);
  check('H 직접 호출 헤더(anthropic-dangerous-direct-browser-access)가 붙음', headers.length > 0 && headers.every((h) => h['anthropic-dangerous-direct-browser-access'] === 'true'), `${headers.length}건`);
  check('H 처리되지 않은 오류 없음', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ───── C: _headers의 Permissions-Policy — 배포에서도 음성 녹음(FR-043)이 마이크를 쓸 수 있는지. 개발 서버는 _headers를 안 걸어 헤더를 직접 건다 ─────
const headersFile = readFileSync(new URL('../apps/web/public/_headers', import.meta.url), 'utf8');
{
  const pp = headersFile.match(/Permissions-Policy:\s*(.+)/)?.[1]?.trim() ?? '';
  // feature=(허용 목록) — 빈 목록 ()은 최상위 문서까지 막는다
  const policy = Object.fromEntries(pp.split(',').map((s) => s.trim().match(/^([\w-]+)=\((.*)\)$/)).filter(Boolean)
    .map(([, k, v]) => [k, v.split(/\s+/).filter(Boolean)]));
  check('C _headers Permissions-Policy: microphone이 self를 허용', ['self', '*'].some((t) => policy.microphone?.includes(t)), pp);
  const ctx = await fresh();
  await ctx.grantPermissions(['microphone'], { origin: new URL(BASE).origin });
  const page = await ctx.newPage();
  await page.route(`${BASE}/`, async (r) => {
    const res = await r.fetch();
    r.fulfill({ response: res, headers: { ...res.headers(), 'permissions-policy': pp } });
  });
  await boot(page);
  const allowed = await page.evaluate(() => document.featurePolicy?.allowsFeature('microphone') ?? null);
  await page.evaluate(() => window.__dn.startRecording());
  const started = await page.waitForFunction(() => !!window.__dn.state.recording, null, { timeout: 5000 }).then(() => true, () => false);
  const toast = started ? '' : await page.locator('.toast').innerText().catch(() => '');
  if (started) await page.evaluate(() => window.__dn.cancelRecording());
  check('C Permissions-Policy를 건 상태에서 음성 녹음이 시작됨', allowed !== false && started, `allowsFeature=${allowed}${toast ? ` · ${toast}` : ''}`);
  await ctx.close();
}

// ───── C · F: 프로덕션 빌드에서만 (sw.js가 있을 때) ─────
const swRes = await fetch(`${BASE}/sw.js`).catch(() => null);
const isProd = !!swRes && swRes.ok && /javascript/.test(swRes.headers.get('content-type') ?? '');
if (isProd) {
  // C: _headers의 CSP를 실제로 걸고 앱이 깨지지 않는지
  const csp = headersFile.match(/Content-Security-Policy:\s*(.+)/)?.[1]?.trim();
  {
    const ctx = await fresh();
    const page = await ctx.newPage();
    const violations = [];
    page.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) violations.push(m.text()); });
    await page.route(`${BASE}/`, async (r) => {
      const res = await r.fetch();
      r.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': csp } });
    });
    await page.goto(BASE); // waitForFunction은 CSP(eval 금지)에 막혀 요소로 기다린다
    await page.waitForSelector('.dn-block', { timeout: 15000 });
    await wait(page, 300);
    await typeBlock(page, 'CSP확인');
    await page.evaluate(() => window.__dn.openSettings());
    await wait(page, 200);
    check('C _headers의 CSP를 건 상태에서 앱이 열리고 편집됨 · 위반 0건', !!csp && violations.length === 0, violations.slice(0, 2).join(' | ') || csp?.slice(0, 60));
    await ctx.close();
  }
  // F: 오프라인 새로 고침
  {
    const ctx = await fresh();
    const page = await ctx.newPage();
    const errors = [];
    watch(page, errors);
    await boot(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await typeBlock(page, '오프라인확인');
    await wait(page, 1500);
    await page.reload(); // SW가 페이지를 맡게
    await page.waitForSelector('.dn-block', { timeout: 15000 });
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    await page.reload();
    const ok = await page.waitForSelector('.dn-block', { timeout: 15000 }).then(() => true, () => false);
    const kept = ok && (await noteText(page)).includes('오프라인확인');
    // 글씨체는 미리 받지 않고 쓸 때 받아 두는 캐시(dn-fonts-v1)라, 한 번 본 글자는 오프라인에서도 같은 글씨체여야 한다
    const font = ok && await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Pretendard Variable' && f.status === 'loaded');
    });
    await page.screenshot({ path: `${OUT}/release-offline.png` });
    check('F 서비스 워커가 페이지를 맡음', controlled);
    check('F 오프라인에서 새로 고침해도 앱이 열리고 노트가 남아 있음', ok && kept, `열림=${ok} 노트=${kept}`);
    check('F 오프라인에서도 글씨체(Pretendard) 유지', font === true);
    await ctx.setOffline(false);
    const manifest = await page.evaluate(async () => {
      const href = document.querySelector('link[rel=manifest]')?.getAttribute('href');
      if (!href) return null;
      const m = await (await fetch(href)).json();
      const icons = await Promise.all(m.icons.map(async (i) => (await fetch(i.src)).ok));
      return { name: m.name, display: m.display, start: m.start_url, icons: m.icons.map((i) => i.sizes), iconsOk: icons.every(Boolean) };
    });
    check('F 매니페스트: 이름 · standalone · 192/512 아이콘', !!manifest && manifest.display === 'standalone' && manifest.iconsOk
      && ['192x192', '512x512'].every((s) => manifest.icons.includes(s)), JSON.stringify(manifest));
    check('F 콘솔 오류 없음', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // F: 새 버전 SW가 대기하면 "새 버전이 준비됐어요 — 다시 열기"
  // 서비스 워커 스크립트의 업데이트 확인은 page.route로 가로챌 수 없어, 빌드 폴더를 직접 내주는 작은 서버(5192)에서 sw.js를 바꿔 "배포"한다
  {
    const DIST = fileURLToPath(new URL('../apps/web/dist-e2e/', import.meta.url));
    let swSuffix = '';
    const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    const server = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = join(DIST, path === '/' || !extname(path) ? 'index.html' : path);
      try {
        let body = readFileSync(file);
        if (path === '/sw.js') body = Buffer.concat([body, Buffer.from(swSuffix)]);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
        res.end(body);
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise((r) => server.listen(5192, r));
    const URL2 = 'http://localhost:5192';
    const ctx = await fresh();
    const page = await ctx.newPage();
    await page.goto(URL2);
    await page.waitForFunction(() => window.__dn?.view && window.__dn.state.currentId, null, { timeout: 15000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller && window.__dn?.view, null, { timeout: 15000 });
    await typeBlock(page, '업데이트전편집');
    swSuffix = "// new deploy";
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r?.update(); });
    const shown = await page.waitForSelector('.reload-banner', { timeout: 10000 }).then(() => true, () => false);
    const text = shown ? await page.locator('.reload-banner').innerText() : '';
    await page.screenshot({ path: `${OUT}/release-sw-update.png` });
    check('F 새 버전 배포 → "새 버전이 준비됐어요 · 다시 열기" 배너 (강제 새로 고침 없음)', /새 버전/.test(text) && /다시 열기/.test(text), text || '배너 없음');
    if (shown) {
      await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.locator('.reload-banner button', { hasText: '다시 열기' }).click()]);
      await page.waitForFunction(() => window.__dn?.view && window.__dn.state.currentId, null, { timeout: 15000 });
      await wait(page, 500);
      const gone = await page.locator('.reload-banner').count();
      const kept = (await noteText(page)).includes('업데이트전편집');
      check('F 다시 열기 → 새 버전으로 열리고 배너 사라짐 · 편집 유지', gone === 0 && kept, `배너=${gone} 편집=${kept}`);
    }
    await ctx.close();
    server.close();
  }
} else {
  console.log('SKIP  C · F (sw.js 없음 — 개발 서버)');
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
