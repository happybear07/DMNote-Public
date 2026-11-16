// 문서 뷰 서식 막대 상태 (DocWord.ui): 커서 자리의 서식 · 상자 글자 모양 · 고른 글자 꾸밈(색 · 크기 · 글꼴).
import { isTextContent, type BlockAlign, type Engine, type Id } from '@dn/engine-core';
import { fontFamilyAt, fontSizeAt, listNumsAt, markColorAt, type FormatCommand, type ListNums, type TextEditor } from '@dn/text-pm';

export interface DocUiState {
  editing: boolean;
  kind: 'title' | 'body' | null;
  blockId: Id | null;
  /** 커서 자리의 서식 (굵게 · 제목 단계 · 목록 …) */
  active: Partial<Record<FormatCommand, boolean>>;
  fontScale: number;
  textColor: string | null;
  align: BlockAlign;
  pageBreak: boolean;
  lineHeight: number;
  indent: number;
  /** 첫 줄 들여쓰기(양수) · 내어쓰기(음수) 글자 수 · 문단 앞뒤 간격 px (없으면 0) */
  firstLine: number;
  spaceBefore: number;
  spaceAfter: number;
  /** 글자를 골랐는가 — 그러면 서식 막대의 색은 고른 글자에만 */
  sel: boolean;
  /** 고른 글자(없으면 커서 자리)의 글자 색 · 배경 색 표시 — 섞였거나 없으면 null, 기본 형광은 'default' */
  markColor: string | null;
  markBg: string | null;
  /** 고른 글자의 글자 크기 배율 (표시 없으면 1, 섞였으면 null) */
  markSize: number | null;
  /** 상자 글꼴 · 고른 글자 글꼴 (섞였으면 null) */
  fontFamily: 'sans' | 'serif' | 'mono';
  markFont: 'sans' | 'serif' | 'mono' | null;
  /** 서식 복사(붓)로 칠하는 중 — 한 번 · 계속 */
  painting: 'once' | 'sticky' | null;
  /** 커서 자리 번호 목록의 번호 모양 (번호 목록 밖이면 null) */
  listNums: ListNums | null;
}

const ACTIVE: readonly FormatCommand[] = ['strong', 'em', 'underline', 'strike', 'code', 'highlight', 'link', 'sup', 'sub', 'h1', 'h2', 'h3', 'h4', 'paragraph', 'bullet', 'ordered', 'task', 'quote', 'code_block', 'callout'];

/** 고치는 중인 칸 (없으면 null) → 서식 막대 상태 */
export function docUiState(engine: Engine, cur: { ed: TextEditor; blockId: Id; contentId: Id } | null, painting: 'once' | 'sticky' | null = null): DocUiState {
  const e = engine;
  const b = cur ? e.getBlock(cur.blockId) : undefined;
  const c = cur ? e.getContent(cur.contentId) : undefined;
  const active: Partial<Record<FormatCommand, boolean>> = {};
  if (cur) for (const k of ACTIVE) if (cur.ed.isActive(k)) active[k] = true;
  return {
    editing: !!cur, kind: c && isTextContent(c) ? (c.role === 'title' ? 'title' : 'body') : null, blockId: cur?.blockId ?? null,
    active, fontScale: b?.fontScale ?? 1, textColor: b?.textColor ?? null, align: b?.align ?? 'left', pageBreak: !!b?.pageBreak,
    lineHeight: b?.lineHeight ?? 1, indent: b?.indent ?? 0, firstLine: b?.firstLine ?? 0, spaceBefore: b?.spaceBefore ?? 0, spaceAfter: b?.spaceAfter ?? 0,
    sel: !!cur && !cur.ed.view.state.selection.empty,
    markColor: cur ? markColorAt(cur.ed.view.state, 'textColor') : null, markBg: cur ? markColorAt(cur.ed.view.state, 'bgColor') : null,
    markSize: cur ? fontSizeAt(cur.ed.view.state) : 1,
    fontFamily: b?.fontFamily ?? 'sans', markFont: cur ? fontFamilyAt(cur.ed.view.state) : 'sans', painting,
    listNums: cur ? listNumsAt(cur.ed.view.state) : null,
  };
}
