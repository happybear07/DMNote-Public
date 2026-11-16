/// <reference path="./env.d.ts" />
// 슬래시(/) 커맨드 메뉴 (FR-029): 줄 맨 앞(또는 공백 뒤)에서 '/'를 치면 명령 메뉴가 뜬다. 항목은 docs/SLASH-COMMANDS.md가 원본(slash-md.ts).
// 메뉴 상태는 에디터 문서가 아니라 화면 쪽에만 둔다 — '/검색어' 글자는 보통 글자로 문서에 들어가고, 고르면 지운 뒤 명령을 실행한다.
// 캔버스 · 문서 뷰의 글 상자 · 제목 상자 모두 — 제목 상자에서는 줄 모양을 바꾸는 서식 명령 · 여러 줄 글 조각을 뺀다.
import { Slice } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import md from '../../../docs/SLASH-COMMANDS.md?raw';
import { markdownToDoc } from './markdown';
import { toNode } from './codec';
import { schema } from './schema';
import type { FormatCommand } from './format';
import { iconElement, type IconName } from './icons';
import { PopupMenu, type MenuRow } from './menu';
import type { NoteLinkHost } from './note-link';
import { fillSlashText, isoDay, parseSlashMd, type SlashItem } from './slash-md';

export type { SlashItem } from './slash-md';

const parsed = parseSlashMd(md);
if (parsed.bad.length) console.warn('[dn] docs/SLASH-COMMANDS.md — 메뉴에 넣지 못한 줄:', parsed.bad);
export const SLASH_ITEMS: readonly SlashItem[] = parsed.items;

