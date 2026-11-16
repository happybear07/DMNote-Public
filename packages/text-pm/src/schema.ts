// 텍스트 스키마 'pm-v1' (FR-026 · FR-027 · FR-033). 노드 · 마크 이름은 저장 포맷이므로 바꾸지 않는다 —
// 바꿔야 하면 NoteSnapshot.schemaVersion을 올리고 마이그레이션을 쓴다 (ENGINE 12.2).
import { Schema, type DOMOutputSpec, type NodeSpec, type MarkSpec } from 'prosemirror-model';
import { languageName, normalizeLanguage } from './highlight';
import { bgColorCss, cleanColor, textColorCss } from './text-colors';
import { ICON_PATHS, ICON_SVG_ATTRS, resolveIcon } from './icons';
import { dateLabel, dateTense } from './dates';

const SVG = 'http://www.w3.org/2000/svg';

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },
  paragraph: {
    content: 'inline*', group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM: (): DOMOutputSpec => ['p', 0],
  },
  heading: {
    attrs: { level: { default: 1 } }, content: 'inline*', group: 'block', defining: true,
    // 제목 1 ~ 4 (노션 · 워드). h5 · h6은 4로
    parseDOM: [1, 2, 3, 4, 5, 6].map((l) => ({ tag: `h${l}`, attrs: { level: Math.min(l, 4) } })),
    toDOM: (n): DOMOutputSpec => [`h${n.attrs.level}`, 0],
  },
  blockquote: {
    content: 'block+', group: 'block', defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: (): DOMOutputSpec => ['blockquote', 0],
  },
  // 코드 (FR-026): 언어를 정하면 구문 강조 — 모르는 언어 · 빈 값은 일반 텍스트
  code_block: {
    attrs: { language: { default: '' } },
    content: 'text*', marks: '', group: 'block', code: true, defining: true,
    parseDOM: [{
      tag: 'pre', preserveWhitespace: 'full',
      getAttrs: (d) => {
        const el = d as HTMLElement;
        const cls = `${el.className} ${el.querySelector('code')?.className ?? ''}`;
        return { language: normalizeLanguage(el.dataset.language ?? /(?:^|\s)(?:language|lang)-(\S+)/.exec(cls)?.[1]) };
      },
    }],
    toDOM: (n): DOMOutputSpec => ['pre', n.attrs.language ? { 'data-language': n.attrs.language, 'data-lang-name': languageName(n.attrs.language) } : {}, ['code', 0]],
  },
  horizontal_rule: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM: (): DOMOutputSpec => ['hr'],
  },
  bullet_list: {
    content: 'list_item+', group: 'block',
    parseDOM: [{ tag: 'ul:not([data-type="task"])' }],
    toDOM: (): DOMOutputSpec => ['ul', 0],
  },
  // nums: 번호 모양 — '' 단계마다 1 · a · i, 'outline' 다단계 1. · 1.1. · 1.1.1. (list-nums.ts, 안쪽 번호 목록도 따른다)
  ordered_list: {
    attrs: { order: { default: 1 }, nums: { default: '' } }, content: 'list_item+', group: 'block',
    parseDOM: [{ tag: 'ol', getAttrs: (d) => { const el = d as HTMLElement; return { order: el.hasAttribute('start') ? Number(el.getAttribute('start')) : 1, nums: el.dataset.nums === 'outline' ? 'outline' : '' }; } }],
    toDOM: (n): DOMOutputSpec => {
      const order = Number(n.attrs.order) || 1;
      // 다단계 번호는 CSS 카운터라 시작 번호를 카운터에도 (보통 목록에는 영향 없음)
      return ['ol', { ...(order !== 1 ? { start: String(order), style: `counter-reset: dn-ol ${order - 1}` } : {}), ...(n.attrs.nums === 'outline' ? { 'data-nums': 'outline' } : {}) }, 0];
    },
  },
  list_item: {
    content: 'paragraph block*', defining: true,
    parseDOM: [{ tag: 'li:not([data-checked])' }],
    toDOM: (): DOMOutputSpec => ['li', 0],
  },
  task_list: {
    content: 'task_item+', group: 'block',
    parseDOM: [{ tag: 'ul[data-type="task"]', priority: 60 }],
    toDOM: (): DOMOutputSpec => ['ul', { 'data-type': 'task' }, 0],
  },
  task_item: {
    attrs: { checked: { default: false } }, content: 'paragraph block*', defining: true,
    parseDOM: [{ tag: 'li[data-checked]', priority: 60, getAttrs: (d) => ({ checked: (d as HTMLElement).getAttribute('data-checked') === 'true' }) }],
    toDOM: (n): DOMOutputSpec => ['li', { 'data-checked': String(n.attrs.checked) }, 0],
  },
  // 토글 (FR-047): 첫 문단(또는 제목 — 노션 '토글 제목')이 요약 줄, 나머지가 접히는 내용. 접힘 상태는 문서에 저장한다 — 다시 열어도 유지 · undo 대상.
  // 화살표 버튼은 toDOM에 들어 있어 정적 렌더(편집 중이 아닌 블록)에서도 같은 모양이 된다.
  toggle: {
    attrs: { open: { default: true } }, content: '(paragraph | heading) block*', group: 'block', defining: true,
    parseDOM: [
      { tag: 'div[data-type="toggle"]', contentElement: '.dn-toggle-body', getAttrs: (d) => ({ open: (d as HTMLElement).dataset.open !== 'false' }) },
      { tag: 'details', getAttrs: (d) => ({ open: (d as HTMLElement).hasAttribute('open') }) },
    ],
    toDOM: (n): DOMOutputSpec => ['div', { 'data-type': 'toggle', 'data-open': String(n.attrs.open) },
      ['span', { class: 'dn-toggle-btn', contenteditable: 'false', 'aria-label': n.attrs.open ? '접기' : '펼치기' }],
      ['div', { class: 'dn-toggle-body' }, 0]],
  },
  // 콜아웃 (FR-048): 아이콘 이름(단색 선 아이콘, icons.ts) + 배경색 이름(실제 색은 CSS가 정한다 — 블록 색과 같은 방식).
  // 아이콘 이름이 아닌 값(초기에 넣던 이모지 등)은 글자 그대로 보여 준다.
  callout: {
    attrs: { icon: { default: 'bulb' }, color: { default: 'yellow' } }, content: 'block+', group: 'block', defining: true,
    parseDOM: [{ tag: 'div[data-type="callout"]', contentElement: '.dn-callout-body', getAttrs: (d) => {
      const el = d as HTMLElement;
      const ic = el.querySelector<HTMLElement>('.dn-callout-icon');
      return { icon: ic?.dataset.icon || ic?.textContent || 'bulb', color: CALLOUT_COLORS.includes(el.dataset.color ?? '') ? el.dataset.color : 'yellow' };
    } }],
    toDOM: (n): DOMOutputSpec => ['div', { 'data-type': 'callout', 'data-color': n.attrs.color },
      calloutIconSpec(n.attrs.icon),
      ['div', { class: 'dn-callout-body' }, 0]],
  },
  text: { group: 'inline' },
  // 노트 링크 (FR-080): 대상 노트 id + 링크 당시 제목. 보이는 글자는 그때그때 현재 제목(setNoteTitleResolver) —
  // 대상 제목이 바뀌어도 링크가 따라간다. 대상이 없으면(삭제) 저장된 제목을 흐리게 보여 준다.
  note_link: {
    attrs: { id: {}, title: { default: '' } }, inline: true, group: 'inline', atom: true, selectable: true, draggable: false,
    parseDOM: [{ tag: 'a[data-note]', getAttrs: (d) => {
      const el = d as HTMLElement;
      return el.dataset.note ? { id: el.dataset.note, title: el.dataset.title ?? el.textContent ?? '' } : false;
    } }],
    toDOM: (n): DOMOutputSpec => {
      const cur = noteTitle(n.attrs.id);
      return ['a', { class: `dn-note-link${cur === null ? ' missing' : ''}`, 'data-note': n.attrs.id, 'data-title': n.attrs.title, role: 'link', contenteditable: 'false' },
        cur ?? (n.attrs.title || '없는 노트')];
    },
  },
  // 상호 참조 (워드 삽입 › 상호 참조): 캡션 단 블록 id + 넣을 때 번호. 보이는 글자는 그때그때 지금 번호(setXrefResolver) —
  // 그림 · 표 차례가 바뀌어도 따라간다. 캡션이 없어지면 넣을 때 번호를 흐리게 (xref.ts)
  xref: {
    attrs: { id: {}, label: { default: '' } }, inline: true, group: 'inline', atom: true, selectable: true, draggable: false,
    parseDOM: [{ tag: 'a[data-xref]', getAttrs: (d) => {
      const el = d as HTMLElement;
      return el.dataset.xref ? { id: el.dataset.xref, label: el.dataset.label ?? el.textContent ?? '' } : false;
    } }],
    toDOM: (n): DOMOutputSpec => {
      const cur = xrefLabel(n.attrs.id);
      return ['a', { class: `dn-xref${cur === null ? ' missing' : ''}`, 'data-xref': n.attrs.id, 'data-label': n.attrs.label, role: 'link', contenteditable: 'false' }, cur ?? (n.attrs.label || '참조')];
    },
  },
  // 링크 언급 (노션 붙여넣기 › 언급): 주소 + 모은 제목 · 사이트 이름 — 글 속 작은 칩(지구 선 아이콘 + 제목, 없으면 사이트 주소).
  // 누르면 새 탭(편집 중에도), 내보내기 · 검색에서는 [제목](주소) 링크로
  link_mention: {
    attrs: { href: {}, title: { default: '' }, site: { default: '' } }, inline: true, group: 'inline', atom: true, selectable: true, draggable: false,
    parseDOM: [{ tag: 'a[data-mention][href]', priority: 60, getAttrs: (d) => {
      const el = d as HTMLElement, href = el.getAttribute('href') ?? '';
      return safeHref(href) ? { href, title: el.dataset.title ?? '', site: el.dataset.site ?? '' } : false;
    } }],
    toDOM: (n): DOMOutputSpec => ['a', {
      class: 'dn-link-mention', href: n.attrs.href, 'data-mention': '', 'data-title': n.attrs.title, 'data-site': n.attrs.site,
      title: n.attrs.href, target: '_blank', rel: 'noopener noreferrer', contenteditable: 'false',
    }, mentionLabel(n.attrs as { href: string; title: string })],
  },
  /**
   * 날짜 멘션 (FR-133) — 'YYYY-MM-DD'만 저장, 글자는 그릴 때 오늘 기준(오늘 · 내일 · 10월 7일 (화)).
   * 알림 (FR-136): time('HH:MM')이 있으면 그 시각에 알림, repeat('' · 'daily' · 'weekly')
   */
  date_mention: {
    attrs: { date: { default: '' }, time: { default: '' }, repeat: { default: '' } }, inline: true, group: 'inline', atom: true, selectable: true, draggable: false,
    parseDOM: [{ tag: 'time[data-date]', getAttrs: (d) => ({ date: (d as HTMLElement).dataset.date ?? '', time: (d as HTMLElement).dataset.time ?? '', repeat: (d as HTMLElement).dataset.repeat ?? '' }) }],
    toDOM: (n): DOMOutputSpec => ['time', {
      class: `dn-date dn-date-${dateTense(n.attrs.date)}${n.attrs.time ? ' dn-date-remind' : ''}`, 'data-date': n.attrs.date, 'data-time': n.attrs.time || null, 'data-repeat': n.attrs.repeat || null,
      datetime: n.attrs.time ? `${n.attrs.date}T${n.attrs.time}` : n.attrs.date, contenteditable: 'false', title: n.attrs.date,
    }, dateLabel(n.attrs.date) + (n.attrs.time ? ` ${n.attrs.time}` : '')],
  },
  /** 별점 (노트형 NS-08) — value / max(정수, max ≤ 10). 그리기는 ★ · ☆, 원문에 등급 · 수치가 있을 때만 (AI) */
  rating: {
    attrs: { value: { default: 0 }, max: { default: 5 } }, inline: true, group: 'inline', atom: true, selectable: true, draggable: false,
    parseDOM: [{ tag: 'span[data-rating]', getAttrs: (d) => ({ value: Number((d as HTMLElement).dataset.rating) || 0, max: Number((d as HTMLElement).dataset.max) || 5 }) }],
    toDOM: (n): DOMOutputSpec => ['span', { class: 'dn-rating', 'data-rating': String(n.attrs.value), 'data-max': String(n.attrs.max), contenteditable: 'false', role: 'img', 'aria-label': `별점 ${ratingValue(n.attrs.value, n.attrs.max)} / ${ratingMax(n.attrs.max)}` }, ratingStars(n.attrs.value, n.attrs.max)],
  },
  /** 녹음 재생 시각 (FR-044 받아쓰기) — 누르면 그 녹음(ref = 녹음 콘텐츠 id)을 t초부터 재생(앱이 'dn-media-seek' 이벤트로). 글로는 [분:초] */
  media_time: {
    attrs: { t: { default: 0 }, ref: { default: '' } }, inline: true, group: 'inline', atom: true, selectable: true, draggable: false,
    parseDOM: [{ tag: 'span[data-media-t]', getAttrs: (d) => ({ t: Number((d as HTMLElement).dataset.mediaT) || 0, ref: (d as HTMLElement).dataset.ref ?? '' }) }],
    toDOM: (n): DOMOutputSpec => ['span', { class: 'dn-media-time', 'data-media-t': String(n.attrs.t), 'data-ref': n.attrs.ref, contenteditable: 'false', role: 'button', title: '이 시점부터 재생' }, mediaClock(n.attrs.t)],
  },
  /** 수식 (FR-018) — LaTeX 원문만 저장, 그리기는 KaTeX(math.ts) */
  math_inline: {
    attrs: { tex: { default: '' } }, inline: true, group: 'inline', atom: true, selectable: true, draggable: false,
    parseDOM: [{ tag: 'span[data-tex]', getAttrs: (d) => ({ tex: (d as HTMLElement).dataset.tex ?? '' }) }],
    toDOM: (n): DOMOutputSpec => ['span', { class: 'dn-math', 'data-tex': n.attrs.tex, contenteditable: 'false' }, n.attrs.tex || '수식'],
  },
  /** 각주 (워드) — 글 속에는 번호만(CSS 카운터), 글은 note 속성에 (footnote.ts) */
  footnote: {
    attrs: { note: { default: '' } }, inline: true, group: 'inline', atom: true, selectable: true, draggable: false,
    parseDOM: [{ tag: 'sup.dn-fn', getAttrs: (d) => ({ note: (d as HTMLElement).dataset.note ?? (d as HTMLElement).title ?? '' }) }],
    toDOM: (n): DOMOutputSpec => ['sup', { class: 'dn-fn', 'data-note': n.attrs.note, title: n.attrs.note ? `각주: ${n.attrs.note}` : '', contenteditable: 'false' }],
  },
  math_block: {
    attrs: { tex: { default: '' } }, group: 'block', atom: true, selectable: true, draggable: false, defining: true,
    parseDOM: [{ tag: 'div[data-tex]', getAttrs: (d) => ({ tex: (d as HTMLElement).dataset.tex ?? '' }) }],
    toDOM: (n): DOMOutputSpec => ['div', { class: 'dn-math-block', 'data-tex': n.attrs.tex, contenteditable: 'false' }, n.attrs.tex || '빈 수식'],
  },
  hard_break: {
    inline: true, group: 'inline', selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: (): DOMOutputSpec => ['br'],
  },
};

