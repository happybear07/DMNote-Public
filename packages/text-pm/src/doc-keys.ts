// 문서 뷰를 워드처럼 (FR-088): 글 상자 경계를 넘는 키 · 나누기 · 합치기 · 워드 단축키.
// 상자마다 에디터가 따로라, 상자 끝에서 ↑↓←→ · Backspace · Delete · Enter를 호스트(문서 뷰)에 넘겨 다음 상자로 이어 준다.
// 합치기 스텝(appendDocSteps)은 DOM 없이 계산 — 열려 있지 않은 앞 상자에 뒤 상자 글을 붙일 때.
import type { TextDoc } from '@dn/engine-core';
import { canJoin } from 'prosemirror-transform';
import { keymap } from 'prosemirror-keymap';
import { EditorState, Selection, type Command, type Plugin } from 'prosemirror-state';
import { toJSON, toNode } from './codec';
import { formatCommand } from './commands';

export type DocAlign = 'left' | 'center' | 'right' | 'justify';

export interface DocKeyHost {
  /** 상자 밖으로 커서 — 옮겼으면 true. x: 지금 커서의 화면 x (↑↓에서 같은 세로줄로) */
  move(dir: 'up' | 'down' | 'left' | 'right', x: number): boolean;
  /** 이 자리에서 상자 나누기 — cut: 이 상자에서 뒤쪽을 지우는 스텝, tail: 새 상자로 갈 뒤 글. pageBreak면 새 상자부터 새 쪽 */
  split(cut: unknown[], tail: TextDoc, pageBreak: boolean): void;
  /** 이 상자부터 새 쪽 (상자 맨 앞에서 Ctrl+Enter) */
  breakBefore(): void;
  /** 맨 앞 Backspace → 앞 상자와, 맨 끝 Delete → 다음 상자와 합치기. 처리했으면 true */
  merge(dir: 'prev' | 'next'): boolean;
  align(a: DocAlign): void;
  fontStep(d: 1 | -1): void;
  /** 목록 밖 Tab · Shift+Tab — 상자 들여쓰기 한 단계. 더 내어 쓸 수 없으면 false */
  indent(d: 1 | -1): boolean;
  /** Ctrl+S — 자동 저장이라 브라우저 저장 창 대신 알림만 */
  save(): void;
  /** 서식 복사 (워드 붓): 지금 서식 담기 · 담아 둔 서식 입히기 (Ctrl+Alt+C · V) */
  copyFormat(): void;
  pasteFormat(): boolean;
}

const MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|[oa]d)/.test(navigator.platform);
const EMPTY: TextDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/** 커서가 문서 맨 앞 · 맨 끝인가 (글자 위치 기준 — 목록 · 인용 안이면 그 안의 맨 앞) */
const atStart = (s: EditorState) => s.selection.empty && s.selection.head === Selection.atStart(s.doc).head;
const atEnd = (s: EditorState) => s.selection.empty && s.selection.head === Selection.atEnd(s.doc).head;
/** 맨 위 단계 문단 · 제목 안인가 (목록 · 인용 · 토글 안이면 그 구조의 원래 키 동작이 먼저) */
const topLevel = (s: EditorState) => s.selection.$head.depth === 1;

/** 커서 뒤(또는 at부터)를 떼어 낼 스텝과 떼어 낸 글 */
export function cutAfter(state: EditorState, at: number): { cut: unknown[]; tail: TextDoc } {
  const end = state.doc.content.size;
  const tail = toJSON(state.doc.cut(at, end));
  const tr = state.tr.delete(at, end);
  const blank = !tail.content?.length || (tail.content.length === 1 && !tail.content[0]!.content?.length && tail.content[0]!.type === 'paragraph');
  return { cut: tr.steps.map((x) => x.toJSON()), tail: blank ? EMPTY : tail };
}

/**
 * 글 있는 상자의 맨 위 단계 빈 줄에 커서가 있으면: 그 빈 줄부터 끝까지 떼는 스텝과 빈 줄 뒤 글(없으면 빈 문서) — 그 자리에서 상자를 나누고
 * 빈 줄은 없앤다 (빈 줄 Enter · 빈 줄에서 블록 넣기). 아니면 null
 */
export function blankLineCut(s: EditorState): { cut: unknown[]; tail: TextDoc } | null {
  const $h = s.selection.$head;
  if (!s.selection.empty || !topLevel(s) || $h.parent.type.name !== 'paragraph' || $h.parent.content.size || s.doc.childCount < 2) return null;
  const { tail } = cutAfter(s, $h.after());
  return { cut: s.tr.delete($h.before(), s.doc.content.size).steps.map((t) => t.toJSON()), tail };
}

/** into 끝에 from 글을 붙이는 스텝 — 맞닿은 두 문단은 한 문단으로 (워드의 Backspace). caret: 이은 자리 */
export function appendDocSteps(into: TextDoc, from: TextDoc): { steps: unknown[]; caret: number } {
  const state = EditorState.create({ doc: toNode(into) });
  const end = state.doc.content.size;
  const tr = state.tr.insert(end, toNode(from).content);
  const caret = Selection.atEnd(state.doc).head;
  if (canJoin(tr.doc, end)) tr.join(end);
  return { steps: tr.steps.map((x) => x.toJSON()), caret };
}

