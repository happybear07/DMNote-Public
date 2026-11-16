// 좁은 화면 (FR-152): 사이드바 서랍을 여는 단추 — 노트 위 막대 · 홈 · 할 일 · 노트 그래프 · 휴지통 머리에 같은 것 (넓으면 숨김, mobile.css)
import { Icon } from './Icon';

export function MenuBtn({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return <button className="menu-btn" aria-label="노트 목록 열기" title="노트 목록" aria-expanded={open} onClick={onOpen}><Icon name="menu" size={20} /></button>;
}