const marks: Record<string, MarkSpec> = {
  strong: {
    parseDOM: [{ tag: 'strong' }, { tag: 'b', getAttrs: (n) => (n as HTMLElement).style.fontWeight !== 'normal' && null },
      { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[5-9]\d{2,})$/.test(v as string) && null }],
    toDOM: (): DOMOutputSpec => ['strong', 0],
  },
  em: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: (): DOMOutputSpec => ['em', 0],
  },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM: (): DOMOutputSpec => ['u', 0],
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
    toDOM: (): DOMOutputSpec => ['s', 0],
  },
  // 형광펜 = 배경 색: 색이 없으면('') 기본 형광(노랑, CSS), 있으면 그 배경 — 노션의 고른 글자 배경 색
  highlight: {
    attrs: { color: { default: '' } },
    parseDOM: [{ tag: 'mark', getAttrs: (d) => ({ color: cleanColor((d as HTMLElement).dataset.bg) }) }],
    toDOM: (m): DOMOutputSpec => { const c = String(m.attrs.color || ''), css = c ? bgColorCss(c) : ''; return ['mark', css ? { 'data-bg': c, style: `background: ${css}` } : {}, 0]; },
  },
  // 키워드 칩 (노트형 NS-07) — 둥근 알약, 색은 이름(blue · yellow · green · pink · gray …)만. 경계에서 이어 쓰지 않는다
  chip: {
    attrs: { color: { default: '' } }, inclusive: false,
    parseDOM: [{ tag: 'span.dn-chip', getAttrs: (d) => ({ color: cleanColor((d as HTMLElement).dataset.chip) }) }],
    toDOM: (m): DOMOutputSpec => { const c = String(m.attrs.color || ''), css = c ? bgColorCss(c) : ''; return ['span', { class: 'dn-chip', ...(c ? { 'data-chip': c } : {}), ...(css ? { style: `background: ${css}` } : {}) }, 0]; },
  },
  // 고른 글자만 글자 색 (블록 전체 글자 색은 블록 필드 textColor) — 이름 · #rrggbb만
  textColor: {
    attrs: { color: { default: 'gray' } },
    parseDOM: [{ tag: 'span[data-tc]', getAttrs: (d) => { const c = cleanColor((d as HTMLElement).dataset.tc); return c ? { color: c } : false; } }],
    toDOM: (m): DOMOutputSpec => { const c = String(m.attrs.color), css = textColorCss(c); return ['span', css ? { 'data-tc': c, style: `color: ${css}` } : {}, 0]; },
  },
  // 고른 글자만 글자 크기 (상자 글자 크기 fontScale에 곱해진다, 0.5 ~ 4배)
  fontSize: {
    attrs: { scale: { default: 1 } },
    parseDOM: [{ tag: 'span[data-fs]', getAttrs: (d) => { const s = cleanScale((d as HTMLElement).dataset.fs); return s ? { scale: s } : false; } }],
    toDOM: (m): DOMOutputSpec => { const s = cleanScale(m.attrs.scale); return ['span', s ? { 'data-fs': String(s), style: `font-size: ${s}em` } : {}, 0]; },
  },
  // 고른 글자만 글꼴 (명조 · 고정폭, 상자 글꼴은 블록 필드 fontFamily)
  fontFamily: {
    attrs: { family: { default: 'serif' } },
    parseDOM: [{ tag: 'span[data-ff]', getAttrs: (d) => { const f = (d as HTMLElement).dataset.ff; return f === 'serif' || f === 'mono' ? { family: f } : false; } }],
    toDOM: (m): DOMOutputSpec => ['span', m.attrs.family === 'serif' || m.attrs.family === 'mono' ? { 'data-ff': m.attrs.family } : {}, 0],
  },
  /** 위 첨자 · 아래 첨자 — 둘은 함께 걸 수 없다 */
  sup: { excludes: 'sup sub', parseDOM: [{ tag: 'sup' }], toDOM: (): DOMOutputSpec => ['sup', 0] },
  sub: { excludes: 'sup sub', parseDOM: [{ tag: 'sub' }], toDOM: (): DOMOutputSpec => ['sub', 0] },
  /** 댓글 단 글 (FR-132) — id는 블록 댓글의 anchor. 겹쳐 달 수 있고, 표시 끝에서 이어 쓴 글에는 번지지 않는다 */
  comment: {
    attrs: { id: { default: '' } }, inclusive: false, excludes: '',
    parseDOM: [{ tag: 'span[data-comment]', getAttrs: (d) => ({ id: (d as HTMLElement).dataset.comment ?? '' }) }],
    toDOM: (m): DOMOutputSpec => ['span', { class: 'dn-comment-mark', 'data-comment': m.attrs.id }, 0],
  },
  code: {
    excludes: '_',
    parseDOM: [{ tag: 'code' }],
    toDOM: (): DOMOutputSpec => ['code', 0],
  },
  link: {
    attrs: { href: {} }, inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (d) => {
      const href = (d as HTMLElement).getAttribute('href') ?? '';
      return safeHref(href) ? { href } : false;
    } }],
    toDOM: (m): DOMOutputSpec => ['a', { ...(safeHref(String(m.attrs.href ?? '')) ? { href: m.attrs.href } : {}), rel: 'noopener noreferrer', target: '_blank' }, 0], // 저장된 값도 다시 거른다 (보안 1-7)
  },
};