/** 항목 아이콘: 글자 · 선 아이콘 · 색 견본 */
const GLYPH: Record<string, string> = { paragraph: 'T', h1: 'H1', h2: 'H2', h3: 'H3', h4: 'H4', bullet: '•', ordered: '1.', toggleH1: '▸H1', toggleH2: '▸H2', toggleH3: '▸H3', code: '</>', math: '∑', mathInline: 'x²', divider: '—', footnote: '¹', xref: '#' };
const SVG: Record<string, IconName> = {
  task: 'checkSquare', toggle: 'toggle', quote: 'quote', ai: 'sparkle', symbol: 'omega', emoji: 'smile',
  callout: 'bulb', table: 'table', chart: 'chart', image: 'image', video: 'video', audio: 'audio', file: 'paperclip', record: 'mic', toc: 'listOrdered', button: 'plus', tabs: 'pages',
  database: 'database', 'db-board': 'board', 'db-calendar': 'calendar', 'db-gallery': 'gallery', 'db-list': 'list', 'db-timeline': 'timeline', 'db-chart': 'chart', 'columns-2': 'columns', 'columns-3': 'columns', 'columns-4': 'columns', 'columns-5': 'columns', embed: 'copy', bookmark: 'bookmark', 'web-embed': 'globe',
  page: 'note', link: 'link', duplicate: 'copy', delete: 'trash', 'copy-link': 'link', comment: 'comment', move: 'goto', select: 'target', 'select-block': 'block',
};
function icon(it: SlashItem): string | Element {
  if (GLYPH[it.id]) return GLYPH[it.id]!;
  if (SVG[it.id]) return iconElement(SVG[it.id]!, 15);
  const c = /^(color|bg)-(\w+)$/.exec(it.id);
  if (c) {
    const s = document.createElement('span');
    s.className = `dn-slash-swatch ${c[1]}`;
    s.textContent = '가';
    if (c[2] !== 'default') s.style.setProperty('--sw', c[1] === 'color' ? `var(--dn-tc-${c[2]})` : `var(--dn-block-${c[2]})`);
    return s;
  }
  return iconElement(it.action.kind === 'date' ? 'calendar' : 'pencil', 15);
}

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** 한글 음절 → 초성 (그 밖의 글자는 그대로) */
export function chosung(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** 검색어로 항목 고르기: 이름 · 별칭의 부분 문자열, 또는 초성(ㅈㅁ → 제목). 슬래시 메뉴 · 명령 팔레트 · 넣기 메뉴가 같이 쓴다 */
export function filterSlash<T extends { label: string; keywords: readonly string[] }>(items: readonly T[], query: string, labelFirst = false): T[] {
  const q = norm(query);
  if (!q) return [...items];
  // 점수: 이름 · 별칭이 검색어로 시작 2(labelFirst면 이름 시작은 3), 포함(초성 포함) 1 — 높은 것부터, 같으면 원래 순서
  const score = (it: T) => Math.max(...[it.label, ...it.keywords].map((k, i) => {
    const h = norm(k), c = chosung(h);
    return h.startsWith(q) || c.startsWith(q) ? (labelFirst && i === 0 ? 3 : 2) : h.includes(q) || c.includes(q) ? 1 : 0;
  }));
  return items.map((it, i) => ({ it, i, s: score(it) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.it);
}

interface SlashOptions {
  /** 없으면 AI 항목을 숨긴다 */
  onAi?: (() => void) | undefined;
  /** 상자 밖 일(블록 넣기 · 블록 동작 · 색). 없으면 그 항목을 숨긴다 */
  onInsert?: ((kind: string) => void) | undefined;
  /** 없으면 '페이지' 항목을 숨긴다 */
  noteLinks?: NoteLinkHost | undefined;
  /** 제목 상자: 줄 모양 서식 · 여러 줄 글 조각은 뺀다 */
  mode: 'title' | 'body';
  run(cmd: FormatCommand): void;
  /** 기호 · 이모지 · 상호 참조 판 (/기호 · /이모지 · /상호 참조) */
  symbols?(which: 'symbol' | 'emoji' | 'xref'): void;
  /** 상호 참조를 쓸 수 있나 (호스트가 캡션 목록을 주나) */
  xref?: boolean;
}

/** 이 상자에서 쓸 수 있는 항목인가 */
function usable(it: SlashItem, o: SlashOptions): boolean {
  const a = it.action;
  if (a.kind === 'ai' && !o.onAi) return false;
  if (a.kind === 'insert' && !o.onInsert) return false;
  if (a.kind === 'page' && !o.noteLinks) return false;
  if (a.kind === 'symbols' && a.which === 'xref' && !o.xref) return false;
  // 제목 상자: 노트 링크 메뉴('[[')가 없어 '페이지 링크'도 뺀다
  if (o.mode === 'title') return a.kind === 'insert' || a.kind === 'ai' || a.kind === 'date' || a.kind === 'page' || (a.kind === 'text' && !a.md.includes('\n')) || (a.kind === 'format' && a.cmd === 'mathInline');
  return true;
}

export class SlashMenu extends PopupMenu<SlashItem> {
  private readonly items: SlashItem[];
  private query = '';

  constructor(view: EditorView, overlay: HTMLElement, private readonly opts: SlashOptions) {
    super(view, overlay, 'dn-slash', '명령 메뉴', '맞는 명령이 없어요');
    this.items = SLASH_ITEMS.filter((it) => usable(it, opts));
  }

  override update(tr?: Transaction): void {
    const before = this.typed(tr);
    const { state } = this.view;
    const sel = state.selection;
    const $h = sel.$head;
    if (this.from === null) {
      if (before === null || !before.endsWith('/') || (before.length === 2 && !/\s/.test(before[0]!))) return;
      this.from = $h.pos - 1;
      this.index = 0;
    }
    const from = this.from;
    const valid = sel.empty && $h.pos > from && $h.pos - from <= 32
      && state.doc.textBetween(from, from + 1) === '/' && state.doc.resolve(from).parent === $h.parent;
    if (!valid) { this.close(); return; }
    this.query = state.doc.textBetween(from + 1, $h.pos);
    const shown = filterSlash(this.items, this.query);
    // 맞는 항목이 없는 채로 띄어 쓰면 메뉴를 거둔다 — 그냥 '/'가 들어간 글을 쓰는 중
    if (!shown.length && /\s$/.test(this.query)) { this.close(); return; }
    this.show(shown, (s) => s.id);
  }

  protected override choose(it: SlashItem): void {
    const from = this.from;
    if (from === null) return;
    const head = this.view.state.selection.head;
    this.close();
    this.view.dispatch(this.view.state.tr.delete(from, head));
    const a = it.action, v = this.view;
    switch (a.kind) {
      case 'ai': this.opts.onAi?.(); return;
      case 'insert': this.opts.onInsert?.(a.what); return;
      case 'format': this.opts.run(a.cmd); return;
      // '[['를 치면 노트 링크 메뉴가 열린다 (있는 노트 고르기 · 새 노트)
      case 'link': v.dispatch(v.state.tr.insertText('[[')); return;
      case 'date': v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.date_mention!.create({ date: isoDay(a.offset) }), false).insertText(' ').scrollIntoView()); return;
      case 'text': v.dispatch(v.state.tr.replaceSelection(Slice.maxOpen(toNode(markdownToDoc(fillSlashText(a.md))).content)).scrollIntoView()); return;
      case 'page': void this.newPage(); return;
      case 'symbols': this.opts.symbols?.(a.which); return;
    }
  }

  /** 새 노트를 만들고 여기에 링크 (노션의 /page) */
  private async newPage(): Promise<void> {
    const t = await this.opts.noteLinks?.create('제목 없는 페이지');
    const v = this.view;
    if (!t || v.isDestroyed) return;
    v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.note_link!.create({ id: t.id, title: t.title }), false).insertText(' ').scrollIntoView());
    v.focus();
  }

  protected override row(it: SlashItem): MenuRow {
    // 검색어 없이 '/'만이면 묶음 머리를 보인다 (노션처럼), 찾는 중이면 맞는 것만 한 줄로
    return { icon: icon(it), label: it.label, hint: it.hint, id: it.id, ai: it.ai, ...(this.query ? {} : { section: it.section }) };
  }
}
