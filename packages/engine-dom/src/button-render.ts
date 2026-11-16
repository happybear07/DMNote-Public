// 버튼 블록 그리기 (GAP #17 — engine-core button.ts): 이름 단추 하나 + 고치기(⋯). 누르면 넣을 상자들을 이 버튼 바로 아래에.
// 캔버스 · 문서 뷰가 같이 쓴다 — 보기 전용이면 누를 수 없고 고치기도 없다. 단추는 dn-ui라 눌러도 블록을 고르거나 끌지 않는다.
import { buttonSummary, isButtonContent, pressButton, setButtonBlocks, setButtonLabel, type ButtonContent, type Engine, type Id } from '@dn/engine-core';
import { iconElement } from '@dn/text-pm';
import { item, mk, popup, sep } from './db-menus';

export interface ButtonOpts {
  engine: Engine;
  readOnly: boolean;
  /** 지금 고른 상자들 — ⋯ › '고른 상자로 바꾸기' */
  selected(): Id[];
  /** 누른 뒤 새 블록들 (캔버스는 골라 보인다) */
  onPressed?(ids: Id[]): void;
}

export function renderButton(c: ButtonContent, el: HTMLElement, o: ButtonOpts): void {
  el.className = 'dn-button'; // 다른 콘텐츠처럼 자리표시(dn-unknown — 기울임) 클래스를 바꾼다
  const press = mk('button', 'dn-btn-press dn-ui');
  press.append(iconElement('plus', 15), mk('span', '', c.label));
  press.title = o.readOnly ? c.label : `누르면 바로 아래에 넣어요 — ${buttonSummary(c)}`;
  press.disabled = o.readOnly;
  press.addEventListener('click', (e) => {
    e.stopPropagation();
    if (o.readOnly || press.closest('.dn-readonly')) return; // 캔버스는 읽기 모드를 켜도 다시 그리지 않는다 — 루트 표시로 막는다
    const r = pressButton(o.engine, c.blockId);
    if (r.ok) o.onPressed?.(r.value);
  });
  el.replaceChildren(press);
  if (o.readOnly) return;
  const more = mk('button', 'dn-btn-edit dn-ui', '⋯');
  more.title = '버튼 고치기 (이름 · 넣을 내용)';
  more.setAttribute('aria-label', '버튼 고치기');
  more.addEventListener('click', (e) => { e.stopPropagation(); openButtonMenu(more, o, c.id); });
  el.append(more);
}

/** 버튼 고치기: 이름 · 넣을 내용(지금 고른 상자로 바꾸기) */
function openButtonMenu(anchor: HTMLElement, o: ButtonOpts, cid: Id): void {
  const picked = o.selected(); // 메뉴를 연 때 고른 상자 — 메뉴 안을 누르는 사이 바뀌지 않게
  popup(anchor, '버튼 고치기', (pop, again, close) => {
    const c = o.engine.getContent(cid);
    if (!isButtonContent(c)) { close(); return; }
    const name = mk('input', 'dn-db-pin');
    name.value = c.label;
    name.dataset.k = 'bname';
    name.setAttribute('aria-label', '버튼 이름');
    const save = () => { if (name.value.trim() && name.value.trim() !== c.label) setButtonLabel(o.engine, cid, name.value); };
    name.addEventListener('change', save);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { save(); close(); } });
    pop.append(mk('div', 'dn-db-mh', '버튼 이름'), name);
    sep(pop, '누르면 넣는 것');
    pop.append(mk('div', 'dn-db-hint', buttonSummary(c)));
    const others = picked.filter((id) => id !== c.blockId && o.engine.getBlock(id));
    const b = item(pop, others.length ? `지금 고른 상자 ${others.length}개로 바꾸기` : '바꾸려면 넣을 상자를 먼저 고르세요', () => {
      if (others.length && setButtonBlocks(o.engine, cid, others).ok) again();
    });
    b.disabled = !others.length;
  });
}
