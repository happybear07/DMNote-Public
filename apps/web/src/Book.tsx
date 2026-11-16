// 서재 책 한 권 (11/10): 노트 = 무광 천 표지 공책 — 왼쪽 위 박은 제목 · 오른쪽 고무 밴드 · 아래 폴더 이름, 색 = 폴더(book-colors.ts).
// 표지 쪽을 꾸민 노트(coverThumb)는 그 그림이 표지 가득(왼쪽에 폴더 색 책등) — 제목은 올렸을 때 아래 띠로(그림에 이미 글씨가 있을 수 있어).
// 잠긴 노트는 꾸민 표지도 보이지 않게 천 표지 + 자물쇠. 사용자가 정한 노트 아이콘만 오른쪽 위에 작게(기본 문서 아이콘은 넣지 않음).
import type { CSSProperties, MouseEvent } from 'react';
import type { NoteMeta } from '@dn/storage-idb';
import type { BookColor } from './book-colors';
import { Icon } from './Icon';
import { NoteGlyph } from './NoteLook';
import { displayTitle } from './workspace';

interface Props {
  n: NoteMeta; color: BookColor;
  /** 표지 아래 작은 글 (폴더 이름) */
  foot?: string;
  big?: boolean;
  /** el: 누른 책 — 펼치기 전환의 시작 자리 (book-zoom.ts) */
  onOpen: (id: string, el: HTMLElement) => void;
  onMenu?: (e: MouseEvent, n: NoteMeta) => void;
}

export function Book({ n, color, foot, big, onOpen, onMenu }: Props) {
  const title = displayTitle(n);
  const face = !!n.coverThumb && !n.locked;
  return (
    <button className={`book${face ? ' has-face' : ''}${big ? ' big' : ''}${color.light ? ' light' : ''}`} style={{ '--bk': color.bg, '--bk-ink': color.ink } as CSSProperties}
      title={title} aria-label={`${title}${n.locked ? ' · 잠김' : ''}${foot ? ` · ${foot}` : ''}`} data-id={n.id}
      onClick={(e) => onOpen(n.id, e.currentTarget)} onContextMenu={onMenu ? (e) => onMenu(e, n) : undefined}>
      {face ? (
        <>
          <img className="book-face" src={n.coverThumb} alt="" draggable={false} />
          <span className="book-strip">{title}</span>
        </>
      ) : (
        <>
          <span className="book-title">{title}</span>
          {(n.locked || n.icon) && <span className="book-mark" aria-hidden>{n.locked ? <Icon name="eyeOff" size={14} /> : <NoteGlyph icon={n.icon} size={14} />}</span>}
          {foot && <span className="book-foot">{foot}</span>}
          <span className="book-band" aria-hidden />
        </>
      )}
    </button>
  );
}
