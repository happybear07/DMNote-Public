// 쪽 설정 판 (워드 레이아웃 › 여백 · 방향, 삽입 › 머리글 · 바닥글 · 쪽 번호) — 문서 서식 막대의 '쪽 설정' 단추가 연다.
// 바꾸면 바로 노트에 저장(실행 취소 한 번)하고, 쪽 보기가 꺼져 있으면 켠다. 머리글 · 바닥글 글은 Enter · 칸을 떠날 때 저장.
import { useEffect, useRef, useState } from 'react';
import { PAGE_MARGINS, PAGE_NUMBER_POS, PAGE_TOKENS, setPageSetup, type PageMargin, type PageNumberPos, type PageSetup } from '@dn/engine-core';
import type { Workspace } from './workspace';

export function PageSetupPanel({ ws }: { ws: Workspace }) {
  const engine = ws.view?.engine;
  const [ps, setPs] = useState<PageSetup>(() => engine?.note.pageSetup ?? {});
  const [text, setText] = useState({ header: ps.header ?? '', footer: ps.footer ?? '' });
  const pending = useRef(text);
  pending.current = text;
  const apply = (patch: PageSetup) => {
    if (!engine) return;
    setPageSetup(engine, patch);
    setPs(engine.note.pageSetup ?? {});
    if (!ws.state.docPages) ws.setDocPages(true); // 바꾼 모양이 보이게
  };
  const commit = (k: 'header' | 'footer') => { if ((engine?.note.pageSetup?.[k] ?? '') !== pending.current[k].trim()) apply({ [k]: pending.current[k] }); };
  // 판을 닫을 때 (Esc · 바깥 누르기) 고치던 글도 저장
  useEffect(() => () => { commit('header'); commit('footer'); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" role="menuitemradio" aria-checked={on} className={`rb-chip${on ? ' on' : ''}`} onClick={onClick}>{label}</button>
  );
  const field = (k: 'header' | 'footer', label: string, hint: string) => (
    <label className="rb-ps-field"><span>{label}</span>
      <input value={text[k]} placeholder={hint} aria-label={label} maxLength={200}
        onChange={(e) => setText({ ...text, [k]: e.target.value })} onBlur={() => commit(k)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(k); } }} />
    </label>
  );
  return (
    <div className="rb-page-setup">
      <div className="rb-pop-title">방향</div>
      <div className="rb-chips">
        {chip(!ps.landscape, '세로', () => apply({ landscape: false }))}
        {chip(!!ps.landscape, '가로', () => apply({ landscape: true }))}
      </div>
      <div className="rb-pop-title rb-pop-sub">여백</div>
      <div className="rb-chips">
        {(Object.keys(PAGE_MARGINS) as PageMargin[]).map((m) => chip((ps.margin ?? 'normal') === m, PAGE_MARGINS[m].label, () => apply({ margin: m })))}
      </div>
      <div className="rb-pop-title rb-pop-sub">쪽 번호</div>
      <div className="rb-chips">
        {(Object.keys(PAGE_NUMBER_POS) as PageNumberPos[]).map((p) => chip((ps.numbers ?? 'bottom-center') === p, PAGE_NUMBER_POS[p], () => apply({ numbers: p })))}
      </div>
      <div className="rb-pop-title rb-pop-sub">머리글 · 바닥글</div>
      {field('header', '머리글', '예: {제목}')}
      {field('footer', '바닥글', '예: {날짜}')}
      <label className="rb-ps-check"><input type="checkbox" checked={!!ps.skipFirst} onChange={(e) => apply({ skipFirst: e.target.checked })} /> 첫 쪽(표지)에는 안 보이기</label>
      <div className="rb-ps-hint">{PAGE_TOKENS.join(' · ')}를 넣으면 쪽마다 바뀌어 들어가요</div>
    </div>
  );
}
