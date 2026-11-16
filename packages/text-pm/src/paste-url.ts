// 주소 붙여넣기 › 링크 · 언급 · 북마크 · 임베드 고르기 (노션 "Paste as", FR-050): 주소만 붙여넣으면 링크로 넣고 바로 아래 작은 메뉴를 띄운다.
// 링크로 두기(기본 · Esc · 계속 입력) · 언급(글 속 칩 — 제목은 호스트가 모아 채운다) · 북마크(카드) · 임베드(허용 목록 주소만).
// 북마크 · 임베드는 빈 줄에 붙였을 때만 — 그 줄의 주소를 지우고 호스트가 아래에 웹 블록을 만든다. 글 사이에 붙이면 링크 · 언급만.
import { embedTarget, type WebView } from '@dn/engine-core';
import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { iconElement, type IconName } from './icons';
import { PopupMenu, type MenuRow } from './menu';
import { safeHref, schema } from './schema';

/** 주소만 붙여넣으면 링크로 — 글을 고른 채면 그 글에 링크를 건다 (FR-030). 빈 줄이면 고르기 메뉴. 처리했으면 true */
export function pasteLink(view: EditorView, text: string, menu: PasteUrlMenu | null): boolean {
  if (!/^https?:\/\/\S+$/i.test(text) || !safeHref(text) || view.state.selection.$from.parent.type.spec.code) return false;
  const { from, to, empty } = view.state.selection;
  const mark = schema.marks.link!.create({ href: text });
  const tr = empty ? view.state.tr.replaceSelectionWith(schema.text(text, [mark]), false) : view.state.tr.addMark(from, to, mark);
  view.dispatch(tr.scrollIntoView());
  if (empty) menu?.offer(from, text);
  return true;
}

export interface PasteUrlChoice { id: 'link' | 'mention' | WebView; label: string; hint: string; icon: IconName }
/** 링크 언급 제목 모으기 (호스트 — 웹 북마크와 같은 unfurl) */
export type MentionUnfurl = (url: string) => Promise<{ title?: string; site?: string } | null>;

/** 붙여넣은 주소를 무엇으로 둘지 — 글 상자 안(아래 메뉴)과 빈 캔버스(engine-dom paste-url-offer.ts)가 같은 고르기. inline: 글 사이(링크 · 언급만) */
export function pasteUrlChoices(url: string, inline = false): PasteUrlChoice[] {
  const t = embedTarget(url);
  return [
    { id: 'link', label: '링크로 두기', hint: '글 속 링크 그대로', icon: 'link' },
    { id: 'mention', label: '언급', hint: '사이트 제목 칩으로', icon: 'globe' },
    ...(inline ? [] : [
      { id: 'bookmark' as const, label: '북마크', hint: '제목 · 설명 카드로', icon: 'bookmark' as const },
      ...(t ? [{ id: 'embed' as const, label: '임베드', hint: `${t.provider} 화면을 노트 안에`, icon: 'globe' as const }] : []),
    ]),
  ];
}

/** 주소 → 링크 언급 노드, 제목은 모이면 채운다(그새 편집기가 닫혔거나 다른 제목이 있으면 그대로) */
export function insertMention(view: EditorView, from: number, to: number, url: string, unfurl?: MentionUnfurl): void {
  view.dispatch(view.state.tr.replaceWith(from, to, schema.nodes.link_mention!.create({ href: url })).scrollIntoView());
  void unfurl?.(url).then((m) => {
    const title = m?.title?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '', site = m?.site?.replace(/\s+/g, ' ').trim().slice(0, 60) ?? '';
    if ((!title && !site) || view.isDestroyed) return;
    const tr = view.state.tr;
    view.state.doc.descendants((n, pos) => { if (n.type.name === 'link_mention' && n.attrs.href === url && !n.attrs.title) tr.setNodeMarkup(pos, undefined, { ...n.attrs, title, site }); });
    if (tr.docChanged) view.dispatch(tr);
  }, () => {});
}

export class PasteUrlMenu extends PopupMenu<PasteUrlChoice> {
  /** 주소 첫 글자 위치 (메뉴는 끝 위치(from) 아래에 — 긴 주소가 접혀도 가리지 않게) */
  private start = 0;
  private url = '';

  constructor(view: EditorView, overlay: HTMLElement, private readonly pick: (e: { url: string; view: WebView }) => void, private readonly unfurl?: MentionUnfurl) {
    super(view, overlay, 'dn-paste-url', '붙여넣은 주소', '');
  }

  /** 막 붙여넣은 주소 (from: 주소 첫 글자 위치). 그 줄이 주소뿐이면 넷 다, 글 사이면 링크 · 언급만 */
  offer(from: number, url: string): void {
    const $f = this.view.state.doc.resolve(from);
    if (!$f.parent.inlineContent || $f.parent.type.spec.code) return;
    const alone = $f.parent.type.name === 'paragraph' && $f.parent.textContent === url;
    this.start = from;
    this.from = from + url.length;
    this.url = url;
    this.index = 0;
    this.show(pasteUrlChoices(url, !alone), (c) => c.id);
  }

  /** 열린 뒤 글을 더 쓰거나 커서를 옮기면 링크로 둔 것으로 */
  update(tr?: Transaction): void {
    if (this.from !== null && tr && (tr.docChanged || tr.selectionSet)) this.close();
  }

  protected choose(c: PasteUrlChoice): void {
    const from = this.start, to = this.from;
    this.close();
    if (c.id === 'link' || to === null) return;
    if (c.id === 'mention') { insertMention(this.view, from, to, this.url, this.unfurl); return; }
    this.view.dispatch(this.view.state.tr.delete(from, to));
    this.pick({ url: this.url, view: c.id });
  }

  protected row(c: PasteUrlChoice): MenuRow {
    return { icon: iconElement(c.icon), label: c.label, hint: c.hint, id: c.id, section: '붙여넣은 주소' };
  }
}
