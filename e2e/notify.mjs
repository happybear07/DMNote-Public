// 알림 설정 · 방해 금지 (FR-138): 설정 › 알림 — 권한 안내 · 시험 알림, 방해 금지 시간에는 울리지 않고 끝나면 놓친 알림, 앱 안 알림 끄기.
// 기기 알림(Notification)은 가짜로 바꿔 기록만 한다. 사용: dev 서버 실행 후 `node e2e/notify.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem('dn:no-env-key', '1');
  window.__notified = [];
  class FakeNotification { constructor(title, o = {}) { window.__notified.push({ title, ...o }); } close() {} static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } }
  window.Notification = FakeNotification;
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote());
await page.waitForTimeout(300);
const hhmm = (ms) => ws((ms) => { const d = new Date(Date.now() + ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }, ms);
const today = await ws(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
const addReminder = (text, time) => ws(({ text, time, today }) => window.__dn.view.engine.transact((tx) => {
  const b = tx.createBlock({ x: 0, y: Math.random() * 1000, w: 300, h: 60 });
  tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${text} ` }, { type: 'date_mention', attrs: { date: today, time, repeat: '' } }] }] } });
}, { origin: 'user' }), { text, time, today });
const toast = () => page.locator('.toast').innerText().catch(() => '');

// 설정 › 알림: 권한 안내 · 시험 알림
await ws(() => window.__dn.openSettings());
await page.locator('.settings-nav button', { hasText: '알림' }).click();
await page.waitForSelector('.settings [role=status]');
check('설정 › 알림: 기기 알림 권한 상태', (await page.locator('.settings [role=status]').innerText()).includes('허용됨'));
await page.locator('.settings button', { hasText: '시험 알림' }).click();
await page.waitForTimeout(200);
check('시험 알림 → 앱 안 알림 · 기기 알림', (await toast()).includes('시험 알림이에요') && (await ws(() => window.__notified.length)) === 1);
await ws(() => window.__dn.closeDialog());

// 방해 금지: 지금을 덮는 시간대 → 울리지 않고 기다림 → 끄면 그때 (놓친 알림이 아니라 2분 지난 알림)
await addReminder('약 먹기', await hhmm(-120_000));
await page.waitForTimeout(900);
await ws(async ({ from, to }) => window.__dn.setRemindPrefs({ inApp: true, device: true, quiet: { from, to } }), { from: await hhmm(-3_600_000), to: await hhmm(3_600_000) });
check('방해 금지 시간에는 울리지 않음', (await ws(() => window.__dn.checkReminders().then((d) => d.length))) === 0);
await ws(() => window.__dn.setRemindPrefs({ inApp: true, device: true }));
const fired = await ws(() => window.__dn.checkReminders().then((d) => d.map((x) => x.r.text)));
check('방해 금지가 끝나면 기다리던 알림이 울림', JSON.stringify(fired) === '["약 먹기"]' && (await toast()).includes('약 먹기'), JSON.stringify(fired));

// 앱 안 알림 끄기
await ws(() => window.__dn.setRemindPrefs({ inApp: false, device: true }));
await page.mouse.click(700, 500);
await page.waitForTimeout(100);
await addReminder('물 마시기', await hhmm(-60_000));
await page.waitForTimeout(900);
const before = await toast();
const n2 = await ws(() => window.__dn.checkReminders().then((d) => d.length));
check('앱 안 알림을 끄면 안내 없이 (알림은 보낸 것으로)', n2 === 1 && !(await toast()).includes('물 마시기'), `${before} / ${await toast()}`);
await ws(() => window.__dn.setRemindPrefs({ inApp: true, device: true }));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
