// 데이터베이스 새 속성 화면 (GAP #19 — engine-core db-props.ts): 상태 옵션의 묶음 고르기 · 수식 고치기(바로 결과 미리보기) ·
// 파일 칸(+ 파일 · 이름 누르면 열기 · × 빼기) · 계산 칸(만든 때 · 고친 때 · 수식 — 읽기만, 수식 오류는 '#오류'와 이유).
import {
  dbFiles, dbFilesWith, dbRows, extraCellText, formulaResult, formulaText, setDbFormula, setDbValue, STATUS_GROUP_LABEL, STATUS_GROUPS, updateDbOption,
  type DatabaseContent, type DbOption, type DbProperty, type DbValue, type Engine, type Id, type StatusGroup,
} from '@dn/engine-core';
import { dbHost, mk, sep } from './db-menus';

/** 상태 옵션 한 줄의 묶음 고르기 (할 일 · 진행 중 · 완료) */
export function statusGroupSelect(engine: Engine, cid: Id, propId: Id, o: DbOption, again: () => void): HTMLSelectElement {
  const s = mk('select', 'dn-db-sel dn-db-group');
  s.setAttribute('aria-label', `${o.name} 묶음`);
  for (const g of STATUS_GROUPS) { const x = mk('option', '', STATUS_GROUP_LABEL[g]); x.value = g; s.append(x); }
  s.value = o.group ?? 'todo';
  s.addEventListener('change', () => { updateDbOption(engine, cid, propId, o.id, { group: s.value as StatusGroup }); again(); });
  return s;
}

const FORMULA_HELP = 'prop("이름") · + - * / · == > < · if(조건, 참, 거짓) · concat · round · dateBetween(날짜, 날짜, "days") · today()';

/** 속성 메뉴의 수식 칸: 고치면 저장, 첫 항목으로 계산한 결과(또는 오류)를 바로 아래에 */
export function formulaSection(pop: HTMLElement, engine: Engine, cid: Id, p: DbProperty, again: () => void): void {
  sep(pop, '수식');
  const area = mk('textarea', 'dn-db-pin dn-db-formula');
  area.value = p.formula ?? '';
  area.rows = 3;
  area.dataset.k = 'formula';
  area.placeholder = '예: prop("점수") * 2';
  area.setAttribute('aria-label', '수식');
  area.spellcheck = false;
  const out = mk('div', 'dn-db-hint dn-db-fres');
  const preview = () => {
    const d = engine.getContent(cid) as DatabaseContent | undefined;
    const row = d && dbRows(d)[0];
    if (!d || !row) { out.textContent = '항목이 생기면 결과를 보여 드려요'; return; }
    const r = formulaResult(d, row, { ...p, formula: area.value });
    out.classList.toggle('err', 'error' in r);
    out.textContent = 'error' in r ? `오류: ${r.error}` : `첫 항목 결과: ${formulaText(r.value) || '(빈 값)'}`;
  };
  area.addEventListener('input', preview);
  area.addEventListener('change', () => { setDbFormula(engine, cid, p.id, area.value.trim()); again(); });
  area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); area.dispatchEvent(new Event('change')); } });
  pop.append(area, out, mk('div', 'dn-db-hint', FORMULA_HELP));
  preview();
}

/** 계산 칸 (만든 때 · 고친 때 · 수식) — 읽기만 */
export function computedCell(c: DatabaseContent, rowId: Id, p: DbProperty, key: string): HTMLElement {
  const row = c.rows.find((r) => r.id === rowId);
  const text = row ? extraCellText(c, row, p) ?? '' : '';
  const el = mk('span', `dn-db-computed${text === '#오류' ? ' err' : ''}`, text);
  el.dataset.key = key;
  if (text === '#오류' && row) { const r = formulaResult(c, row, p); if ('error' in r) el.title = r.error; }
  return el;
}

/** 파일 칸: 파일 이름 칩(누르면 열기 · × 빼기) + 파일 더하기 (첨부 저장소는 앱이 갖는다 — DbHost) */
export function filesCell(engine: Engine, readOnly: boolean, c: DatabaseContent, rowId: Id, p: DbProperty, v: DbValue | undefined, key: string): HTMLElement {
  const box = mk('span', 'dn-db-files');
  box.dataset.key = key;
  const host = dbHost();
  for (const f of dbFiles(v)) {
    const chip = mk('span', 'dn-db-file');
    const open = mk('button', 'dn-db-ui dn-db-fname', f.name);
    open.title = `${f.name} 열기`;
    open.addEventListener('click', (e) => { e.stopPropagation(); host?.openFile?.(f); });
    chip.append(open);
    if (!readOnly) {
      const x = mk('button', 'dn-db-ui dn-db-fx', '×');
      x.title = `${f.name} 빼기`;
      x.setAttribute('aria-label', x.title);
      x.addEventListener('click', (e) => { e.stopPropagation(); setDbValue(engine, c.id, rowId, p.id, dbFilesWith(c, rowId, p.id, [], f.hash)); });
      chip.append(x);
    }
    box.append(chip);
  }
  if (!readOnly && host?.pickFiles) {
    const add = mk('button', 'dn-db-ui dn-db-fadd', '+ 파일');
    add.title = '파일 더하기';
    add.addEventListener('click', (e) => {
      e.stopPropagation();
      void host.pickFiles!().then((files) => {
        const cur = engine.getContent(c.id) as DatabaseContent | undefined;
        if (files.length && cur) setDbValue(engine, c.id, rowId, p.id, dbFilesWith(cur, rowId, p.id, files));
      });
    });
    box.append(add);
  }
  return box;
}
