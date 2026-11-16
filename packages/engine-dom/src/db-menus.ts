// 데이터베이스 메뉴 (FR-056 · 057): 속성 메뉴(이름 · 타입 · 옵션 · 순서 · 숨기기 · 삭제), 속성 추가, 숨긴 속성, 항목 메뉴, 선택 옵션 고르기.
// 메뉴는 document.body에 고정 위치로 띄운다 — 캔버스 확대와 무관하게 읽기 쉬운 크기. 동작할 때마다 엔진에서 다시 읽어 그린다.
import {
  activeDbView, addDbOption, addDbProperty, addDbRow, DB_OPTION_COLORS, DB_PROP_TYPES, DB_TYPE_LABEL, dbRows, dbTitle, dbToCsv, dbViews, deleteDbOption, deleteDbProperty, deleteDbRows,
  isDatabaseContent, moveDbProperty, setDbPageTemplate, moveDbRow, renameDbProperty, setDbPropertyHidden, setDbPropertyRemind, setDbPropertyType, setDbValue, updateDbOption, viewRows,
  type DatabaseContent, type DbFile, type DbOption, type DbPropType, type Engine, type Id,
} from '@dn/engine-core';
import { BLOCK_COLORS } from './constants';
import { addLinkItems, linkPropSection } from './db-relation-ui';
import { formulaSection, statusGroupSelect } from './db-props-ui';

/** 앱이 정하는 데이터베이스 동작 (FR-063): 항목 페이지 열기 · 고를 수 있는 템플릿. 없으면 해당 버튼을 숨긴다 */
/** pickFiles · openFile: 파일 속성 (GAP #19) — 파일을 골라 첨부 저장소에 넣고 해시 · 이름을, 누르면 새 탭에서 */
export interface DbHost { openRow(contentId: Id, rowId: Id): void; templates(): { id: string; name: string }[]; pickFiles?(): Promise<DbFile[]>; openFile?(f: DbFile): void }
let host: DbHost | null = null;
export function setDbHost(h: DbHost | null): void { host = h; }
export const dbHost = (): DbHost | null => host;

/** 항목 페이지 열기 버튼 */
export function openPageButton(cid: Id, rowId: Id, hasPage: boolean): HTMLElement | null {
  if (!host) return null;
  const b = mk('button', `dn-db-open-page dn-db-ui${hasPage ? ' has' : ''}`, '열기');
  b.title = hasPage ? '항목 페이지 열기' : '항목 페이지 만들어 열기';
  b.setAttribute('aria-label', b.title);
  b.addEventListener('click', (e) => { e.stopPropagation(); host?.openRow(cid, rowId); });
  return b;
}

