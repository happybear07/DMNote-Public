// 음성 녹음 블록 (FR-043): 넣기 메뉴 · 슬래시 · 명령으로 녹음 → 일시정지/계속 → 다른 노트로 옮겨도 이어짐 → 끝내면 시작한 노트에 녹음 블록(재생기 · 배속 · 길이).
// 버리기 · 마이크 권한 거절 안내 · 영상 파일은 영상 재생기. 브라우저의 가짜 마이크(--use-fake-device-for-media-stream)로 실제 MediaRecorder를 돌린다.
// 사용: dev 서버 실행 후 `node e2e/record.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({
  channel: process.env.DN_CHANNEL ?? 'msedge', headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['microphone'], { origin: new URL(BASE).origin });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await page.waitForTimeout(400);
await ws(() => window.__dn.setTitle('녹음 시험'));
await page.waitForTimeout(300);
const noteA = await ws(() => window.__dn.state.currentId);
const files = () => ws(() => [...window.__dn.view.engine.contents()].filter((c) => c.type === 'file').map((c) => ({ id: c.id, blockId: c.blockId, name: c.name, mime: c.mime, size: c.size, duration: c.duration })));
const toastText = () => page.locator('.toast').innerText().catch(() => '');
const insert = async (q) => {
  await page.locator('.toolbar .insert-btn').click();
  await page.waitForSelector('.insert-menu');
  await page.keyboard.type(q);
  await page.keyboard.press('Enter');
};

// ── 넣기 메뉴 → 녹음 ──
await insert('녹음');
await page.waitForSelector('.record-bar', { timeout: 5000 });
check('넣기 메뉴 "음성 녹음" → 녹음 중 표시', (await page.locator('.record-bar').innerText()).includes('녹음 중'));
await page.waitForTimeout(2300);
const t1 = await page.locator('.rec-time').innerText();
check('경과 시간이 흐른다', t1 === '0:02' || t1 === '0:03', t1);
await page.locator('.record-bar button', { hasText: '일시정지' }).click();
await page.waitForTimeout(1600);
const p1 = await page.locator('.rec-time').innerText();
await page.waitForTimeout(1100);
const p2 = await page.locator('.rec-time').innerText();
check('일시정지 → 시간이 멈춤 · 표시', p1 === p2 && (await page.locator('.record-bar').innerText()).includes('일시정지'), `${p1} → ${p2}`);
await page.screenshot({ path: `${OUT}/record-bar.png` });
await page.locator('.record-bar button', { hasText: '계속' }).click();
// 다른 노트로 옮겨도 녹음은 이어진다
await ws(() => window.__dn.newNote());
await page.waitForTimeout(1200);
check('다른 노트로 옮겨도 녹음 중 · 붙일 노트 이름 표시', (await page.locator('.record-bar').innerText()).includes('녹음 시험에 붙여요'));
await page.locator('.record-bar button', { hasText: '끝내기' }).click();
await page.waitForFunction(() => !window.__dn.state.recording, null, { timeout: 5000 });
await page.waitForTimeout(800);
const back = await ws(() => window.__dn.state.currentId);
const f1 = await files();
check('끝내기 → 시작한 노트로 돌아가 녹음 블록', back === noteA && f1.length === 1 && f1[0].mime.startsWith('audio/') && /^녹음 \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.(webm|ogg|m4a)$/.test(f1[0].name), JSON.stringify(f1));
check('녹음 길이(일시정지 뺀 시간) · 크기', f1[0] && f1[0].duration >= 2.5 && f1[0].duration < 6 && f1[0].size > 1000, JSON.stringify(f1[0]));
check('안내: 시작한 노트에 녹음을 붙였어요', (await toastText()).includes('녹음을 시작한 노트에'), await toastText());
// 재생기
await page.waitForSelector('.dn-media-audio audio', { timeout: 5000 });
const dur = await page.evaluate(async () => {
  const a = document.querySelector('.dn-media-audio audio');
  for (let i = 0; i < 40 && !(a.src && Number.isFinite(a.duration) && a.duration > 0); i++) await new Promise((r) => setTimeout(r, 100));
  return { src: !!a.src, duration: a.duration };
});
check('녹음 블록 = 재생기 · 탐색 가능한 길이', dur.src && Number.isFinite(dur.duration) && dur.duration > 1, JSON.stringify(dur));
await page.locator('.dn-media-rate').click();
check('배속 버튼 1× → 1.25×', (await page.locator('.dn-media-rate').innerText()) === '1.25×' && (await page.evaluate(() => document.querySelector('.dn-media-audio audio').playbackRate)) === 1.25);
await page.screenshot({ path: `${OUT}/record-block.png` });
await ws(() => window.__dn.view.root.focus());
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
check('녹음 블록도 실행 취소 한 번에', (await files()).length === 0);
await page.keyboard.press('Control+Shift+z');

