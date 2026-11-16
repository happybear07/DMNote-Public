// 슬래시(/) 메뉴의 블록 색 (캔버스 · 문서 뷰 같이): 'color:red' = 이 블록 글자 색, 'bg:red' = 배경 색, 'default' = 기본으로.
// 복제 · 삭제('action:…')는 캔버스와 문서 뷰가 하는 법이 달라 호스트가 따로 한다. 처리했으면 true.
import { setBlockColor, setBlockTextStyle, type Engine, type Id } from '@dn/engine-core';

/** 블록 링크 복사 — 블록 메뉴와 같은 주소(#n=노트&b=블록). 붙여넣으면 그 블록이 임베드된다 */
export async function copyBlockLink(engine: Engine, blockId: Id): Promise<boolean> {
  try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}#n=${engine.note.id}&b=${blockId}`); return true; } catch { return false; }
}

export function slashBlockStyle(engine: Engine, blockId: Id, kind: string): boolean {
  const m = /^(color|bg):(\w+)$/.exec(kind);
  if (!m) return false;
  const v = m[2] === 'default' ? undefined : m[2];
  if (m[1] === 'color') setBlockTextStyle(engine, [blockId], { textColor: v ?? null });
  else setBlockColor(engine, [blockId], v);
  return true;
}