let titleOf: (id: string) => string | null = () => null;
let xrefOf: (id: string) => string | null = () => null;

/** 글자 크기 배율 0.5 ~ 4 (1은 표시 없음 = null) */
export function cleanScale(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0.5 && n <= 4 && Math.abs(n - 1) > 1e-6 ? Math.round(n * 1000) / 1000 : null;
}

/** 앱이 알려 주는 노트 제목 (없는 노트 · 휴지통이면 null). 바뀌면 refreshNoteLinks로 화면의 링크 글자를 다시 쓴다. */
export function setNoteTitleResolver(fn: (id: string) => string | null): void { titleOf = fn; }

/** 링크에 보일 현재 제목 */
export function noteTitle(id: string): string | null { return titleOf(id); }

/** 이미 그려진 노트 링크의 글자를 현재 제목으로 (정적 렌더 · 편집 중 모두) */
export function refreshNoteLinks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('a.dn-note-link[data-note]').forEach((a) => {
    const cur = noteTitle(a.dataset.note!);
    const text = cur ?? (a.dataset.title || '없는 노트');
    if (a.textContent !== text) a.textContent = text;
    a.classList.toggle('missing', cur === null);
  });
}

/** 앱이 알려 주는 상호 참조 번호 ('그림 3', 캡션이 없으면 null). 바뀌면 refreshXrefs로 화면의 글자를 다시 쓴다 */
export function setXrefResolver(fn: (id: string) => string | null): void { xrefOf = fn; }

