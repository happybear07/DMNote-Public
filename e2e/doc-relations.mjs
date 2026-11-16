// 관계를 읽는 방향대로 문서에 (STRUCTURE-GUIDE 4.11 · Figma 구조 프레임의 "문서 뷰 렌더링"): 분류 트리(kind-of)는 상위가 먼저 · 하위는 들여쓰기,
// 들여쓰기가 이미 보이는 "→ 상위" 줄은 빼고, 종류가 있는 제목만 상자(개념)는 소제목처럼 크지 않게, 논증은 주장 먼저(두괄식),
// 인과 사슬은 화살표 차례 그대로 · 번호 없이. 이름 있는 묶음은 소제목, 닫힌 고리는 '↺ n단계로', 조건 갈래는 '▸ 라벨 → 대상',
// 원문의 시점 · 담당 · 기한은 태그 칩(사건은 시점이 머리).
// 사용: dev 서버 실행 후 `node e2e/doc-relations.mjs [스크린샷 폴더]`
import { chromium } from 'playwright-core';

const BASE = process.env.DN_URL ?? 'http://localhost:5173';
const OUT = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.DN_CHANNEL ?? 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dn:no-env-key', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const ws = (fn, arg) => page.evaluate(fn, arg);

await page.goto(BASE);
await page.waitForSelector('.dn-block', { timeout: 15000 });
await ws(() => window.__dn.newNote({ sheet: null }));
await page.waitForFunction(() => window.__dn.view.engine.blockCount === 0);
await ws(() => {
  const e = window.__dn.view.engine;
  e.transact((tx) => {
    const p = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
    const mk = (x, y, title, nodeKind, body) => {
      const b = tx.createBlock({ x, y, w: 200, h: 60, nodeKind });
      if (body) tx.createContent({ blockId: b, type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: title }] }, p(body).content[0]] } });
      else tx.createContent({ blockId: b, type: 'text', role: 'title', doc: p(title) });
      return b;
    };
    const arrow = (from, to, relation) => tx.createArrow({ from: { blockId: from, side: 'auto' }, to: { blockId: to, side: 'auto' }, relation });
    // 분류 트리: 하위가 위쪽에 놓여 있어도 상위가 먼저
    const fish = mk(0, 0, '어류', 'concept', '물에서 아가미로 숨쉰다'), bird = mk(300, 0, '조류', 'concept'), top = mk(150, 200, '척추동물', 'concept');
    arrow(fish, top, 'kind-of'); arrow(bird, top, 'kind-of');
    // 논증: 근거가 왼쪽에 있어도 주장이 먼저
    const ev = mk(0, 500, '출퇴근 조사', 'evidence'), claim = mk(300, 500, '자전거 도로 확충', 'claim'), reb = mk(300, 650, '겨울 이용 감소', 'rebuttal');
    arrow(ev, claim, 'supports'); arrow(reb, claim, 'refutes');
    // 인과 사슬: 끝의 뒷받침(목표로 가는)은 차례 그대로
    const a = mk(0, 900, '원화 강세', 'concept'), b = mk(300, 900, '수입 물가 하락', 'concept'), c = mk(600, 900, '물가 안정', 'goal');
    arrow(a, b, 'causes'); arrow(b, c, 'supports');
    // 닫힌 고리 (next 넷, 마지막 → 처음)
    const s1 = mk(0, 1200, '증발', 'step'), s2 = mk(300, 1200, '응결', 'step'), s3 = mk(600, 1200, '강수', 'step');
    arrow(s1, s2, 'next'); arrow(s2, s3, 'next'); tx.createArrow({ from: { blockId: s3, side: 'auto' }, to: { blockId: s1, side: 'auto' }, relation: 'next', label: '다시' });
    // 이름 있는 묶음(회의록 칸) + 담당 · 기한 · 사건 시점
    const d1 = mk(0, 1500, '배포 결정', 'decision'), t1 = mk(300, 1500, '명세 작성', 'action'), ev1 = mk(0, 1700, '베타 배포', 'event');
    tx.set('block', d1, { group: 'g-dec' }); tx.set('block', t1, { group: 'g-dec', owner: '김 대리', due: '수요일' }); tx.set('block', ev1, { time: '10/27' });
    tx.setNote({ groups: { 'g-dec': { name: '결정 사항', kind: 'slot' } } });
    // 조건 갈래
    const cond = mk(0, 1900, '빠진 영수증이 있으면', 'condition'), rej = mk(300, 1900, '반려', 'action');
    tx.createArrow({ from: { blockId: cond, side: 'auto' }, to: { blockId: rej, side: 'auto' }, relation: 'leads-to', label: '있음' });
  }, { origin: 'user' });
});
await ws(() => window.__dn.setViewMode('doc'));
await page.waitForSelector('.doc-scroll .dn-doc-item');
await page.waitForTimeout(500);
const st = await ws(() => [...document.querySelectorAll('.doc-scroll .dn-doc-item')].map((el) => ({
  t: (el.querySelector('.dn-doc-text')?.textContent ?? '').trim().slice(0, 12),
  ml: parseFloat(getComputedStyle(el).marginLeft) || 0,
  heading: el.classList.contains('dn-doc-heading'),
  step: el.dataset.step ?? '',
  rel: [...el.querySelectorAll('.dn-doc-rel li')].map((li) => li.textContent),
  head: el.querySelector('.dn-doc-ghead')?.textContent ?? '',
  tag: el.querySelector('.dn-kind-tag')?.textContent ?? '',
})));
const at = (t) => st.findIndex((x) => x.t.startsWith(t)), get = (t) => st[at(t)];
check('분류 트리: 상위(척추동물)가 하위보다 먼저', at('척추동물') >= 0 && at('척추동물') < at('어류') && at('척추동물') < at('조류'), JSON.stringify(st.map((x) => x.t)));
check('하위는 들여쓰기', get('어류')?.ml > get('척추동물')?.ml && get('조류')?.ml === get('어류')?.ml, JSON.stringify([get('척추동물')?.ml, get('어류')?.ml, get('조류')?.ml]));
check('들여쓰기가 보이는 "→ 척추동물" 줄은 없음', !get('어류')?.rel.some((r) => r.includes('척추동물')) && !get('조류')?.rel.some((r) => r.includes('척추동물')), JSON.stringify([get('어류')?.rel, get('조류')?.rel]));
check('종류가 있는 제목만 상자(개념)는 소제목처럼 크지 않음', get('척추동물') && !get('척추동물').heading && !get('조류').heading);
check('논증: 주장이 근거 · 반박보다 먼저(두괄식), 근거 · 반박은 들여쓰기', at('자전거') < at('출퇴근') && at('자전거') < at('겨울') && get('출퇴근')?.ml > get('자전거')?.ml && get('겨울')?.ml > get('자전거')?.ml);
check('인과 사슬: 화살표 차례 그대로 · 번호 없음 · 들여쓰기 없음', at('원화') < at('수입') && at('수입') < at('물가') && ['원화', '수입', '물가'].every((t) => !get(t)?.step && !get(t)?.ml), JSON.stringify(['원화', '수입', '물가'].map((t) => get(t))));
check("닫힌 고리: 마지막 단계에 '↺ 1단계로'", get('강수')?.rel.some((r) => r.startsWith('↺ 1단계로')), JSON.stringify(get('강수')));
check('이름 있는 묶음은 첫 상자 위에 소제목 한 번', get('배포 결정')?.head === '결정 사항' && get('명세 작성')?.head === '', JSON.stringify([get('배포 결정')?.head, get('명세 작성')?.head]));
check('담당 · 기한 칩, 사건은 시점이 머리', /담당 김 대리/.test(get('명세 작성')?.tag) && /기한 수요일/.test(get('명세 작성')?.tag) && get('베타 배포')?.tag.startsWith('10/27 · event'), JSON.stringify([get('명세 작성')?.tag, get('베타 배포')?.tag]));
check("조건 갈래는 '▸ 라벨 → 대상'", get('빠진 영수증')?.rel.some((r) => r === '▸ 있음 → 반려') || false, JSON.stringify(get('빠진 영수증')));
if (OUT) await page.screenshot({ path: `${OUT}/doc-relations.png` });
check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
