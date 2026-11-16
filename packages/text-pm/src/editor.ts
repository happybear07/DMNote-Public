// 블록 안 리치 텍스트 에디터 (FR-007 · FR-026~028 · FR-032~033).
// - 에디터 자체 history는 쓰지 않는다. Ctrl+Z는 엔진 undo로 보낸다 (단일 undo 스택, ENGINE 5.6).
// - 사용자 입력 트랜잭션의 스텝을 그대로 엔진에 넘기고, 엔진 쪽 변경(undo · redo · 원격)은 setDoc으로 받는다.
// 명령은 commands.ts, 키맵은 editor-keys.ts, 입력 규칙은 input-rules.ts, 플러그인은 plugins.ts, NodeView는 node-views.ts, 툴바는 bubble.ts.
import type { TextDoc } from '@dn/engine-core';
import type { MarkType } from 'prosemirror-model';
import { EditorState, Selection, TextSelection, type Plugin, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { toJSON, toNode } from './codec';
import { splitTables, type PastedTable } from './paste';
import { pasteParsers } from './editor-paste';
import { editorPlugins } from './editor-keys';
import { mediaSeek, safeHref, schema } from './schema';
import type { FormatCommand } from './format';
import type { PopupMenu } from './menu';
import { SlashMenu } from './slash';
import { NoteLinkMenu, NoteLinkView, type NoteLinkHost } from './note-link';
import { pasteLink, PasteUrlMenu } from './paste-url';
import { EmojiMenu } from './emoji-menu';
import { SymbolPicker, type SymbolKind } from './symbol-picker';
import { DateView } from './date-view';
import { Bubble } from './bubble';
import { formatActive, formatCommand } from './commands';
import { CalloutView, CodeBlockView, TaskItemView, ToggleView } from './node-views';
import { MathView } from './math';
import { FootnoteView } from './footnote';
import { XrefPicker, XrefView, type XrefHost } from './xref';

export { commandSteps, flipAttrSteps, formatSteps, moveLineSteps } from './commands';
export type { FormatCommand };

const EXTERNAL = 'dn-external';
/** 브라우저 맞춤법 검사 (설정 › 편집, 기본 켬 — 워드처럼 틀린 낱말에 빨간 밑줄) */
let spellcheckOn = true;
export function setSpellcheck(on: boolean): void {
  spellcheckOn = on;
  for (const el of document.querySelectorAll('.dn-text-editing')) el.setAttribute('spellcheck', String(on));
}
const S = schema;
const M = S.marks as Record<string, MarkType>;

/** title: 제목 상자 — 한 줄, 서식은 글자 서식만, Enter는 다음 칸 · 편집 끝. body: 내용 상자 — 리치 텍스트 */
export type EditorMode = 'title' | 'body';

export interface TextEditorOptions {
  /** 에디터가 들어갈 요소 (기존 자식은 비운다) */
  mount: HTMLElement;
  mode?: EditorMode;
  /** 제목 상자에서 Enter · ↓(끝에서) · Tab → 다음 칸 (없으면 편집 끝) */
  onExitNext?(): void;
  /** 내용 맨 앞에서 ↑ · Backspace · Shift+Tab → 이전 칸 (옛 데이터에서 한 블록에 칸이 여럿일 때) */
  onExitPrev?(): void;
  doc: TextDoc;
  /** 서식 툴바를 띄울 요소 (캔버스 루트, position: relative) */
  overlay: HTMLElement;
  onSteps(steps: unknown[]): void;
  onUndo(): void;
  onRedo(): void;
  onEscape(): void;
  /** 선택한 글을 새 블록으로 분리 (FR-017). 없으면 툴바에 버튼을 두지 않는다. */
  onExtract?(e: { doc: TextDoc; steps: unknown[]; at: { clientX: number; clientY: number } }): void;
  /** 고른 글로 새 상자 — 원문은 그대로, 호스트가 원문 연결을 남긴다(원문에서 상자 만들기). 없으면 말풍선에 단추를 두지 않는다 */
  onCopyOut?(e: { doc: TextDoc; from: number; to: number }): void;
  /** 고른 글에 댓글 (FR-132): 고른 글을 넘기면 호스트가 표시 id를 돌려준다(그만두면 null). 표시는 에디터가 단다 */
  onComment?(e: { quote: string; at: { clientX: number; clientY: number } }): string | null;
  /** 고른 글 AI 편집 (FR-112): 고른 범위(없으면 상자 전체) · 그때 문서 · 띄울 자리. 없으면 서식 툴바에 AI 단추 · Ctrl+J를 두지 않는다 */
  onAiEdit?(e: { from: number; to: number; doc: TextDoc; at: { clientX: number; clientY: number } }): void;
  /** 붙여넣은 HTML에서 실행될 수 있는 코드를 뺐을 때 (MSG-PASTE-001) */
  onPasteScrubbed?(): void;
  /** 이미지만 붙여넣음 (스크린샷 등) — 글 안이 아니라 이 블록 아래 이미지 블록으로 (FR-031) */
  onPasteImages?(files: File[]): void;
  /** 붙여넣은 HTML의 표 — 나머지 글은 여기에, 표는 이 블록 아래 표 블록으로 (FR-031) */
  onPasteTables?(tables: PastedTable[]): void;
  /** 슬래시 메뉴의 'AI로 구조화하기' (FR-029 · FR-105). 없으면 메뉴에 항목을 두지 않는다. */
  onSlashAi?(): void;
  /** 슬래시 메뉴의 블록 넣기 (데이터베이스 등) */
  onSlashInsert?(kind: string): void;
  /** 빈 줄에 붙여넣은 주소 › 북마크 · 임베드 (FR-050) — 그 줄의 주소는 에디터가 지웠다. 없으면 고르기 메뉴를 띄우지 않는다 */
  onPasteUrl?(e: { url: string; view: 'bookmark' | 'embed' }): void;
  /** 붙여넣기 › 언급의 사이트 제목 모으기 (웹 북마크와 같은 길). 없으면 칩은 사이트 주소만 */
  unfurl?(url: string): Promise<{ title?: string; site?: string } | null>;
  /** 노트 링크 '[[' · '@' (FR-080). 없으면 링크 메뉴를 띄우지 않는다. */
  noteLinks?: NoteLinkHost;
  /** 상호 참조 (/상호 참조): 캡션 단 그림 · 표 고르기 · 그리로 가기. 없으면 메뉴에 항목을 두지 않는다 */
  xrefs?: XrefHost;
  /** 처음 커서 위치: 화면 좌표(더블클릭 지점) · 문서 안 위치 · 처음 · 끝 */
  at?: { clientX: number; clientY: number } | { pos: number } | 'start' | 'end';
  /** 호스트 키 (문서 뷰: 상자 경계 넘기 · 나누기 · 합치기 · 워드 단축키, doc-keys.ts) — 기본 키맵보다 먼저 */
  keys?: Plugin;
  /** 입력 · 커서 이동마다 (문서 뷰 서식 막대의 켜짐 표시) */
  onUpdate?(): void;
  /** 제목 모드 자리표시 (기본 '제목', 표 칸은 '') */
  placeholder?: string;
}

export class TextEditor {
  private plainPaste = false;
  readonly view: EditorView;
  private readonly bubble: Bubble;
  /** 고르기 메뉴 (슬래시 · 노트 링크 · 붙여넣은 주소 · 이모지) — 열려 있으면 이 차례로 키를 먼저 받는다 */
  private menus: PopupMenu<unknown>[] = [];
  private pasteUrl: PasteUrlMenu | null = null;
  private picker: SymbolPicker | XrefPicker | null = null;
  /** 링크 입력처럼 포커스가 잠시 나가도 편집을 끝내지 않아야 할 때 */
  busy = false;

  constructor(private readonly opts: TextEditorOptions) {
    opts.mount.replaceChildren();
    const plugins = editorPlugins(opts, this.mode, { menuKey: (e) => this.menus.some((m) => m.onKey(e)), promptLink: () => this.promptLink(), aiEdit: () => this.aiSelection() });
    const state = EditorState.create({ doc: toNode(opts.doc), plugins });
    this.view = new EditorView(opts.mount, {
      state,
      dispatchTransaction: (tr) => this.dispatch(tr),
      nodeViews: {
        task_item: (node, view, getPos) => new TaskItemView(node, view, getPos),
        code_block: (node, view, getPos) => new CodeBlockView(node, view, getPos),
        toggle: (node, view, getPos) => new ToggleView(node, view, getPos),
        callout: (node, view, getPos) => new CalloutView(node, view, getPos, opts.overlay),
        math_inline: (node, view, getPos) => new MathView(node, view, getPos, opts.overlay),
        footnote: (node, view, getPos) => new FootnoteView(node, view, getPos, opts.overlay),
        math_block: (node, view, getPos) => new MathView(node, view, getPos, opts.overlay),
        note_link: (node) => new NoteLinkView(node, opts.noteLinks ? (id) => opts.noteLinks!.open(id) : undefined),
        date_mention: (node, view, getPos) => new DateView(node, view, getPos),
        xref: (node) => new XrefView(node, opts.xrefs ? (id) => opts.xrefs!.open(id) : undefined),
      },
      attributes: () => ({ class: 'dn-text dn-text-editing', spellcheck: String(spellcheckOn) }),
      handleDOMEvents: {
        blur: () => { this.bubble.hide(); for (const m of this.menus) m.close(); return false; },
        // Ctrl+Shift+V (서식 없이)면 표 · 이미지를 따로 만들지 않는다
        keydown: (v, e) => {
          this.plainPaste = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v';
          if (e.ctrlKey || e.metaKey || SYNC_KEYS.has(e.key)) syncDomSelection(v); // 단축키 · 나누기 · 지우기 · 화살표는 지금 화면의 커서 · 고른 범위에 (DQ-027)
          return false;
        },
        // Ctrl/⌘+클릭 — 웹 링크를 새 탭에서 (FR-030). 그냥 클릭은 커서 놓기 — 링크 언급 칩은 노트 링크처럼 그냥 눌러도
        click: (_v, e) => {
          const mt = (e.target as Element | null)?.closest?.('.dn-media-time') as HTMLElement | null; // 녹음 재생 시각 (FR-044)
          if (mt) { e.preventDefault(); mediaSeek(mt); return true; }
          const a = (e.target as Element | null)?.closest?.('a[href]:not(.dn-note-link)') as HTMLAnchorElement | null;
          if (!a || !(e.ctrlKey || e.metaKey || a.classList.contains('dn-link-mention')) || !safeHref(a.href)) return false;
          e.preventDefault();
          window.open(a.href, '_blank', 'noopener,noreferrer');
          return true;
        },
      },
      // URL만 붙여넣으면 링크로 — 글을 고른 채면 그 글에 링크를 건다 (FR-030)
      handlePaste: (view, e) => {
        const cb = e.clipboardData, plain = this.plainPaste;
        this.plainPaste = false;
        const images = [...(cb?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (images.length && !cb?.getData('text/plain').trim() && opts.onPasteImages) { e.preventDefault(); opts.onPasteImages(images); return true; }
        const split = !plain && this.mode === 'body' && opts.onPasteTables && !view.state.selection.$from.parent.type.spec.code ? splitTables(cb?.getData('text/html') ?? '') : null;
        if (split) {
          e.preventDefault();
          if (split.html.replace(/<[^>]*>/g, '').trim()) view.pasteHTML(split.html);
          opts.onPasteTables!(split.tables);
          return true;
        }
        return pasteLink(view, cb?.getData('text/plain')?.trim() ?? '', this.pasteUrl);
      },
      // 붙여넣기 (FR-031): HTML 걷어 내기 · 제목은 한 줄 · 글은 마크다운이면 변환 (editor-paste.ts)
      ...pasteParsers(() => this.mode, opts.onPasteScrubbed),
    });
    this.bubble = new Bubble(this, opts.overlay);
    const body = this.mode === 'body';
    const slash = new SlashMenu(this.view, opts.overlay, { onAi: opts.onSlashAi, onInsert: opts.onSlashInsert, noteLinks: opts.noteLinks, mode: this.mode, run: (cmd) => { if (!this.isActive(cmd)) this.exec(cmd); }, symbols: (k) => this.openSymbols(k), xref: !!opts.xrefs });
    const emoji = new EmojiMenu(this.view, opts.overlay); // ':' 이모지
    const links = body && opts.noteLinks ? new NoteLinkMenu(this.view, opts.overlay, opts.noteLinks) : null;
    if (body && opts.onPasteUrl) this.pasteUrl = new PasteUrlMenu(this.view, opts.overlay, opts.onPasteUrl, opts.unfurl ? (u) => opts.unfurl!(u) : undefined);
    this.menus = [slash, links, this.pasteUrl, emoji].filter((m) => !!m);
    this.placeCursor(opts.at ?? 'end');
  }

  get mode(): EditorMode { return this.opts.mode ?? 'body'; }

  /** Ctrl+K: 고른 글에 링크 (툴바와 같은 창). 고른 글이 없으면 주소를 그대로 링크 글자로 넣는다 */
  promptLink(): void {
    if (!this.view.state.selection.empty) { this.bubble.promptLink(); return; }
    this.busy = true;
    const href = window.prompt('링크 주소 (https://…)', 'https://');
    this.busy = false;
    if (href && href !== 'https://' && safeHref(href)) {
      const { state } = this.view;
      this.view.dispatch(state.tr.replaceSelectionWith(S.text(href.trim(), [M.link!.create({ href: href.trim() })]), false));
    }
    this.view.focus();
  }

  private dispatch(tr: Transaction): void {
    const state = this.view.state.apply(tr);
    this.view.updateState(state);
    if (tr.docChanged && !tr.getMeta(EXTERNAL)) this.opts.onSteps(tr.steps.map((s) => s.toJSON()));
    this.bubble.update();
    for (const m of this.menus) m.update(tr);
    this.opts.onUpdate?.();
  }

  /** 엔진 쪽에서 바뀐 문서 반영 (undo · redo · 원격). 같으면 아무것도 안 한다 — 입력 중(IME 포함) 방해 없음. */
  setDoc(doc: TextDoc): void {
    const next = toNode(doc);
    const cur = this.view.state.doc;
    if (next.eq(cur)) return;
    // 바뀐 구간만 바꿔 끼운다 — 문서 전체를 갈아 끼우면 커서가 문서 끝 · 엉뚱한 곳으로 튄다(undo · redo 직후).
    const start = cur.content.findDiffStart(next.content);
    if (start == null) return;
    let { a: endA, b: endB } = cur.content.findDiffEnd(next.content)!;
    const overlap = start - Math.min(endA, endB);
    if (overlap > 0) { endA += overlap; endB += overlap; }
    const tr = this.view.state.tr.replace(start, endA, next.slice(start, endB));
    // 커서는 바뀐 구간 끝으로 (undo면 지운 자리, redo면 되살린 글자 끝) — 일반 편집기의 실행 취소 동작
    if (this.view.hasFocus()) tr.setSelection(Selection.near(tr.doc.resolve(Math.min(endB, tr.doc.content.size)), -1));
    tr.setMeta(EXTERNAL, true).setMeta('addToHistory', false);
    this.view.dispatch(tr);
  }

  get doc(): TextDoc { return toJSON(this.view.state.doc); }

  focus(): void { this.view.focus(); }
  /** 화면을 옮겼을 때 (캔버스 이동 · 확대): 화면 좌표로 띄운 고르기 막대 · 메뉴를 거둔다 */
  hidePopups(): void { this.bubble.hide(); for (const m of this.menus) m.close(); this.picker?.close(); }
  /** 기호 · 이모지 고르기 판 (/기호 · /이모지 · 서식 막대) */
  openSymbols(kind: SymbolKind | 'xref'): void {
    this.picker?.close();
    if (kind !== 'xref') (this.picker = new SymbolPicker(this.view, this.opts.overlay)).open(kind);
    else if (this.opts.xrefs) (this.picker = new XrefPicker(this.view, this.opts.overlay, this.opts.xrefs)).open(); // 상호 참조 고르기
  }

  /** 끌어서 고르기: 문서 위치 anchor(없으면 지금 선택의 시작점)부터 화면 좌표 자리까지. 고른 시작점을 돌려준다 */
  dragTo(at: { clientX: number; clientY: number }, anchor?: number): number {
    const st = this.view.state, from = anchor ?? st.selection.anchor;
    const pos = this.view.posAtCoords({ left: at.clientX, top: at.clientY })?.pos;
    if (pos !== undefined && (pos !== st.selection.head || from !== st.selection.anchor)) this.view.dispatch(st.tr.setSelection(TextSelection.create(st.doc, from, pos)));
    return from;
  }

  /** 칸 안 글을 모두 고른 상태인가 (Ctrl+A 두 번째 = 문서 전체 블록) */
  get allSelected(): boolean { const { from, to } = this.view.state.selection; return from <= 1 && to >= this.view.state.doc.content.size - 1; }

  /** Shift+↑↓가 칸 밖으로 나가는가 (맨 위 · 맨 아래 줄) */
  atEdge(dir: 'up' | 'down'): boolean {
    const st = this.view.state, $h = st.selection.$head;
    return this.view.endOfTextblock(dir) && (dir === 'down' ? $h.after(1) >= st.doc.content.size : $h.before(1) <= 0);
  }

  exec(name: FormatCommand, arg?: unknown): void {
    const run = formatCommand(name, arg);
    if (run) run(this.view.state, this.view.dispatch, this.view);
    this.view.focus();
  }

  isActive(name: FormatCommand): boolean { return formatActive(this.view.state, name); }

  get canExtract(): boolean { return !!this.opts.onExtract; }
  get canCopyOut(): boolean { return !!this.opts.onCopyOut; }
  get canComment(): boolean { return !!this.opts.onComment; }
  get canAi(): boolean { return !!this.opts.onAiEdit && this.mode === 'body'; }

  /** 고른 글(없으면 상자 전체)을 AI 작성 도우미로 — 결과는 호스트가 엔진에 넣고 setDoc으로 돌아온다 */
  aiSelection(): void {
    if (!this.canAi) return;
    const { state } = this.view;
    const { empty } = state.selection;
    const from = empty ? 0 : state.selection.from, to = empty ? state.doc.content.size : state.selection.to;
    const rect = this.view.coordsAtPos(empty ? state.selection.head : state.selection.to);
    this.bubble.hide();
    this.opts.onAiEdit!({ from, to, doc: toJSON(state.doc), at: { clientX: rect.left, clientY: rect.bottom } });
  }

  /** 고른 글에 댓글 표시를 달고 호스트에 알린다 */
  commentSelection(): void {
    const { state } = this.view;
    const { from, to, empty } = state.selection;
    if (empty || !this.opts.onComment) return;
    const quote = state.doc.textBetween(from, to, ' ', ' ').trim();
    const rect = this.view.coordsAtPos(to);
    const id = this.opts.onComment({ quote, at: { clientX: rect.left, clientY: rect.bottom } });
    if (!id) return;
    this.view.dispatch(state.tr.addMark(from, to, schema.marks.comment!.create({ id })));
  }

  /**
   * 선택 영역을 떼어 낸다 (FR-017): 선택 범위를 감싼 구조째 잘라 새 문서로, 원본에서는 지우는 스텝.
   * 에디터에는 직접 적용하지 않는다 — 호출 측이 "지우기 + 새 블록"을 엔진 트랜잭션 하나로 묶고, 결과는 setDoc으로 돌아온다.
   */
  /** 고른 글 조각 — 본문 칸에서 고른 글이 있을 때만 (원문에서 상자 만들기: 끌어 놓기 · 꺼내기) */
  selectedSlice(): { doc: TextDoc; from: number; to: number } | null {
    const { state } = this.view, { from, to, empty } = state.selection;
    return empty || this.mode !== 'body' ? null : { doc: toJSON(state.doc.cut(from, to)), from, to };
  }

  /** 고른 글로 새 상자 — 원문은 그대로 */
  copyOutSelection(): void {
    const s = this.selectedSlice();
    if (s && this.opts.onCopyOut) { this.bubble.hide(); this.opts.onCopyOut(s); }
  }

  extractSelection(): void {
    const { state } = this.view;
    const { from, to, empty } = state.selection;
    if (empty || !this.opts.onExtract) return;
    const cut = state.doc.cut(from, to);
    const rect = this.view.coordsAtPos(from);
    this.opts.onExtract({ doc: toJSON(cut), steps: state.tr.deleteSelection().steps.map((s) => s.toJSON()), at: { clientX: rect.left, clientY: rect.top } });
  }

  private placeCursor(at: NonNullable<TextEditorOptions['at']>): void {
    const { state } = this.view;
    let sel: Selection;
    if (at === 'start') sel = Selection.atStart(state.doc);
    else if (at === 'end') sel = Selection.atEnd(state.doc);
    else if ('pos' in at) sel = TextSelection.near(state.doc.resolve(Math.min(at.pos, state.doc.content.size)));
    else {
      const pos = this.view.posAtCoords({ left: at.clientX, top: at.clientY });
      sel = pos ? TextSelection.near(state.doc.resolve(pos.pos)) : Selection.atEnd(state.doc);
    }
    this.view.dispatch(state.tr.setSelection(sel).setMeta(EXTERNAL, true));
    this.view.focus();
  }

  destroy(): void {
    const a = document.activeElement;
    if (a instanceof HTMLElement && a.closest('.dn-editor-pop') && this.view.dom.isConnected) a.blur();
    for (const m of this.menus) m.destroy();
    this.picker?.close();
    this.bubble.destroy();
    this.view.destroy();
  }
}

// 화살표: 칸 끝에서 다음 상자로 넘어가는지(doc-keys)를 편집기 커서로 정한다 — 치고 바로 Home → 오른쪽이 다음 상자로 넘어가던 것
const SYNC_KEYS = new Set(['Enter', 'Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/**
 * 화면(DOM)에서 고른 범위가 아직 편집기 상태에 안 들어왔으면 지금 맞춘다. 고른 범위는 selectionchange로 다음 차례에야 들어와,
 * 빠른 Shift+화살표 · Shift+Home 바로 뒤 Ctrl+B가 빈 커서에 걸려 아무 일도 안 하고, 이어 누른 Ctrl+Z가 친 글을 되돌리던 것 (DQ-027)
 */
function syncDomSelection(view: EditorView): void {
  const s = view.dom.ownerDocument.getSelection(), cur = view.state.selection;
  if (view.composing || !(cur instanceof TextSelection) || !s?.anchorNode || !s.focusNode || !view.dom.contains(s.anchorNode) || !view.dom.contains(s.focusNode)) return;
  try {
    const anchor = view.posAtDOM(s.anchorNode, s.anchorOffset), head = view.posAtDOM(s.focusNode, s.focusOffset);
    if (anchor === cur.anchor && head === cur.head) return;
    const { doc } = view.state;
    view.dispatch(view.state.tr.setSelection(TextSelection.between(doc.resolve(anchor), doc.resolve(head))));
  } catch { /* 편집기 밖 자리 */ }
}
