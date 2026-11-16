// 탭 동기화 확인 (FR-095 · 096 · 097, 같은 기기): 같은 노트를 두 탭에서 열면 두 번째 탭도 함께 고칠 수 있고(저장은 첫 탭),
// 블록 옮기기 · 글 고치기가 서로 바로 반영 · 두 탭이 같은 문단을 고쳐도 합쳐짐 · 두 번째 탭의 편집도 저장됨 ·
// 첫 탭을 닫으면 두 번째 탭이 저장하는 탭이 된다. 사용: dev 서버 실행 후 `node e2e/tabs.mjs`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const errors = [];
async function tab() {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE);
  await p.waitForSelector('.dn-block', { timeout: 15000 });
  await p.waitForTimeout(600);
  return { p, ws: (fn, arg) => p.evaluate(fn, arg) };
}
const until = async (t, fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await t.ws(fn)) return true; await t.p.waitForTimeout(100); } return false; };

const A = await tab();
const B = await tab();
await B.p.waitForTimeout(800);
const roles = { a: await A.ws(() => window.__dn.state.tabRole), b: await B.ws(() => window.__dn.state.tabRole) };
check('첫 탭 = 저장하는 탭, 둘째 탭 = 함께 편집', roles.a === 'writer' && roles.b === 'guest', JSON.stringify(roles));
check('둘째 탭도 고칠 수 있음 · 표시', (await B.ws(() => window.__dn.view.readOnly)) === false && (await B.p.locator('.tab-sync').innerText()).includes('함께 편집'));
check('첫 탭에 동기화 표시', (await A.p.locator('.tab-sync').innerText()).includes('탭 1개'));

// 저장하는 탭이 노트 이름 · 페이지 옵션을 바꿔도 둘째 탭은 계속 함께 편집, 편집 잠금은 두 탭 모두 따른다
await A.ws(() => window.__dn.renameNote?.(window.__dn.state.currentId, '탭 시험 노트') ?? window.__dn.view.engine.transact((tx) => tx.setNote({ title: '탭 시험 노트' }), { origin: 'user' }));
await A.ws(() => window.__dn.setNotePage({ smallText: true }));
await B.p.waitForTimeout(500);
check('저장 탭이 이름 · 옵션을 바꿔도 둘째 탭은 계속 고칠 수 있음', (await B.ws(() => window.__dn.view.readOnly)) === false);
await A.ws(() => window.__dn.setNotePage({ smallText: false, editLock: true }));
check('편집 잠금은 둘째 탭도 보기 전용', await until(B, 'window.__dn.view.readOnly === true'));
await B.ws(() => window.__dn.setNotePage({ editLock: false }));
check('둘째 탭에서 잠금 풀기 → 두 탭 모두 다시 편집', await until(A, 'window.__dn.view.readOnly === false') && (await until(B, 'window.__dn.view.readOnly === false')));

// 함께 편집 탭: 아이콘 · 제목 · 커버 고치기도 열림, 이미지 붙여넣기도 저장 탭에 보임
check('둘째 탭: 아이콘 · 제목 고치기 켜짐', (await B.p.locator('.doc-icon').isEnabled()) && (await B.p.locator('.title-input').isEnabled()));
await B.ws(async () => {
  const c = document.createElement('canvas'); c.width = 30; c.height = 20; c.getContext('2d').fillRect(0, 0, 30, 20);
  const f = new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'b.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(f);
  const root = window.__dn.view.root; root.focus(); window.__dn.view.select([]);
  root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
check('둘째 탭에서 붙인 이미지가 저장 탭에도', await until(A, "[...window.__dn.view.engine.blocks()].some((b) => window.__dn.view.engine.contentsOf(b.id)[0]?.type === 'image')", 5000));
await A.ws(() => { const e = window.__dn.view.engine; const b = [...e.blocks()].find((x) => e.contentsOf(x.id)[0]?.type === 'image'); window.__dn.view.select([b.id]); window.__dn.view.deleteSelection(); });
await B.p.waitForTimeout(400);

const first = await A.ws(() => [...window.__dn.view.engine.blocks()][1].id);
// B에서 옮기기 → A
await B.ws((id) => { const v = window.__dn.view; const b = v.engine.getBlock(id); v.engine.transact((tx) => tx.set('block', id, { x: b.x + 120 }), { origin: 'user', label: '옮기기' }); }, first);
const bx = await B.ws((id) => window.__dn.view.engine.getBlock(id).x, first);
check('둘째 탭에서 옮기면 첫 탭에 바로', await until(A, `window.__dn.view.engine.getBlock('${first}').x === ${bx}`));
// A에서 글 고치기 → B (에디터로)
await A.ws((id) => window.__dn.view.startEditing(id, 'end'), first);
await A.p.keyboard.type(' 첫탭추가');
await A.p.keyboard.press('Escape');
check('첫 탭에서 쓴 글이 둘째 탭에', await until(B, `JSON.stringify([...window.__dn.view.engine.contents()]).includes('첫탭추가')`));
// 같은 문단 동시 편집: 두 탭이 거의 동시에 끝에 다른 글자
const second = await A.ws(() => [...window.__dn.view.engine.blocks()][2].id);
await Promise.all([
  A.ws((id) => { window.__dn.view.startEditing(id, 'end'); }, second),
  B.ws((id) => { window.__dn.view.startEditing(id, 'start'); }, second),
]);
await A.p.keyboard.type('[A끝]');
await B.p.keyboard.type('[B앞]');
await A.p.keyboard.press('Escape');
await B.p.keyboard.press('Escape');
const merged = `(() => { const s = JSON.stringify([...window.__dn.view.engine.contents()]); return s.includes('[A끝]') && s.includes('[B앞]'); })()`;
check('같은 문단을 두 탭이 고쳐도 둘 다 남음 (글자 단위 병합)', (await until(A, merged)) && (await until(B, merged)));

// 둘째 탭 편집도 저장되는가: 첫 탭이 저장 → 새로 고침으로 확인
await B.ws((id) => window.__dn.view.startEditing(id, 'end'), first);
await B.p.keyboard.type(' 둘째탭저장');
await B.p.keyboard.press('Escape');
await until(A, `JSON.stringify([...window.__dn.view.engine.contents()]).includes('둘째탭저장')`);
await A.p.waitForTimeout(1500);
const C = await tab(); // 세 번째 탭 — 저장된 내용 + 실시간 상태를 받는다
check('둘째 탭 편집이 저장 · 새 탭에도', await until(C, `JSON.stringify([...window.__dn.view.engine.contents()]).includes('둘째탭저장')`));
await C.p.close();

// 첫 탭을 닫으면 둘째 탭이 저장하는 탭으로
await A.p.close();
check('첫 탭을 닫으면 둘째 탭이 저장하는 탭', await until(B, `window.__dn.state.tabRole === 'writer' || (window.__dn.state.tabRole === null && !window.__dn.view.readOnly && window.__dn.state.status !== 'readonly')`, 6000),
  JSON.stringify(await B.ws(() => ({ role: window.__dn.state.tabRole, status: window.__dn.state.status }))));
await B.ws((id) => window.__dn.view.startEditing(id, 'end'), first);
await B.p.keyboard.type(' 이제저장');
await B.p.keyboard.press('Escape');
await B.p.waitForTimeout(1500);
await B.p.reload();
await B.p.waitForSelector('.dn-block', { timeout: 15000 });
check('둘째 탭이 직접 저장', (await B.ws(() => JSON.stringify([...window.__dn.view.engine.contents()]))).includes('이제저장'));

check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