/** CSV 내려받기 (GAP #13 — 노션 ••• › 내보내기) — 지금 보기 그대로. 파일 이름 = 데이터베이스 이름(보기가 여럿이면 보기 이름도) */
function saveCsv(engine: Engine, d: DatabaseContent): void {
  const { csv } = dbToCsv(engine, d);
  const name = `${dbTitle(d)}${dbViews(d).length > 1 ? ` - ${activeDbView(d).name}` : ''}`.replace(/[\\/:*?"<>|\s]+/g, ' ').trim().slice(0, 80) || '데이터베이스';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 데이터베이스 메뉴: CSV 내보내기(보기 전용에서도) · 항목 템플릿(앱이 항목 페이지를 열 수 있을 때) */
export function openDbMenu(anchor: HTMLElement, engine: Engine, cid: Id, readOnly = false): void {
  popup(anchor, '데이터베이스 메뉴', (pop, again, close) => {
    const d = dbOf(engine, cid);
    if (!d) { close(); return; }
    item(pop, `CSV로 내보내기 (지금 보기 · 항목 ${viewRows(d, activeDbView(d)).length}개)`, () => { saveCsv(engine, d); close(); });
    if (readOnly || !host) return;
    sep(pop);
    pop.append(mk('div', 'dn-db-mh', '새 항목 페이지 템플릿'));
    const list = [{ id: '', name: '빈 페이지' }, ...(host?.templates() ?? [])];
    for (const t of list) {
      const on = (d.pageTemplate ?? '') === t.id;
      const b = item(pop, `${on ? '●' : '○'}  ${t.name}`, () => { setDbPageTemplate(engine, cid, t.id || null); again(); }, on ? 'on' : '');
      b.setAttribute('aria-checked', String(on));
    }
    pop.append(mk('div', 'dn-db-hint', '항목의 "열기"로 처음 만드는 페이지에 쓰여요'));
  });
}

export const TYPE_ICON: Record<DbPropType, string> = { text: 'Aa', number: '#', select: '▾', multiSelect: '☰', status: '◔', date: '▦', checkbox: '☑', url: '↗', files: '⧉', formula: 'ƒ', created: '◷', edited: '✎', relation: '↔', rollup: 'Σ' };
const COLOR_NAME: Record<string, string> = { gray: '회색', brown: '갈색', orange: '주황', yellow: '노랑', green: '초록', blue: '파랑', purple: '보라', pink: '분홍', red: '빨강' };

export function chipEl(o: DbOption): HTMLElement {
  const s = mk('span', 'dn-db-chip', o.name);
  s.style.background = `var(--dn-block-${o.color}, ${BLOCK_COLORS[o.color] ?? BLOCK_COLORS.gray})`;
  return s;
}

export const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
};
export const dbOf = (engine: Engine, cid: Id): DatabaseContent | null => { const c = engine.getContent(cid); return isDatabaseContent(c) ? c : null; };
/** × 지우기 버튼 */
export const xBtn = (title: string, aria: string, fn: () => void): HTMLButtonElement => {
  const b = mk('button', 'dn-db-x', '×');
  b.title = title;
  b.setAttribute('aria-label', aria);
  b.addEventListener('click', fn);
  return b;
};
/** 메뉴 위 찾기 칸 — 칠 때마다 다시 그리고 커서는 끝으로 */
export function findInput(pop: HTMLElement, q: string, placeholder: string, label: string, setQ: (v: string) => void, again: () => void): HTMLInputElement {
  const inp = mk('input', 'dn-db-pin');
  inp.value = q;
  inp.dataset.k = 'q';
  inp.placeholder = placeholder;
  inp.setAttribute('aria-label', label);
  inp.addEventListener('input', () => { setQ(inp.value); again(); pop.querySelector<HTMLInputElement>('[data-k="q"]')?.setSelectionRange(inp.value.length, inp.value.length); });
  return inp;
}
/** 창 전체로 끌기 — 놓으면 리스너부터 떼고 up */
export function dragWindow(move: (e: PointerEvent) => void, up: () => void): void {
  const done = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', done); up(); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', done);
}

let current: { el: HTMLElement; close: () => void } | null = null;

/** 떠 있는 메뉴 하나 (새로 열면 먼저 것은 닫힘). render는 동작 뒤마다 다시 불린다 */
export function popup(anchor: HTMLElement, label: string, render: (pop: HTMLElement, again: () => void, close: () => void) => void): void {
  current?.close();
  const pop = mk('div', 'dn-db-pop dn-db-ui');
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', label);
  document.body.append(pop);
  const place = () => {
    const a = anchor.isConnected ? anchor.getBoundingClientRect() : pop.getBoundingClientRect();
    const r = pop.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(a.left, innerWidth - r.width - 8))}px`;
    pop.style.top = `${a.bottom + 4 + r.height > innerHeight - 8 ? Math.max(8, a.top - r.height - 4) : a.bottom + 4}px`;
  };
  const onDown = (e: PointerEvent) => { if (!pop.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = () => {
    pop.remove();
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    if (current?.el === pop) current = null;
  };
  const again = () => {
    const focused = document.activeElement instanceof HTMLElement && pop.contains(document.activeElement) ? document.activeElement.dataset.k : undefined;
    pop.replaceChildren();
    render(pop, again, close);
    place();
    if (focused) pop.querySelector<HTMLElement>(`[data-k="${focused}"]`)?.focus();
  };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  current = { el: pop, close };
  again();
  pop.querySelector<HTMLElement>('input')?.focus();
}

export function item(pop: HTMLElement, text: string, fn: () => void, cls = ''): HTMLButtonElement {
  const b = mk('button', `dn-db-mi${cls ? ` ${cls}` : ''}`, text);
  b.setAttribute('role', 'menuitem');
  b.addEventListener('click', fn);
  pop.append(b);
  return b;
}
export const sep = (pop: HTMLElement, head?: string) => { pop.append(mk('div', 'dn-db-sep')); if (head) pop.append(mk('div', 'dn-db-mh', head)); };

/** 속성 메뉴 */
export function openPropMenu(anchor: HTMLElement, engine: Engine, cid: Id, propId: Id, first: boolean): void {
  popup(anchor, '속성 메뉴', (pop, again, close) => {
    const d = dbOf(engine, cid);
    const p = d?.properties.find((x) => x.id === propId);
    if (!d || !p) { close(); return; }
    const name = mk('input', 'dn-db-pin');
    name.value = p.name;
    name.dataset.k = 'name';
    name.setAttribute('aria-label', '속성 이름');
    name.addEventListener('change', () => { renameDbProperty(engine, cid, propId, name.value); again(); });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { renameDbProperty(engine, cid, propId, name.value); close(); } });
    pop.append(name);
    // 관계 · 집계는 타입을 바꾸지 않는다 — 대상 · 계산 설정만 (FR-062)
    const link = p.type === 'relation' || p.type === 'rollup';
    if (link) linkPropSection(pop, engine, cid, p, again);
    else sep(pop, '타입');
    const types = link ? [] : first ? DB_PROP_TYPES.filter((t) => t === 'text' || t === 'number' || t === 'url') : DB_PROP_TYPES;
    for (const t of types) {
      const b = item(pop, `${TYPE_ICON[t]}  ${DB_TYPE_LABEL[t]}`, () => { setDbPropertyType(engine, cid, propId, t); again(); }, t === p.type ? 'on' : '');
      b.setAttribute('aria-checked', String(t === p.type));
    }
    if (p.type === 'select' || p.type === 'multiSelect' || p.type === 'status') {
      sep(pop, p.type === 'status' ? '옵션 · 묶음' : '옵션');
      for (const o of p.options ?? []) {
        const row = mk('div', 'dn-db-opt');
        const n = mk('input', 'dn-db-pin');
        n.value = o.name;
        n.dataset.k = `o:${o.id}`;
        n.setAttribute('aria-label', '옵션 이름');
        n.addEventListener('change', () => { updateDbOption(engine, cid, propId, o.id, { name: n.value }); again(); });
        const colors = mk('span', 'dn-db-colors');
        for (const col of DB_OPTION_COLORS) {
          const s = mk('button', `dn-db-sw${col === o.color ? ' on' : ''}`);
          s.style.background = `var(--dn-block-${col}, ${BLOCK_COLORS[col]})`;
          s.title = COLOR_NAME[col] ?? col;
          s.setAttribute('aria-label', `${o.name} ${COLOR_NAME[col]}`);
          s.addEventListener('click', () => { updateDbOption(engine, cid, propId, o.id, { color: col }); again(); });
          colors.append(s);
        }
        row.append(n, ...(p.type === 'status' ? [statusGroupSelect(engine, cid, propId, o, again)] : []), colors, xBtn('옵션 삭제', `${o.name} 옵션 삭제`, () => { deleteDbOption(engine, cid, propId, o.id); again(); }));
        pop.append(row);
      }
      const add = mk('input', 'dn-db-pin');
      add.placeholder = '+ 옵션 추가 (Enter)';
      add.dataset.k = 'addopt';
      add.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && add.value.trim()) { addDbOption(engine, cid, propId, add.value); again(); } });
      pop.append(add);
    }
    if (p.type === 'formula') formulaSection(pop, engine, cid, p, again);
    if (p.type === 'date') {
      // 날짜 알림 (FR-136): 항목마다 그 날짜 이 시각에
      sep(pop, '알림');
      const time = mk('input', 'dn-db-pin');
      time.type = 'time';
      time.value = p.remind ?? '';
      time.dataset.k = 'remind';
      time.setAttribute('aria-label', '날짜 알림 시각');
      time.addEventListener('change', () => {
        if (!/^\d{2}:\d{2}$/.test(time.value)) return;
        if (!p.remind && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().catch(() => {});
        setDbPropertyRemind(engine, cid, propId, time.value);
        again();
      });
      pop.append(time);
      if (p.remind) item(pop, '알림 끄기', () => { setDbPropertyRemind(engine, cid, propId, null); again(); });
    }
    sep(pop);
    const i = d.properties.findIndex((x) => x.id === propId);
    if (!first && i > 1) item(pop, '← 왼쪽으로', () => { moveDbProperty(engine, cid, propId, i - 1); again(); });
    if (!first && i < d.properties.length - 1) item(pop, '오른쪽으로 →', () => { moveDbProperty(engine, cid, propId, i + 1); again(); });
    if (!first) item(pop, '숨기기', () => { setDbPropertyHidden(engine, cid, propId, true); close(); });
    if (!first) item(pop, '속성 삭제', () => { deleteDbProperty(engine, cid, propId); close(); }, 'danger');
  });
}

export function openAddProp(anchor: HTMLElement, engine: Engine, cid: Id): void {
  popup(anchor, '속성 추가', (pop, _again, close) => {
    pop.append(mk('div', 'dn-db-mh', '속성 추가'));
    for (const t of DB_PROP_TYPES) item(pop, `${TYPE_ICON[t]}  ${DB_TYPE_LABEL[t]}`, () => { addDbProperty(engine, cid, t); close(); });
    addLinkItems(pop, engine, cid, close);
  });
}

export function openHiddenProps(anchor: HTMLElement, engine: Engine, cid: Id): void {
  popup(anchor, '숨긴 속성', (pop, again, close) => {
    const d = dbOf(engine, cid);
    const hid = d?.properties.filter((p) => p.hidden) ?? [];
    if (!hid.length) { close(); return; }
    pop.append(mk('div', 'dn-db-mh', '숨긴 속성'));
    for (const p of hid) item(pop, `${TYPE_ICON[p.type]}  ${p.name} 보이기`, () => { setDbPropertyHidden(engine, cid, p.id, false); again(); });
  });
}

export function openRowMenu(anchor: HTMLElement, engine: Engine, cid: Id, rowId: Id): void {
  popup(anchor, '항목 메뉴', (pop, _again, close) => {
    const d = dbOf(engine, cid);
    if (!d) { close(); return; }
    const rows = dbRows(d);
    const i = rows.findIndex((r) => r.id === rowId);
    if (host) item(pop, rows[i]?.page ? '페이지 열기' : '페이지로 열기', () => { close(); host?.openRow(cid, rowId); });
    item(pop, '위에 항목 추가', () => { addDbRow(engine, cid, rows[i - 1]?.id ?? null); if (i === 0) moveFirst(engine, cid); close(); });
    item(pop, '아래에 항목 추가', () => { addDbRow(engine, cid, rowId); close(); });
    if (i > 0) item(pop, '위로', () => { moveDbRow(engine, cid, rowId, rows[i - 1]!.id); close(); });
    if (i < rows.length - 1) item(pop, '아래로', () => { moveDbRow(engine, cid, rowId, rows[i + 2]?.id ?? null); close(); });
    item(pop, '항목 삭제', () => { deleteDbRows(engine, cid, [rowId]); close(); }, 'danger');
  });
}

/** 맨 앞 항목 위에 추가: 끝에 만든 뒤 맨 앞으로 */
function moveFirst(engine: Engine, cid: Id): void {
  const d = dbOf(engine, cid);
  if (!d) return;
  const rows = dbRows(d);
  const last = rows.at(-1);
  if (last && rows[0]) moveDbRow(engine, cid, last.id, rows[0].id);
}

/** 선택 · 다중 선택 값 고르기 — 위 칸에 쳐서 찾고, 없는 이름은 Enter로 새 옵션 */
export function openOptionPicker(anchor: HTMLElement, engine: Engine, cid: Id, rowId: Id, propId: Id): void {
  let q = '';
  popup(anchor, '옵션 고르기', (pop, again, close) => {
    const d = dbOf(engine, cid);
    const p = d?.properties.find((x) => x.id === propId);
    const r = d?.rows.find((x) => x.id === rowId);
    if (!d || !p || !r) { close(); return; }
    const multi = p.type === 'multiSelect';
    const cur = r.values[propId];
    const chosen = new Set(multi ? (Array.isArray(cur) ? cur : []) : typeof cur === 'string' ? [cur] : []);
    const choose = (id: Id) => {
      if (multi) { const s = new Set(chosen); if (s.has(id)) s.delete(id); else s.add(id); setDbValue(engine, cid, rowId, propId, [...s]); again(); }
      else { setDbValue(engine, cid, rowId, propId, chosen.has(id) ? null : id); close(); }
    };
    const inp = findInput(pop, q, '옵션 찾기 · 새로 만들기', '옵션 찾기', (v) => { q = v; }, again);
    const opts = (p.options ?? []).filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const name = inp.value.trim();
      if (!name) return;
      const exact = (p.options ?? []).find((o) => o.name === name) ?? (opts.length === 1 ? opts[0] : undefined);
      const id = exact?.id ?? (() => { const res = addDbOption(engine, cid, propId, name); return res.ok ? res.value : null; })();
      q = '';
      if (id) choose(id);
    });
    pop.append(inp);
    for (const o of opts) {
      const b = item(pop, '', () => choose(o.id), chosen.has(o.id) ? 'on' : '');
      b.append(chipEl(o));
      if (chosen.has(o.id)) b.append(mk('span', 'dn-db-tick', '✓'));
      b.setAttribute('aria-checked', String(chosen.has(o.id)));
    }
    if (q.trim() && !(p.options ?? []).some((o) => o.name === q.trim())) pop.append(mk('div', 'dn-db-hint', `Enter — "${q.trim()}" 옵션 만들기`));
    if (!multi && chosen.size) item(pop, '선택 해제', () => { setDbValue(engine, cid, rowId, propId, null); close(); });
  });
}
