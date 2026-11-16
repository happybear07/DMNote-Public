// 알림 (FR-136): 날짜 멘션을 눌러 알림 시각 · 반복 → 시각이 되면 앱 안 알림(+ 탭이 안 보이면 기기 알림) → '열기'로 그 블록,
// 같은 알림은 한 번만(다시 열어도), 매일 반복은 다음 날 또, 체크한 할 일은 안 울림, 앱이 닫혀 있던 동안 지난 것은 "놓친 알림", 홈에 다가오는 알림.
// 기기 알림(Notification)은 가짜로 바꿔 기록만 한다. 사용: dev 서버 실행 후 `node e2e/reminders.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
process.on('unhandledRejection', (e) => { if (!/TargetClosedError|has been closed/.test(String(e))) throw e; });

const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem('dn:no-env-key', '1');
  window.__notified = [];
  class FakeNotification {
    constructor(title, o = {}) { window.__notified.push({ title, ...o }); this.onclick = null; }
    close() {}
    static permission = 'granted';
    static requestPermission() { return Promise.resolve('granted'); }
  }
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
await ws(() => window.__dn.setTitle('약속'));
const noteId = await ws(() => window.__dn.state.currentId);
const T = await ws(() => {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const n = new Date(); const t = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return { today: iso(t), twoAgo: iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 2)), tomorrow: iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) };
});
const reminders = () => ws((id) => window.__dn.state.notes.find((n) => n.id === id)?.reminders ?? [], noteId);
const toast = () => page.locator('.toast').innerText().catch(() => '');
const stayed = [];
/** 편집 중인 상자의 i번째 날짜에 알림 시각 · 반복 */
async function setReminder(i, time, repeat) {
  await page.locator('.dn-text-editing .dn-date').nth(i).click();
  await page.waitForSelector('.dn-date-pop');
  // 실제처럼 칸에 포커스를 둔 채 바꾼다 — 바꾼 뒤에도 편집 · 창 · 포커스가 그대로여야 한다
  await page.evaluate(({ time }) => { const t = document.querySelector('.dn-date-pop .dn-date-time'); t.focus(); t.value = time; t.dispatchEvent(new Event('change', { bubbles: true })); }, { time });
  await page.waitForTimeout(80);
  stayed.push(await page.evaluate(() => !!window.__dn.view.editingId && !!document.querySelector('.dn-date-pop') && document.activeElement?.classList.contains('dn-date-time')));
  if (repeat) await page.evaluate((v) => { const s = document.querySelector('.dn-date-pop .dn-date-repeat'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, repeat);
}

// 지금보다 2분 전 시각 (자정 직후면 00:00)
const past = await ws(() => { const d = new Date(Date.now() - 120_000); const t = new Date(); return d.getDate() === t.getDate() ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '00:00'; });
await ws(() => window.__dn.view.addBlockAtCenter('text'));
await page.waitForTimeout(150);
await page.keyboard.type('치과 예약 @오늘');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
await setReminder(0, past);
check('날짜를 눌러 알림 시각 → 종 표시', (await page.locator('.dn-text-editing .dn-date-remind').count()) === 1);
check('알림 시각을 바꿔도 편집 · 창 · 포커스 유지', stayed.every(Boolean) && stayed.length === 1, JSON.stringify(stayed));
await page.screenshot({ path: `${OUT}/reminder-pop.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
const rs = await reminders();
check('목록 정보에 알림 (노트를 열지 않고도 띄울 수 있게)', rs.length === 1 && rs[0].time === past && rs[0].date === T.today && rs[0].text === '치과 예약', JSON.stringify(rs));

// 울리기 → 열기
const fired = await ws(() => window.__dn.checkReminders().then((d) => d.length));
check('시각이 지나면 앱 안 알림 · 보이는 탭이라 기기 알림은 없음', fired === 1 && (await toast()).includes('치과 예약') && (await ws(() => window.__notified.length)) === 0, await toast());
check('같은 알림은 한 번만', (await ws(() => window.__dn.checkReminders().then((d) => d.length))) === 0);
await ws(() => window.__dn.newNote());
await page.waitForTimeout(400);
await ws(() => window.__dn.checkReminders(Date.now()));
await ws(async (id) => {
  // 탭이 안 보일 때 · 반복 알림: 다음 날 같은 시각 + 1분 (기기 알림도)
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
}, null);
// 알림을 '열기'로 — 앞의 토스트는 사라졌을 수 있어 매일 반복으로 바꿔 다시 울린다
await ws((id) => window.__dn.openById(id), noteId);
await page.waitForTimeout(500);
const bid = await ws(() => [...window.__dn.view.engine.blocks()].find((b) => JSON.stringify(window.__dn.view.engine.contentsOf(b.id)).includes('date_mention')).id);
await ws((id) => window.__dn.view.startEditing(id, 'end'), bid);
await setReminder(0, past, 'daily');
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
await ws(() => window.__dn.newNote());
await page.waitForTimeout(400);
const tomorrowLater = await ws(() => Date.now() + 86_400_000 + 60_000);
const firedDaily = await ws((t) => window.__dn.checkReminders(t).then((d) => d.length), tomorrowLater);
check('매일 반복: 다음 날 같은 시각에 또 · 탭이 안 보이면 기기 알림', firedDaily === 1 && (await ws(() => window.__notified.length)) >= 1, JSON.stringify(await ws(() => window.__notified)));
await page.locator('.toast button', { hasText: '열기' }).click();
await page.waitForTimeout(700);
check("'열기' → 그 노트의 그 블록으로", (await ws(() => window.__dn.state.currentId)) === noteId && (await ws((b) => window.__dn.view.selectedBlocks.includes(b), bid)));
await ws(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); });

// 체크한 할 일 · 놓친 알림 · 다가오는 알림
await ws((d) => {
  const e = window.__dn.view.engine;
  const m = (date, time) => ({ type: 'date_mention', attrs: { date, time, repeat: '' } });
  e.transact((tx) => {
    const b = tx.createBlock({ x: 0, y: 400, w: 320, h: 120 });
    tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [
      { type: 'task_list', content: [{ type: 'task_item', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '끝난 일 ' }, m(d.today, '00:00')] }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: '지난 회의 ' }, m(d.twoAgo, '09:00')] },
      { type: 'paragraph', content: [{ type: 'text', text: '내일 발표 ' }, m(d.tomorrow, '09:00')] },
    ] } });
  }, { origin: 'user' });
}, T);
await page.waitForTimeout(900);
const late = await ws(() => window.__dn.checkReminders().then((d) => d.map((x) => x.r.text)));
check('체크한 할 일은 안 울림 · 앱이 닫혀 있던 동안 지난 것은 "놓친 알림"', late.length === 1 && late[0].includes('지난 회의') && (await toast()).includes('놓친 알림'), JSON.stringify(late) + ' ' + await toast());
await ws(() => window.__dn.showMe()); // 다가오는 알림은 내 페이지 (11/10 — 홈은 서재)
await page.waitForTimeout(300);
const home = await page.locator('section[aria-label="다가오는 알림"]').innerText().catch(() => '');
check('홈: 다가오는 알림에 내일 발표', home.includes('내일 발표') && home.includes('내일 09:00'), home.slice(0, 160));
await page.screenshot({ path: `${OUT}/reminder-home.png` });

// 데이터베이스 날짜 속성 알림: 속성 메뉴에서 시각 → 날짜가 있는 항목마다
await ws((id) => window.__dn.openById(id), noteId);
await page.waitForTimeout(500);
await ws(() => { window.__dn.view.select([]); window.__dn.view.setCamera({ x: 3000, y: 3000, zoom: 1 }); });
await page.waitForTimeout(200);
await page.locator('.toolbar .insert-btn').click();
await page.waitForSelector('.insert-menu');
await page.keyboard.type('데이터베이스');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const dbIds = await ws((today) => {
  const e = window.__dn.view.engine;
  const c = [...e.contents()].filter((x) => x.type === 'database').pop();
  const [name, , date] = c.properties;
  const row = [...c.rows].sort((a, b) => (a.order < b.order ? -1 : 1))[0];
  e.transact((tx) => tx.set('content', c.id, { rows: c.rows.map((r) => (r.id === row.id ? { ...r, values: { ...r.values, [name.id]: '분기 보고', [date.id]: today } } : r)) }), { origin: 'user' });
  return { cid: c.id, date: date.id };
}, T.today);
await page.locator('.dn-db-prop', { hasText: '날짜' }).last().click();
await page.waitForSelector('.dn-db-pop input[type=time]');
await page.evaluate(() => { const t = document.querySelector('.dn-db-pop input[type=time]'); t.value = '00:01'; t.dispatchEvent(new Event('change', { bubbles: true })); });
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
const propRemind = await ws((ids) => window.__dn.view.engine.getContent(ids.cid).properties.find((p) => p.id === ids.date).remind, dbIds);
const dbFired = await ws(() => window.__dn.checkReminders().then((d) => d.map((x) => x.r.text)));
check('데이터베이스 날짜 속성 알림: 속성 메뉴에서 시각 → 날짜가 있는 항목마다 (항목 이름)', propRemind === '00:01' && dbFired.includes('분기 보고'), JSON.stringify({ propRemind, dbFired }));

// 다시 열어도 같은 알림은 다시 울리지 않는다
await page.reload();
await page.waitForSelector('.canvas-host', { timeout: 15000 });
await page.waitForTimeout(1200);
check('새로 고침 뒤에도 보낸 기록 유지', (await ws(() => window.__dn.checkReminders().then((d) => d.length))) === 0);

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
