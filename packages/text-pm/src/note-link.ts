// 노트 링크 자동완성 (FR-080): '[[' 또는 줄 맨 앞 · 공백 뒤의 '@'를 치면 노트 고르기 메뉴가 뜬다.
// 슬래시 메뉴와 같은 방식 — 검색어는 보통 글자로 문서에 들어가고, 고르면 트리거부터 지운 뒤 링크 노드를 넣는다.
import type { Transaction } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { iconElement } from './icons';
import { noteTitle, schema } from './schema';
import { dateLabel, parseDateQuery } from './dates';
import { PopupMenu, type MenuRow } from './menu';

export interface NoteLinkTarget { id: string; title: string; hint?: string }

/** 앱이 넘겨 주는 노트 찾기 · 만들기 · 열기 */
export interface NoteLinkHost {
  /** 검색어에 맞는 노트 (빈 검색어면 최근 노트). 앞쪽 몇 개만 보인다. */
  search(query: string): NoteLinkTarget[];
  /** 같은 제목이 없을 때 '새 노트 만들기' — 만든 노트 (실패하면 null) */
  create(title: string): Promise<NoteLinkTarget | null>;
  open(id: string): void;
}

const MAX = 8;

type Item = { kind: 'note'; target: NoteLinkTarget } | { kind: 'create'; title: string } | { kind: 'date'; date: string };

/** 날짜 말을 치는 중(띄어 쓴 채 아직 끝나지 않은 말) — '@' 메뉴를 닫지 않는다: '다음 주 금요일' · '10월 7일' · '2027년 1월' · '3일 뒤' */
const DATE_PREFIX = /^(이번|다음|다다음)(\s*주)?\s*$|^\d{1,2}월\s*$|^\d{4}년(\s*\d{1,2}월)?\s*$|^\d{1,3}\s*(일|주)\s*$/;

export class NoteLinkMenu extends PopupMenu<Item> {
  private trigger = 0;

  constructor(view: EditorView, overlay: HTMLElement, private readonly host: NoteLinkHost) {
    super(view, overlay, 'dn-link-menu', '노트 링크', '노트 제목을 입력해 주세요');
  }

  override update(tr?: Transaction): void {
    const before = this.typed(tr);
    const { state } = this.view;
    const sel = state.selection;
    const $h = sel.$head;
    if (this.from === null) {
      if (before === '[[') this.trigger = 2;
      else if (before?.endsWith('@') && (before.length === 1 || /\s/.test(before[0]!))) this.trigger = 1;
      else return;
      this.from = $h.pos - this.trigger;
      this.index = 0;
    }
    const from = this.from;
    const head = from + this.trigger;
    const mark = this.trigger === 2 ? '[[' : '@';
    const valid = sel.empty && $h.pos >= head && $h.pos - head <= 40
      && state.doc.textBetween(from, head) === mark && state.doc.resolve(from).parent === $h.parent;
    if (!valid) { this.close(); return; }
    const query = state.doc.textBetween(head, $h.pos).replace(/\]+$/, '');
    const found = this.host.search(query.trim()).slice(0, MAX);
    const q = query.trim();
    const items: Item[] = found.map((target) => ({ kind: 'note', target }));
    // '@'는 날짜도 (FR-133): 읽히는 날짜 말이면 맨 앞에, 빈 검색어면 오늘 · 내일을 뒤에
    const date = this.trigger === 1 ? parseDateQuery(q) : null;
    if (date) items.unshift({ kind: 'date', date });
    if (q && !date && !found.some((t) => t.title.trim().toLowerCase() === q.toLowerCase())) items.push({ kind: 'create', title: q });
    if (this.trigger === 1 && !q) for (const w of ['오늘', '내일']) items.push({ kind: 'date', date: parseDateQuery(w)! });
    // '@' 뒤에 맞는 노트 · 날짜가 없는 채로 띄어 쓰면 거둔다 — 그냥 '@'가 들어간 글 (메일 주소 등)
    if (this.trigger === 1 && !found.length && !date && /\s$/.test(query) && !DATE_PREFIX.test(query)) { this.close(); return; }
    this.show(items, key);
  }

  protected override async choose(it: Item): Promise<void> {
    const from = this.from;
    if (from === null) return;
    const head = this.view.state.selection.head;
    this.close();
    // ']]'까지 쳤으면 그것도 같이 지운다
    const after = this.view.state.doc.textBetween(head, Math.min(head + 2, this.view.state.doc.resolve(head).end()));
    const to = this.trigger === 2 && after === ']]' ? head + 2 : head;
    this.view.dispatch(this.view.state.tr.delete(from, to));
    if (it.kind === 'date') {
      const at = this.view.state.selection.from;
      this.view.dispatch(this.view.state.tr.replaceRangeWith(at, at, schema.nodes.date_mention!.create({ date: it.date })).insertText(' ').scrollIntoView());
      this.view.focus();
      return;
    }
    const target = it.kind === 'note' ? it.target : await this.host.create(it.title);
    if (!target || this.view.isDestroyed) return;
    const node = schema.nodes.note_link!.create({ id: target.id, title: target.title });
    const { from: at } = this.view.state.selection;
    this.view.dispatch(this.view.state.tr.replaceRangeWith(at, at, node).insertText(' ').scrollIntoView());
    this.view.focus();
  }

  protected override row(it: Item): MenuRow {
    return {
      icon: iconElement(it.kind === 'note' ? 'note' : it.kind === 'date' ? 'calendar' : 'plus', 15),
      label: it.kind === 'note' ? it.target.title : it.kind === 'date' ? dateLabel(it.date) : `'${it.title}' 새 노트 만들기`,
      hint: it.kind === 'note' ? it.target.hint ?? '' : it.kind === 'date' ? `날짜 · ${it.date}` : '만들고 링크로 넣어요',
    };
  }
}

const key = (it: Item) => (it.kind === 'note' ? it.target.id : it.kind === 'date' ? `@${it.date}` : `+${it.title}`);

/**
 * 편집 중 가리키는 링크 (노트 링크 · 상호 참조 공통): 글자는 지금 이름(now) — 대상이 없으면 missing으로 흐리게 saved.
 * 누르면 open. 이름이 바뀌면 refreshNoteLinks · refreshXrefs가 고쳐 쓴다
 */
export class RefLinkView implements NodeView {
  dom: HTMLAnchorElement;
  constructor(cls: string, data: Record<string, string>, id: string, now: (id: string) => string | null, saved: string, open?: (id: string) => void) {
    const cur = now(id);
    this.dom = document.createElement('a');
    this.dom.className = `${cls}${cur === null ? ' missing' : ''}`;
    Object.assign(this.dom.dataset, data);
    this.dom.setAttribute('role', 'link');
    this.dom.contentEditable = 'false';
    this.dom.textContent = cur ?? saved;
    this.dom.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !open || now(id) === null) return;
      e.preventDefault();
      open(id);
    });
  }
  ignoreMutation(): boolean { return true; }
  stopEvent(e: Event): boolean { return e.type === 'mousedown'; }
}

/** 편집 중 노트 링크: 누르면 그 노트로, 글자는 지금 제목 */
export class NoteLinkView extends RefLinkView {
  constructor(node: PMNode, open?: (id: string) => void) {
    const id = node.attrs.id as string, title = node.attrs.title as string;
    super('dn-note-link', { note: id, title }, id, noteTitle, title || '없는 노트', open);
  }
}
