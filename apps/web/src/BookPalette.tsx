// 책 표지 색 고르기 (11/11): 무광 천 8색 + 기본(자동) — 서재 폴더 색 칸 · 책 우클릭 '표지 색' · 노트 설정 판이 같이 쓴다.
import type { CSSProperties } from 'react';
import { BOOK_PALETTE } from './book-colors';

interface Props {
  /** 지금 고른 색 이름 (없으면 기본) */
  value?: string;
  onPick: (key: string | null) => void;
  /** 기본 단추 글 — '기본 색'(폴더) · '폴더 색 따르기'(노트) */
  autoLabel: string;
  /** inline: 판 안에 그대로(노트 설정) · 아니면 떠 있는 판 */
  inline?: boolean;
  style?: CSSProperties;
}

export function BookPalette({ value, onPick, autoLabel, inline, style }: Props) {
  return (
    <div className={`lib-palette${inline ? ' inline' : ''}`} role="menu" aria-label="책 표지 색" style={style}>
      {BOOK_PALETTE.map((c) => (
        <button key={c.key} type="button" role="menuitemradio" aria-checked={value === c.key} className={value === c.key ? 'on' : ''}
          style={{ background: c.bg }} title={c.name} aria-label={c.name} onClick={() => onPick(c.key)} />
      ))}
      <button type="button" role="menuitemradio" aria-checked={!value} className={`auto${value ? '' : ' on-auto'}`} onClick={() => onPick(null)}>{autoLabel}</button>
    </div>
  );
}
