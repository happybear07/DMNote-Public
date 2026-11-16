// 관계 · 집계 칸과 메뉴 (FR-062): 관계 칸 = 연결된 항목 이름 칩(누르면 고르기), 집계 칸 = 계산한 값(읽기만).
// 속성 추가 메뉴에서 대상 데이터베이스를 골라 관계를 만들고, 속성 메뉴에서 집계할 관계 · 속성 · 함수를 고른다.
import {
  addDbRelation, addDbRollup, addDbRow, dbCellTextIn, dbRowName, dbRows, dbTitle, relationPair, relationTargets,
  rollupNeedsNumber, ROLLUP_FNS, ROLLUP_LABEL, setDbRelation, setDbRollup,
  type DatabaseContent, type DbProperty, type DbRow, type Engine, type Id, type RollupFn,
} from '@dn/engine-core';
import { dbOf, findInput, item, mk, popup, sep } from './db-menus';

const idsOf = (v: unknown): Id[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** 관계 칸: 연결된 항목 이름 칩 → 누르면 고르기 */
export function relationCell(engine: Engine, readOnly: boolean, c: DatabaseContent, rowId: Id, p: DbProperty, key: string): HTMLElement {
  const btn = mk('button', 'dn-db-chips dn-db-rel dn-db-ui');
  btn.dataset.key = key;
  btn.disabled = readOnly;
  btn.setAttribute('aria-label', `${p.name} 연결 고르기`);
  const b = p.relation ? dbOf(engine, p.relation.db) : null;
  const row = c.rows.find((r) => r.id === rowId);
  if (!b) { btn.append(mk('span', 'dn-db-rel-missing', '연결한 데이터베이스가 없어요')); btn.disabled = true; return btn; }
  for (const id of idsOf(row?.values[p.id])) {
    const r = b.rows.find((x) => x.id === id);
    if (r) btn.append(mk('span', 'dn-db-chip dn-db-relchip', `↗ ${dbRowName(b, r)}`));
  }
  btn.addEventListener('click', () => openRelationPicker(btn, engine, c.id, rowId, p.id));
  return btn;
}

/** 집계 칸 (읽기만) */
export function rollupCell(engine: Engine, c: DatabaseContent, row: DbRow | undefined, p: DbProperty, key: string): HTMLElement {
  const el = mk('span', 'dn-db-rollup', row ? dbCellTextIn(engine, c, row, p) : '');
  el.dataset.key = key;
  el.title = p.rollup ? `${ROLLUP_LABEL[p.rollup.fn]} — 속성 메뉴에서 바꿀 수 있어요` : '';
  return el;
}

/** 관계 고르기: 저쪽 항목 목록(찾기), 누르면 잇기 · 끊기, 없는 이름은 Enter로 저쪽에 새 항목을 만들어 잇기 */
function openRelationPicker(anchor: HTMLElement, engine: Engine, cid: Id, rowId: Id, propId: Id): void {
  let q = '';
  popup(anchor, '연결할 항목 고르기', (pop, again, close) => {
    const a = dbOf(engine, cid);
    const p = a?.properties.find((x) => x.id === propId);
    const row = a?.rows.find((r) => r.id === rowId);
    const b = p?.relation ? dbOf(engine, p.relation.db) : null;
    if (!a || !p || !row || !b) { close(); return; }
    const chosen = idsOf(row.values[propId]);
    const toggle = (id: Id) => { setDbRelation(engine, cid, rowId, propId, chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]); again(); };
    pop.append(mk('div', 'dn-db-mh', `${dbTitle(b)}의 항목`));
    const inp = findInput(pop, q, '항목 찾기 · 새로 만들기', '항목 찾기', (v) => { q = v; }, again);
    const all = dbRows(b);
    const shown = all.filter((r) => dbRowName(b, r).toLowerCase().includes(q.trim().toLowerCase()));
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const name = inp.value.trim();
      if (!name) return;
      const exact = all.find((r) => dbRowName(b, r) === name) ?? (shown.length === 1 ? shown[0] : undefined);
      q = '';
      if (exact) { if (!chosen.includes(exact.id)) toggle(exact.id); else again(); return; }
      // 저쪽에 새 항목(이름 = 친 글자)을 만들어 잇는다
      const first = b.properties[0];
      const made = addDbRow(engine, b.id, null, first ? { [first.id]: name } : {});
      if (made.ok && made.value) toggle(made.value);
    });
    pop.append(inp);
    const list = mk('div', 'dn-db-rel-list');
    for (const r of shown.slice(0, 200)) {
      const on = chosen.includes(r.id);
      const it = item(list, `${on ? '☑' : '☐'}  ${dbRowName(b, r)}`, () => toggle(r.id), on ? 'on' : '');
      it.setAttribute('aria-checked', String(on));
      it.setAttribute('role', 'menuitemcheckbox');
    }
    pop.append(list);
    if (shown.length > 200) pop.append(mk('div', 'dn-db-hint', `${shown.length - 200}개 더 — 찾기로 좁혀 주세요`));
    if (q.trim() && !all.some((r) => dbRowName(b, r) === q.trim())) pop.append(mk('div', 'dn-db-hint', `Enter — "${q.trim()}" 항목을 ${dbTitle(b)}에 만들어 잇기`));
    if (!relationPair(engine, cid, p)) pop.append(mk('div', 'dn-db-hint', '이 관계는 한쪽만 이어져 있어요 (복사한 데이터베이스)'));
  });
}

