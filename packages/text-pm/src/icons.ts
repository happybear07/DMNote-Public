// 단색 선 아이콘 (24×24, 선 굵기 1.75, 색은 currentColor). 앱 화면(React)과 콜아웃(ProseMirror)이 같이 쓴다.
// 색 있는 이모지는 기기 · 글꼴마다 모양이 달라 화면 톤이 깨지므로 UI에는 쓰지 않는다.

const C9 = 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z';

export const ICON_PATHS = {
  // 앱 화면
  note: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h4',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  folderOpen: 'M3 17V7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1M3 17l2.2-5.6A2 2 0 0 1 7.1 10H20a1 1 0 0 1 .9 1.4l-2.4 6.4A2 2 0 0 1 16.6 19H5a2 2 0 0 1-2-2z',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM12 10.5v5M9.5 13h5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M17 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM11 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  goto: 'M5 12h14M13 6l6 6-6 6',
  checkSquare: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zM8.5 12l2.5 2.5 4.5-5',
  plus: 'M12 5v14M5 12h14',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  home: 'M3 11l9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  command: 'M4 6l5 6-5 6M12 18h8',
  panel: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5zM15 4v16',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7c1.9 0 3.6-.6 5.1-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2',
  // 넣기 메뉴 · 슬래시 메뉴
  table: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5zM4 10h16M4 15h16M10 4v16',
  chart: 'M4 4v16h16M8 16v-4M12 16V8M16 16v-6',
  image: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zM4 16l4.5-4.5a1.5 1.5 0 0 1 2.1 0L16 17M14 14l1.5-1.5a1.5 1.5 0 0 1 2.1 0L20 15M15.5 8.5h.01',
  paperclip: 'M20 11.5l-7.6 7.6a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  sigma: 'M18 5H6l6 7-6 7h12',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  text: 'M5 6h14M5 11h14M5 16h9',
  heading: 'M6 4v16M18 4v16M6 12h12',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  listOrdered: 'M10 6h10M10 12h10M10 18h10M4 5l1-1v4M4 14h2l-2 3h2',
  quote: 'M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6',
  toggle: 'M8 6l5 5-5 5M15 18h5',
  divider: 'M3 12h18',
  calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7',
  video: 'M4 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7zM16 10.5l5-3v9l-5-3',
  audio: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  // 문서 서식 막대
  highlight: 'M14.5 4.5l5 5L11 18H6v-5l8.5-8.5zM12 7l5 5M6 18l-2 2M13 21h7',
  lineSpacing: 'M4 7l3-3 3 3M7 4v16M4 17l3 3 3-3M13 6h8M13 12h8M13 18h8',
  pageBreak: 'M6 3v5h12V3M6 21v-5h12v5M3 12h2.5M8.5 12h3M14.5 12h3M20.5 12h.5',
  pageSetup: 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 7h8M8 17h8M9 10.5h6M9 13.5h4',
  comment: 'M4 5h16v11H10l-5 4v-4H4z',
  columns: 'M4 5h6v14H4zM14 5h6v14h-6z',
  mathInline: 'M3 12h3l3 7 4-15h8M14 10l6 6M20 10l-6 6',
  pages: 'M9 3h7l4 4v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM16 3v4h4M5 7v13a1 1 0 0 0 1 1h10',
  // 콜아웃 아이콘 (FR-048)
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2v.5h5V16c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z',
  info: `${C9}M12 11v5M12 8h.01`,
  alert: 'M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 9.5v4M12 17h.01',
  check: `${C9}m8 12 3 3 5-6`,
  question: `${C9}M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.9-.9 1.5v.4M12 17h.01`,
  star: 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  pin: 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  footnote: 'M4 8h9M4 12h9M4 16h6M17 5.5l2-1.5v6',
  omega: 'M5 19h4.5v-2.3A6.5 6.5 0 1 1 14.5 16.7V19H19',
  xref: 'M10 4 8 20M16 4l-2 16M5 9h15M4 15h15',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  chevronLeft: 'M15 6l-6 6 6 6',
  rotate: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
  chevronRight: 'M9 6l6 6-6 6',
  brush: 'M14.5 4.5l5 5-7 7-5-5zM7.5 11.5l-2.2 2.2c-1.4 1.4-1 3-2.3 4.3 2.1.7 4.8.4 6.3-1.1l2.2-2.2',
  globe: `${C9}M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3`,
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  target: `${C9}M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0zM12 12h.01`,
  play: 'M8 5.5v13l10.5-6.5z',
  // 디자인 단순화 (DS-F6) — 글자 기호 대신
  minus: 'M5 12h14',
  more: 'M6.5 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM19.5 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
  close: 'M6 6l12 12M18 6L6 18',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  fit: 'M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4',
  block: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zM8 8h8v3H8zM8 14h5',
  gallery: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  board: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  timeline: 'M4 6h9M8 12h12M4 18h7',
  smile: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function isIconName(s: unknown): s is IconName {
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(ICON_PATHS, s);
}

/** 초기 버전 콜아웃에 저장된 이모지 → 같은 뜻의 선 아이콘 (데이터는 그대로, 보이는 모양만) */
const LEGACY_EMOJI: Record<string, IconName> = {
  '💡': 'bulb', '📌': 'pin', '⚠️': 'alert', '⚠': 'alert', '✅': 'check', '❗': 'alert', '📝': 'pencil', '🔥': 'flag',
  '💬': 'info', 'ℹ️': 'info', '⭐': 'star', '🎯': 'target', '🚧': 'alert',
};

/** 콜아웃 icon 값 → 그릴 아이콘 이름 (모르는 값이면 null — 글자 그대로 보여 준다) */
export function resolveIcon(icon: unknown): IconName | null {
  if (isIconName(icon)) return icon;
  return typeof icon === 'string' ? LEGACY_EMOJI[icon] ?? null : null;
}

export const ICON_SVG_ATTRS = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
} as const;

/** DOM용 아이콘 요소 (React 밖 — 콜아웃 · 슬래시 메뉴) */
export function iconElement(name: IconName, size = 16): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries(ICON_SVG_ATTRS)) svg.setAttribute(k, v);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.appendChild(path);
  return svg;
}
