// 글자 색 고르기 판 (문서 서식 막대 · 캔버스 오른쪽 클릭 › 글자): 테마 색 견본(기본 + 9, 다크 테마에 맞춰 바뀜) 아래
// "팔레트에서 더 고르기" → 색 원 격자(무채색 + 색상 10 × 밝기 5) · 최근 쓴 색 · 직접 고르기(색상 선택기 · #코드).
// 팔레트 · 직접 고른 색은 #rrggbb 그대로 저장한다(테마가 바꾸지 않음). 최근 쓴 색은 이 기기 브라우저에만.
import { useEffect, useRef, useState } from 'react';
import { normalizeTextColor, TEXT_COLOR_NAMES } from '@dn/engine-core';
import { TEXT_COLORS } from '@dn/engine-dom';
import { BG_COLOR_HEX } from '@dn/text-pm';

export const COLOR_LABEL: Record<string, string> = {
  gray: '회색', brown: '갈색', orange: '주황', yellow: '노랑', green: '초록', blue: '파랑', purple: '보라', pink: '분홍', red: '빨강',
};

/** HSL(색상 0~360, 채도 · 밝기 0~1) → #rrggbb */
function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
const HUES = [0, 24, 42, 56, 110, 160, 195, 220, 262, 318];
/** 무채색 한 줄 + 색상 10 × 밝기 5 (밝은 것 → 진한 것) */
export const PALETTE: readonly string[] = [
  ...[0, 0.2, 0.33, 0.45, 0.56, 0.67, 0.78, 0.87, 0.94, 1].map((l) => hsl(0, 0, l)),
  ...[0.84, 0.7, 0.55, 0.42, 0.3].flatMap((l) => HUES.map((h) => hsl(h, h === 56 ? 0.9 : 0.72, l))),
];

const RECENT = 'dn:recent-text-colors';
function loadRecent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!normalizeTextColor(x)?.startsWith('#')).slice(0, 10) : [];
  } catch { return []; }
}
function saveRecent(c: string): void {
  try { localStorage.setItem(RECENT, JSON.stringify([c, ...loadRecent().filter((x) => x !== c)].slice(0, 10))); } catch { /* 저장 못 해도 고르기는 된다 */ }
}

/** theme: 테마 색 견본(가 글자)도 보일지 — 캔버스 메뉴는 제 견본 줄이 있어 끈다 */
/** title: 머리 글 (고른 글자면 '고른 글자 색') · background: 고른 글자의 배경 색 줄 (노션처럼) */
export function ColorPalette({ value, onPick, theme = true, title = '글자 색', background }: {
  value: string | null; onPick: (c: string | null) => void; theme?: boolean; title?: string;
  background?: { value: string | null; onPick: (c: string | null) => void };
}) {
  const custom = !!value?.startsWith('#');
  const [more, setMore] = useState(custom);
  const [code, setCode] = useState(custom ? value! : '');
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const recent = loadRecent();
  const pickHex = (raw: string): boolean => {
    const c = normalizeTextColor(raw.trim().startsWith('#') ? raw.trim() : `#${raw.trim()}`);
    if (!c?.startsWith('#')) { setBad(true); return false; }
    setBad(false);
    saveRecent(c);
    onPick(c);
    return true;
  };
  // 색상 선택기는 끄는 동안 input이 계속 오므로, 창을 닫을 때(change) 한 번만 적용한다 — 실행 취소도 한 번
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const done = () => pickHex(el.value);
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  });
  const dot = (c: string, key: string) => (
    <button key={key} type="button" className={`cp-dot${value === c ? ' on' : ''}`} style={{ background: c }} title={c} aria-label={`글자 색 ${c}`} aria-pressed={value === c} onClick={() => pickHex(c)} />
  );
  return (
    <div className="color-palette">
      {theme && (
        <>
          <div className="cp-title">{title}</div>
          <div className="cp-theme">
            <button type="button" className={`cp-sw${!value ? ' on' : ''}`} title="기본 글자 색" aria-label="기본 글자 색" onClick={() => onPick(null)}><span style={{ color: 'var(--text)' }}>가</span><small>기본</small></button>
            {TEXT_COLOR_NAMES.map((c) => (
              <button key={c} type="button" className={`cp-sw${value === c ? ' on' : ''}`} title={`글자 색: ${COLOR_LABEL[c]}`} aria-label={`글자 색 ${COLOR_LABEL[c]}`} aria-pressed={value === c}
                onClick={() => onPick(c)}><span style={{ color: `var(--dn-tc-${c}, ${TEXT_COLORS[c]})` }}>가</span><small>{COLOR_LABEL[c]}</small></button>
            ))}
          </div>
        </>
      )}
      {background && (
        <>
          <div className="cp-title">배경 색</div>
          <div className="cp-theme">
            <button type="button" className={`cp-sw cp-bg none${!background.value ? ' on' : ''}`} title="배경 색 없음" aria-label="배경 색 없음" onClick={() => background.onPick(null)}><span>가</span><small>없음</small></button>
            {TEXT_COLOR_NAMES.map((c) => (
              <button key={c} type="button" className={`cp-sw cp-bg${background.value === c ? ' on' : ''}`} title={`배경 색: ${COLOR_LABEL[c]}`} aria-label={`배경 색 ${COLOR_LABEL[c]}`} aria-pressed={background.value === c}
                onClick={() => background.onPick(c)}><span style={{ background: `var(--dn-block-${c}, ${BG_COLOR_HEX[c]})` }}>가</span><small>{COLOR_LABEL[c]}</small></button>
            ))}
          </div>
        </>
      )}
      {recent.length > 0 && (
        <>
          <div className="cp-title">최근 쓴 색</div>
          <div className="cp-grid">{recent.map((c) => dot(c, `r${c}`))}</div>
        </>
      )}
      <button type="button" className="cp-more" aria-expanded={more} onClick={() => setMore(!more)}>
        <span className="cp-rainbow" aria-hidden="true" />{more ? '팔레트 접기' : '팔레트에서 더 고르기'}<span aria-hidden="true">{more ? '▴' : '▾'}</span>
      </button>
      {more && (
        <>
          <div className="cp-grid" role="group" aria-label="팔레트">{PALETTE.map((c) => dot(c, c))}</div>
          <div className="cp-custom">
            <label className="cp-picker" title="색상 선택기 — 원하는 색을 직접">
              <input ref={picker} type="color" defaultValue={custom ? value! : '#4c6ef5'} aria-label="색상 선택기" />
            </label>
            <input className={`cp-code${bad ? ' bad' : ''}`} value={code} placeholder="#3366ff" maxLength={7} spellCheck={false} aria-label="색 코드 (#rrggbb)" aria-invalid={bad}
              onChange={(e) => { setCode(e.target.value); setBad(false); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pickHex(code); } }} />
            <button type="button" className="cp-apply" onClick={() => pickHex(code)}>적용</button>
          </div>
        </>
      )}
    </div>
  );
}