/** 속성 추가 메뉴: 관계(대상 고르기) · 집계 */
export function addLinkItems(pop: HTMLElement, engine: Engine, cid: Id, close: () => void): void {
  const targets = relationTargets(engine, cid);
  sep(pop, '연결');
  if (!targets.length) pop.append(mk('div', 'dn-db-hint', '관계: 이 노트에 다른 데이터베이스를 먼저 만들어 주세요'));
  for (const t of targets) item(pop, `↔  관계 — ${t.title}`, () => { addDbRelation(engine, cid, t.id); close(); });
  const hasRel = !!dbOf(engine, cid)?.properties.some((p) => p.type === 'relation');
  const b = item(pop, 'Σ  집계', () => { addDbRollup(engine, cid); close(); });
  if (!hasRel) { b.disabled = true; b.title = '관계 속성이 있어야 집계할 수 있어요'; }
}

/** 속성 메뉴의 관계 · 집계 부분 */
export function linkPropSection(pop: HTMLElement, engine: Engine, cid: Id, p: DbProperty, again: () => void): void {
  const a = dbOf(engine, cid);
  if (!a) return;
  if (p.type === 'relation') {
    const b = p.relation ? dbOf(engine, p.relation.db) : null;
    sep(pop, '관계');
    pop.append(mk('div', 'dn-db-hint', b ? `${dbTitle(b)}의 항목과 이어요${relationPair(engine, cid, p) ? ' — 그쪽에도 같이 보여요' : ' (한쪽만)'}` : '연결한 데이터베이스가 없어요'));
    return;
  }
  if (p.type !== 'rollup') return;
  const r = p.rollup ?? { relation: '', prop: '', fn: 'count' as RollupFn };
  const rels = a.properties.filter((x) => x.type === 'relation');
  sep(pop, '집계할 관계');
  if (!rels.length) pop.append(mk('div', 'dn-db-hint', '관계 속성을 먼저 만들어 주세요'));
  for (const x of rels) item(pop, `${x.id === r.relation ? '●' : '○'}  ${x.name}`, () => { setDbRollup(engine, cid, p.id, { relation: x.id }); again(); }, x.id === r.relation ? 'on' : '');
  const rel = rels.find((x) => x.id === r.relation);
  const b = rel?.relation ? dbOf(engine, rel.relation.db) : null;
  if (b && r.fn !== 'count') {
    sep(pop, '그쪽 속성');
    for (const x of b.properties.filter((y) => y.type !== 'relation' && y.type !== 'rollup')) {
      item(pop, `${x.id === r.prop ? '●' : '○'}  ${x.name}`, () => { setDbRollup(engine, cid, p.id, { prop: x.id }); again(); }, x.id === r.prop ? 'on' : '');
    }
  }
  sep(pop, '계산');
  for (const fn of ROLLUP_FNS) {
    const tp = b?.properties.find((x) => x.id === r.prop);
    const off = rollupNeedsNumber(fn) && tp?.type !== 'number';
    const it = item(pop, `${fn === r.fn ? '●' : '○'}  ${ROLLUP_LABEL[fn]}${off ? ' (숫자 속성)' : ''}`, () => { setDbRollup(engine, cid, p.id, { fn }); again(); }, fn === r.fn ? 'on' : '');
    if (fn === 'checked' && tp?.type !== 'checkbox') it.title = '체크박스 속성에서 쓰세요';
  }
}

