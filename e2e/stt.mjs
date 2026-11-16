// 녹음 받아쓰기 (FR-044 · 046): 처음엔 모델 내려받기 확인 → 녹음 블록 아래 받아쓴 글(문단마다 재생 시각 칩) → 알림 '구조화하기 · 요약하기',
// 두 번째부터 바로, 칩을 누르면 그 시점부터(캔버스 · 문서 뷰), 블록 메뉴 '글로 받아쓰기', Markdown [분:초], 멈추기 · 실패해도 녹음은 그대로.
// 받아쓰기 엔진은 가짜로 바꿔 끼운다 — 진짜 모델(약 250MB)은 받지 않는다. 사용: dev 서버 실행 후 `node e2e/stt.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await wait(300);

// 6초짜리 소리 (wav) → 녹음 블록
const rec = await ws(async () => {
  const rate = 16000, n = rate * 6, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / 6) * 8000), true);
  const ids = await window.__dn.addFiles([new File([buf], '회의 녹음.wav', { type: 'audio/wav' })], { x: 100, y: 100 }, { duration: 6 });
  return ids[0];
});
check('녹음 블록이 생김', !!rec);

// 가짜 엔진: 받은 소리 길이 · 진행률 기록, 구간 둘
await ws(() => {
  window.__sttCalls = [];
  window.__dn.stt.engine = { async transcribe(audio, o) {
    window.__sttCalls.push({ sec: audio.length / 16000, language: o.language });
    o.onProgress?.({ stage: 'download', pct: 0.5, loaded: 5e6, total: 1e7 });
    await new Promise((r) => setTimeout(r, 300));
    o.onProgress?.({ stage: 'transcribe', pct: 1 });
    return [{ start: 0.2, end: 1.4, text: ' 회의를 시작합니다.' }, { start: 4.1, end: 5.5, text: ' 두 번째 안건입니다.' }];
  } };
});
const blocks = () => ws(() => [...window.__dn.view.engine.blocks()].map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h })));
const transcripts = () => ws(() => {
  const e = window.__dn.view.engine;
  return [...e.blocks()].flatMap((b) => e.contentsOf(b.id).filter((c) => c.type === 'text' && JSON.stringify(c.doc).includes('media_time')).map((c) => ({ block: b.id, y: b.y, doc: c.doc })));
});

// 1) 처음: 모델 내려받기 확인
await ws((id) => window.__dn.transcribe(id), rec);
await page.waitForSelector('.stt-bar', { timeout: 5000 });
const ask = await page.locator('.stt-bar').innerText();
check('처음엔 모델 내려받기 확인 (크기 · 녹음은 기기 밖으로 안 나감)', /250MB/.test(ask) && /기기 밖으로 나가지 않아요/.test(ask) && (await transcripts()).length === 0, ask);
await page.screenshot({ path: `${OUT}/stt-1-ask.png` });
await page.locator('.stt-bar button', { hasText: '내려받고 받아쓰기' }).click();
await page.waitForFunction(() => !window.__dn.state.stt, null, { timeout: 8000 });
await wait(300);
const t1 = await transcripts();
const r0 = (await blocks()).find((b) => b.id === rec);
const tb = (await blocks()).find((b) => b.id === t1[0]?.block);
const paras = t1[0]?.doc.content.slice(1) ?? [];
check('받아쓴 글: 녹음 블록 바로 아래 · 제목 · 문단 둘(쉼 2.7초) · 문단 앞 재생 시각 칩', t1.length === 1 && tb.y >= r0.y + r0.h && tb.y - (r0.y + r0.h) <= 20 && paras.length === 2
  && paras[1].content[0].type === 'media_time' && paras[1].content[0].attrs.t === 4 && JSON.stringify(t1[0].doc.content[0]).includes('받아쓴 글 — 회의 녹음'), JSON.stringify({ r0, tb, n: paras.length }));
check('엔진에는 16kHz로 푼 6초 · 한국어로', (await ws(() => window.__sttCalls))[0]?.sec === 6 && (await ws(() => window.__sttCalls))[0]?.language === 'korean', JSON.stringify(await ws(() => window.__sttCalls)));
const toast = await page.locator('.toast').innerText().catch(() => '');
check('알림: 받아썼어요 — 문단 2개 · 구조화하기 · 요약하기 (FR-046)', /문단 2개/.test(toast) && (await page.locator('.toast button', { hasText: '구조화하기' }).count()) === 1 && (await page.locator('.toast .toast-alt', { hasText: '요약하기' }).count()) === 1, toast);
await page.screenshot({ path: `${OUT}/stt-2-done.png` });