export function xrefLabel(id: string): string | null { return xrefOf(id); }

/** 이미 그려진 상호 참조 글자를 지금 번호로 (정적 렌더 · 편집 중 모두) */
export function refreshXrefs(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('a.dn-xref[data-xref]').forEach((a) => {
    const cur = xrefLabel(a.dataset.xref!);
    const text = cur ?? (a.dataset.label || '참조');
    if (a.textContent !== text) a.textContent = text;
    a.classList.toggle('missing', cur === null);
  });
}

export const CALLOUT_COLORS = ['yellow', 'blue', 'green', 'red', 'purple', 'gray'];
export const CALLOUT_ICONS = ['bulb', 'info', 'alert', 'check', 'question', 'star', 'pin', 'pencil', 'flag', 'bookmark', 'heart', 'target'] as const;

function calloutIconSpec(icon: string): DOMOutputSpec {
  const name = resolveIcon(icon);
  return name
    ? ['span', { class: 'dn-callout-icon', contenteditable: 'false', 'data-icon': icon },
      [`${SVG} svg`, { ...ICON_SVG_ATTRS, width: '16', height: '16', 'aria-hidden': 'true' }, [`${SVG} path`, { d: ICON_PATHS[name] }]]]
    : ['span', { class: 'dn-callout-icon', contenteditable: 'false' }, icon];
}

