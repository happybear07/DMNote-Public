// 문서 뷰 아래 상태 줄 (워드의 상태 표시줄): 왼쪽은 글자 수 · 낱말 수 — 글을 골랐으면 '고른 범위 / 전체',
// 오른쪽은 확대 — －  배율  ＋ · 쪽 너비 · 한 쪽 (Ctrl+휠도). 셈은 노트 정보(FR-071 noteStats)와 같다: 글자는 공백 제외, 낱말은 띄어쓰기로.
import { useEffect, useState, type RefObject } from 'react';
import type { Engine } from '@dn/engine-core';
import { stepDocZoom, type DocZoom } from '@dn/engine-dom';
import type { Workspace } from './workspace';
import { noteStats, textCount } from './ws-model';
import { Icon } from './Icon';

const fmt = (n: number) => n.toLocaleString('ko-KR');

/** 문서 안에서 고른 글 (편집기 안 · 여러 칸에 걸친 범위 모두 브라우저 선택으로 보인다) — 없으면 null */
function pickedIn(host: HTMLElement | null): { chars: number; words: number } | null {
  const s = window.getSelection();
  if (!host || !s || s.isCollapsed || !s.anchorNode || !host.contains(s.anchorNode)) return null;
  const c = textCount(s.toString());
  return c.chars ? c : null;
}

export function DocStatus({ ws, engine, host, zoom, now, pages }: {
  ws: Workspace; engine: Engine | null; host: RefObject<HTMLElement | null>;
  /** 정한 확대(배율 · 쪽 너비 · 한 쪽) · 지금 배율 · 쪽 보기인가(맞춤 단추) */
  zoom: DocZoom; now: number; pages: boolean;
}) {
  const [all, setAll] = useState(() => (engine ? noteStats(engine) : null));
  const [picked, setPicked] = useState<{ chars: number; words: number } | null>(null);
  useEffect(() => {
    if (!engine) { setAll(null); return; }
    let t: ReturnType<typeof setTimeout> | null = null;
    const run = () => { t = null; setAll(noteStats(engine)); };
    run();
    const off = engine.subscribe(() => { if (!t) t = setTimeout(run, 250); });
    return () => { off(); if (t) clearTimeout(t); };
  }, [engine]);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const p = pickedIn(host.current);
        setPicked((old) => (old?.chars === p?.chars && old?.words === p?.words ? old : p));
      });
    };
    document.addEventListener('selectionchange', on);
    return () => { document.removeEventListener('selectionchange', on); cancelAnimationFrame(raf); };
  }, [host]);
  // Ctrl+휠: 문서 확대 · 축소 (브라우저 확대 대신) · 맞춤이면 칸 크기가 바뀔 때(창 · 사이드바) 다시 맞춘다
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      ws.setDocZoom(stepDocZoom(ws.state.docZoomNow, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    let w = el.clientWidth, h = el.clientHeight;
    // 스크롤 막대가 생기고 없어지는 정도(24px 안)는 무시 — 맞춤 ↔ 막대가 서로 부르며 흔들리지 않게
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (typeof ws.state.docZoom === 'number' || (Math.abs(el.clientWidth - w) < 24 && Math.abs(el.clientHeight - h) < 24)) return;
      w = el.clientWidth; h = el.clientHeight;
      ws.syncDocZoom();
    }) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('wheel', wheel); ro?.disconnect(); };
  }, [ws, host]);
  if (!all) return null;
  const pct = `${Math.round(now * 100)}%`;
  return (
    <div className="doc-status" role="status" aria-label="문서 상태">
      <span className="ds-count" title="글자 수는 공백 제외 · 낱말은 띄어쓰기로 나눈 수">
        {picked
          ? <>글자 {fmt(picked.chars)} / {fmt(all.chars)} · 낱말 {fmt(picked.words)} / {fmt(all.words)}</>
          : <>글자 {fmt(all.chars)} · 낱말 {fmt(all.words)}</>}
      </span>
      <span className="ds-zoom" role="group" aria-label="확대" onMouseDown={(e) => e.preventDefault() /* 고치던 글의 초점은 그대로 */}>
        <button type="button" aria-label="축소" title="축소 (Ctrl+휠)" onClick={() => ws.setDocZoom(stepDocZoom(now, -1))}><Icon name="minus" size={12} /></button>
        <button type="button" className="ds-pct" title="100%로" aria-label={`배율 ${pct} — 100%로`} onClick={() => ws.setDocZoom(1)}>{pct}</button>
        <button type="button" aria-label="확대" title="확대 (Ctrl+휠)" onClick={() => ws.setDocZoom(stepDocZoom(now, 1))}><Icon name="plus" size={12} /></button>
        {pages && <>
          <button type="button" className={zoom === 'width' ? 'on' : ''} aria-pressed={zoom === 'width'} title="종이 너비를 창에 맞춤" onClick={() => ws.setDocZoom('width')}>쪽 너비</button>
          <button type="button" className={zoom === 'page' ? 'on' : ''} aria-pressed={zoom === 'page'} title="한 쪽이 다 보이게" onClick={() => ws.setDocZoom('page')}>한 쪽</button>
        </>}
      </span>
    </div>
  );
}