// 2) 재생 시각 칩 → 그 시점부터
const chip = page.locator(`.dn-block[data-id="${t1[0].block}"] .dn-media-time`, { hasText: '0:04' });
check('칩 글자는 분:초', (await page.locator(`.dn-block[data-id="${t1[0].block}"] .dn-media-time`).allInnerTexts()).join(',') === '0:00,0:04');
await chip.click();
await wait(600);
const at1 = await ws((id) => document.querySelector(`.dn-block[data-id="${id}"] .dn-media-player`)?.currentTime ?? -1, rec);
check('캔버스: 칩을 누르면 녹음이 그 시점(4초)부터', at1 >= 3.9 && at1 < 5.5, String(at1));
await ws((id) => { const p = document.querySelector(`.dn-block[data-id="${id}"] .dn-media-player`); p?.pause(); if (p) p.currentTime = 0; }, rec);

// 3) 두 번째부터는 묻지 않음
await ws((id) => window.__dn.transcribe(id), rec);
await page.waitForFunction(() => !window.__dn.state.stt, null, { timeout: 8000 });
await wait(300);
check('두 번째부터는 확인 없이 바로', (await transcripts()).length === 2 && (await page.locator('.stt-bar').count()) === 0);

// 4) 블록 메뉴 · Markdown
await ws((id) => window.__dn.view.select([id]), rec);
const rb = await page.locator(`.dn-block[data-id="${rec}"]`).boundingBox();
await page.mouse.click(rb.x + 20, rb.y + 10, { button: 'right' });
await wait(250);
const sub = page.locator('.menu[aria-label="블록 메뉴"] .menu-sub', { hasText: '글로 받아쓰기' });
check('녹음 블록 메뉴에 "글로 받아쓰기 ▸"', (await sub.count()) === 1);
await sub.locator('> button').click();
await wait(200);
const langs = await sub.locator('[role=menuitem]:not([aria-haspopup])').allInnerTexts();
check('언어 고르기: 한국어 · 영어 · 자동 감지', JSON.stringify(langs.map((t) => t.trim())) === JSON.stringify(['한국어', '영어', '자동 감지']), JSON.stringify(langs));
await sub.locator('[role=menuitem]', { hasText: '영어' }).click();
await page.waitForFunction(() => !window.__dn.state.stt && window.__sttCalls.length >= 3, null, { timeout: 8000 });
await ws((id) => window.__dn.transcribe(id), rec); // 언어를 안 주면 마지막에 고른 언어로
await page.waitForFunction(() => !window.__dn.state.stt && window.__sttCalls.length >= 4, null, { timeout: 8000 });
const calls = await ws(() => window.__sttCalls.map((c) => c.language));
check('영어로 받아쓰기 → 다음에도 영어 (마지막 고른 언어를 기억)', calls[2] === 'english' && calls[3] === 'english', JSON.stringify(calls));
const md = await ws(() => window.__dn.currentMarkdown());
check('Markdown 내보내기: [분:초] 문단', /\[0:04\] 두 번째 안건입니다\./.test(md), md.slice(0, 200));

// 5) 문서 뷰에서 칩
await ws(() => window.__dn.setViewMode('doc'));
await wait(600);
const dchip = page.locator('.dn-doc .dn-media-time', { hasText: '0:04' }).first();
await dchip.click();
await wait(600);
const at2 = await ws((id) => [...document.querySelectorAll(`[data-part] .dn-media-player`)].find((p) => p.isConnected && p.closest('.dn-doc'))?.currentTime ?? -1, rec);
check('문서 뷰: 칩을 누르면 그 시점부터', at2 >= 3.9 && at2 < 5.5, String(at2));
await ws(() => window.__dn.setViewMode('canvas'));
await wait(400);

// 6) 멈추기 · 실패 — 녹음은 그대로
const nBefore = (await transcripts()).length;
await ws(() => { window.__dn.stt.engine = { transcribe: (_a, o) => new Promise((_r, rej) => o.signal?.addEventListener('abort', () => rej(new DOMException('취소', 'AbortError')))) }; });
await ws((id) => window.__dn.transcribe(id), rec);
await page.waitForSelector('.stt-bar', { timeout: 5000 });
await page.locator('.stt-bar button', { hasText: '멈추기' }).click();
await wait(300);
check('멈추기 → 막대 사라짐 · 받아쓴 글 안 생김 · 알림', (await page.locator('.stt-bar').count()) === 0 && (await transcripts()).length === nBefore && /멈췄어요/.test(await page.locator('.toast').innerText().catch(() => '')));
await ws(() => { window.__dn.stt.engine = { transcribe: async () => { throw new Error('메모리가 모자라요'); } }; });
await ws((id) => window.__dn.transcribe(id), rec);
await wait(500);
const fail = await page.locator('.toast').innerText().catch(() => '');
check('실패 → 녹음은 그대로라고 알림 · 녹음 블록 남음', /받아쓰지 못했어요 — 녹음은 그대로예요/.test(fail) && !!(await ws((id) => window.__dn.view.engine.getBlock(id), rec)) && (await page.locator('.stt-bar').count()) === 0, fail);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