/** 링크 언급 칩 글자: 모은 제목, 없으면 사이트 주소(www. 뺌) */
export function mentionLabel(a: { href: string; title?: string }): string {
  if (a.title) return a.title;
  try { return new URL(a.href).hostname.replace(/^www\./, '') || a.href; } catch { return a.href; }
}

/** 허용 스킴만 (SECURITY 5.1). */
export function safeHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim());
}

export const schema = new Schema({ nodes, marks });

/** 재생 시각 칩을 눌렀다 — 앱이 그 녹음을 찾아 그 시점부터 재생한다 (편집 중 · 캔버스 · 문서 뷰 공통). detail: { ref, t } */
export const MEDIA_SEEK = 'dn-media-seek';
export function mediaSeek(el: HTMLElement): void {
  el.dispatchEvent(new CustomEvent(MEDIA_SEEK, { bubbles: true, detail: { ref: el.dataset.ref ?? '', t: Number(el.dataset.mediaT) || 0 } }));
}

/** 재생 시각 글자 — 1:05 · 1:02:03 (초는 내림) */
export function mediaClock(t: unknown): string {
  const s = Math.max(0, Math.floor(Number(t) || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** 별점 최댓값 (1 ~ 10) · 값 (0 ~ 최댓값, 정수) */
export function ratingMax(max: unknown): number { const m = Math.round(Number(max) || 5); return Math.max(1, Math.min(10, m)); }
export function ratingValue(value: unknown, max: unknown): number { return Math.max(0, Math.min(ratingMax(max), Math.round(Number(value) || 0))); }
/** ★★★★☆ */
export function ratingStars(value: unknown, max: unknown): string { const m = ratingMax(max), v = ratingValue(value, max); return '★'.repeat(v) + '☆'.repeat(m - v); }