// ── 버리기 (Ctrl+Alt+R로 시작) ──
await page.keyboard.press('Control+Alt+KeyR');
await page.waitForSelector('.record-bar');
await page.waitForTimeout(1200);
await page.locator('.record-bar button', { hasText: '버리기' }).click();
await page.waitForFunction(() => !window.__dn.state.recording, null, { timeout: 5000 });
await page.waitForTimeout(300);
check('버리기 → 블록 없음 · 안내', (await files()).length === 1 && (await toastText()).includes('녹음을 버렸어요'));

// ── 앱을 벗어나도(탭이 뒤로) 녹음은 이어지고, 기기가 마이크를 끊으면 거기까지 저장 ──
await page.keyboard.press('Control+Alt+KeyR');
await page.waitForSelector('.record-bar');
await page.waitForTimeout(1100);
await ws(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(1500);
await ws(() => { delete document.visibilityState; delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(600);
const bar = await page.locator('.record-bar').innerText();
check('앱을 벗어났다 돌아와도 녹음 중 · 시간이 이어짐', bar.includes('녹음 중') && /0:0[3-9]/.test(bar), bar.replace(/\n/g, ' '));
await ws(() => window.__dn.rec.stream.getAudioTracks()[0].dispatchEvent(new Event('ended')));
await page.waitForFunction(() => !window.__dn.state.recording, null, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(800);
check('마이크가 끊기면 거기까지 녹음 블록으로 · 안내', (await files()).length === 2 && (await toastText()).includes('마이크가 끊겨'), await toastText());
await ws(() => window.__dn.view.engine.undo());
await page.waitForTimeout(200);

// ── 슬래시 /녹음 → 편집하던 블록 아래 ──
// 글 상자 하나를 만들어 그 안에서 /녹음
await ws(() => { window.__dn.view.select([]); window.__dn.view.addBlockAtCenter('text'); });
await page.waitForTimeout(200);
const src = await ws(() => window.__dn.view.selectedBlocks[0]);
await page.keyboard.type('강의 메모');
await page.keyboard.press('Enter');
await page.keyboard.type('/녹음');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForSelector('.record-bar', { timeout: 5000 });
await page.waitForTimeout(1300);
await ws(() => window.__dn.stopRecording());
await page.waitForTimeout(800);
const placed = await ws((id) => {
  const e = window.__dn.view.engine, s = e.getBlock(id);
  const recs = [...e.contents()].filter((c) => c.type === 'file');
  const nb = e.getBlock(recs[recs.length - 1].blockId);
  return { below: nb.y >= s.y + s.h - 1, n: recs.length };
}, src);
check('슬래시 "음성 녹음" → 편집하던 블록 아래에 녹음 블록', placed.n === 2 && placed.below, JSON.stringify(placed));

// ── 영상 파일 → 영상 재생기 ──
const webm = Buffer.from(await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 48;
  const g = c.getContext('2d');
  const mr = new MediaRecorder(c.captureStream(10), { mimeType: 'video/webm' });
  const parts = [];
  mr.ondataavailable = (e) => parts.push(e.data);
  mr.start();
  for (let i = 0; i < 8; i++) { g.fillStyle = `hsl(${i * 40},70%,50%)`; g.fillRect(0, 0, 64, 48); await new Promise((r) => setTimeout(r, 100)); }
  await new Promise((r) => { mr.onstop = r; mr.stop(); });
  return [...new Uint8Array(await new Blob(parts).arrayBuffer())];
}));
const chooser = page.waitForEvent('filechooser');
await ws(() => { window.__dn.view.endEditing(); window.__dn.view.select([]); });
await insert('파일');
await (await chooser).setFiles({ name: '화면.webm', mimeType: 'video/webm', buffer: webm });
await page.waitForSelector('.dn-media-video video', { timeout: 5000 }).catch(() => {});
check('영상 파일 → 영상 재생기 카드', (await page.locator('.dn-media-video video').count()) === 1);

// ── 마이크 거절 ──
const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await ctx2.addInitScript(() => {
  localStorage.setItem('dn:no-env-key', '1');
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
});
const p2b = await ctx2.newPage();
await p2b.goto(BASE);
await p2b.waitForSelector('.dn-block', { timeout: 15000 });
await p2b.evaluate(() => window.__dn.startRecording());
await p2b.waitForTimeout(300);
check('마이크 권한 거절 → 안내 · 녹음 안 함', (await p2b.locator('.toast').innerText().catch(() => '')).includes('마이크를 쓸 수 없어요') && !(await p2b.evaluate(() => window.__dn.state.recording)));
await ctx2.close();

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