/** 문서 뷰 키맵 — 에디터 키맵보다 먼저 (슬래시 · 링크 메뉴보다는 뒤) */
export function docKeymap(host: DocKeyHost, mode: 'title' | 'body'): Plugin {
  const x = (view: { coordsAtPos(p: number): { left: number } }, s: EditorState) => view.coordsAtPos(s.selection.head).left;
  const vertical = (dir: 'up' | 'down'): Command => (s, _d, view) => {
    if (!view || !s.selection.empty || !view.endOfTextblock(dir)) return false;
    const edge = dir === 'up' ? Selection.atStart(s.doc) : Selection.atEnd(s.doc);
    if (s.selection.$head.parent !== edge.$head.parent) return false; // 첫 · 마지막 글줄 덩어리에서만
    return host.move(dir, x(view, s));
  };
  const side = (dir: 'left' | 'right'): Command => (s, _d, view) => !!view && (dir === 'left' ? atStart(s) : atEnd(s)) && host.move(dir, x(view, s));
  const enter: Command = (s) => {
    if (!s.selection.empty) return false;
    const $h = s.selection.$head;
    if (mode === 'title') { const { cut, tail } = cutAfter(s, $h.pos); host.split(cut, tail, false); return true; }
    // 빈 줄에서 Enter (= Enter 두 번) → 그 자리에서 상자 나누기. 빈 줄은 없앤다
    const line = blankLineCut(s);
    if (!line) return false;
    host.split(line.cut, line.tail, false);
    return true;
  };
  const pageBreak: Command = (s) => {
    if (!s.selection.empty) return false;
    // 할 일 항목 안이면 편집기의 체크(Ctrl+Enter)에 맡긴다 — 캔버스와 같은 키 (DQ-032)
    for (let d = s.selection.$head.depth; d > 0; d--) if (s.selection.$head.node(d).type.name === 'task_item') return false;
    if (atStart(s)) { host.breakBefore(); return true; }
    const { cut, tail } = cutAfter(s, s.selection.head);
    host.split(cut, tail, true);
    return true;
  };
  const run = (f: () => void): Command => () => { f(); return true; };
  return keymap({
    ArrowUp: vertical('up'), ArrowDown: vertical('down'), ArrowLeft: side('left'), ArrowRight: side('right'),
    Backspace: (s) => atStart(s) && (mode === 'title' || topLevel(s)) && host.merge('prev'),
    Delete: (s) => atEnd(s) && (mode === 'title' || topLevel(s)) && host.merge('next'),
    Enter: enter,
    'Mod-Enter': pageBreak,
    // 워드 단축키: 정렬 Ctrl+L · E · R · J, 글머리 목록 Ctrl+Shift+L, 글자 크기 Ctrl+] · [ (Ctrl+Shift+> · <), 저장 Ctrl+S
    'Mod-l': run(() => host.align('left')), 'Mod-e': run(() => host.align('center')), 'Mod-r': run(() => host.align('right')), 'Mod-j': run(() => host.align('justify')),
    'Mod-Shift-l': mode === 'body' ? formatCommand('bullet')! : () => false,
    'Mod-]': run(() => host.fontStep(1)), 'Mod-[': run(() => host.fontStep(-1)),
    'Mod->': run(() => host.fontStep(1)), 'Mod-<': run(() => host.fontStep(-1)),
    'Mod-s': run(() => host.save()),
    // 서식 복사 · 붙여넣기 (워드의 Ctrl+Shift+C · V는 브라우저 개발자 도구 · 서식 없이 붙여넣기라 Alt로)
    'Mod-Alt-c': run(() => host.copyFormat()), 'Mod-Alt-v': () => host.pasteFormat(),
    // 들여쓰기: 목록 안은 항목 단계, 밖은 상자 들여쓰기 · 위/아래 첨자 Ctrl+. · Ctrl+, · 서식 지우기 Ctrl+역슬래시
    Tab:(s, d, v) => formatCommand('indent')!(s, d, v) || host.indent(1),
    'Shift-Tab': (s, d, v) => formatCommand('outdent')!(s, d, v) || host.indent(-1),
    'Mod-.': formatCommand('sup')!, 'Mod-,': formatCommand('sub')!, 'Mod-\\': formatCommand('clear')!,
    // 인라인 수식 — Ctrl+E(가운데 맞춤)보다 먼저: ProseMirror는 Shift 붙은 키가 없으면 Shift를 뗀 키로 다시 찾는다
    'Mod-Shift-e': formatCommand('mathInline')!,
    // 워드 별칭: 들여쓰기 Ctrl+M · 내어쓰기 Ctrl+Shift+M(브라우저가 먼저 가져가면 Shift+Tab), 서식 지우기 Ctrl+Space,
    // 수식 Alt+= (맥은 Option+=가 '≠' 입력이라 뺀다). Ctrl+1 · 2 · 5 · T는 브라우저 탭 키라 두지 않는다
    'Mod-m': (s, d, v) => formatCommand('indent')!(s, d, v) || host.indent(1),
    'Mod-Shift-m': (s, d, v) => formatCommand('outdent')!(s, d, v) || host.indent(-1),
    'Ctrl-Space': formatCommand('clear')!,
    ...(MAC ? {} : { 'Alt-=': formatCommand('mathInline')! }),
  });
}
