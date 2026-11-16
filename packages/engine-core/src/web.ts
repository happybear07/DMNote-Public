// 웹 북마크 · 임베드 (FR-050 · FR-051, 노션 /bookmark · /embed): 웹 주소 하나를 카드(제목 · 설명 · 그림)나 끼워 넣은 화면으로 보여 주는 콘텐츠.
// 끼워 넣기는 허용한 서비스만(유튜브 · 비메오 · 피그마 · 구글 지도 · 코드펜 · 룸 · 스포티파이 · 구글 문서) — 나머지 주소는 카드로 대신한다.
// 주소가 비어 있으면 "주소 넣기" 칸으로 그린다(슬래시 · 넣기 메뉴로 막 만든 블록).
import type { Engine, TxResult } from './engine';
import type { Content, Id } from './model';
import type { Vec2 } from './geom';
import { DOC_GAP } from './doc-edit';

export type WebView = 'bookmark' | 'embed';
/** 주소에서 모은 정보 (개발 서버의 /api/unfurl) — 없으면 주소 · 사이트 이름만 */
export interface WebMeta {
  readonly title?: string;
  readonly description?: string;
  /** 미리보기 그림 주소 (https · http만) */
  readonly image?: string;
  readonly site?: string;
}
export type WebContent = Content & WebMeta & { readonly type: 'web'; readonly url: string; readonly view: WebView };

export function isWebContent(c: Content | undefined): c is WebContent {
  return !!c && c.type === 'web' && typeof (c as WebContent).url === 'string';
}

/** 글 → 웹 주소 (http · https만, 앞뒤 공백 무시). 아니면 null */
export function webUrl(text: string): string | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  try { return new URL(t).href; } catch { return null; }
}

export interface EmbedTarget {
  /** iframe 주소 */
  readonly src: string;
  readonly provider: string;
  /** 가로 ÷ 세로 (height가 있으면 그것) */
  readonly ratio: number;
  /** 높이가 정해진 플레이어 (스포티파이) */
  readonly height?: number;
}

const YT_ID = /^[\w-]{6,20}$/;

/** 끼워 넣을 수 있는 주소면 iframe 주소 · 서비스 이름 · 비율. 허용 목록 밖이면 null (카드로 대신) */
export function embedTarget(url: string): EmbedTarget | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, ''), path = u.pathname;
  if (host === 'youtu.be' || host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    const id = host === 'youtu.be' ? path.slice(1).split('/')[0] : u.searchParams.get('v') ?? path.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1];
    if (!id || !YT_ID.test(id)) return null;
    const t = parseInt(u.searchParams.get('t') ?? u.searchParams.get('start') ?? '', 10);
    return { src: `https://www.youtube-nocookie.com/embed/${id}${t > 0 ? `?start=${t}` : ''}`, provider: 'YouTube', ratio: 16 / 9 };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = path.match(/(?:^|\/)(\d{5,})(?:$|\/)/)?.[1];
    return id ? { src: `https://player.vimeo.com/video/${id}`, provider: 'Vimeo', ratio: 16 / 9 } : null;
  }
  if (host === 'figma.com' && /^\/(file|design|proto|board|slides)\/[\w-]+/.test(path)) {
    return { src: `https://www.figma.com/embed?embed_host=damiannote&url=${encodeURIComponent(u.href)}`, provider: 'Figma', ratio: 4 / 3 };
  }
  if ((host === 'google.com' || host === 'maps.google.com') && path.startsWith('/maps')) {
    if (path.startsWith('/maps/embed')) return { src: u.href, provider: 'Google 지도', ratio: 4 / 3 };
    // 장소 · 좌표 · 검색 주소는 키 없이 되는 output=embed 주소로
    const name = path.match(/^\/maps\/(?:place|search)\/([^/]+)/)?.[1] ?? '';
    let q = u.searchParams.get('q') ?? '';
    try { q ||= decodeURIComponent(name).replace(/\+/g, ' '); } catch { /* 깨진 주소 — 좌표로 */ }
    const at = path.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const query = q || (at ? `${at[1]},${at[2]}` : '');
    return query ? { src: `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed`, provider: 'Google 지도', ratio: 4 / 3 } : null;
  }
  if (host === 'codepen.io') {
    const m = path.match(/^\/([\w-]+)\/(?:pen|embed|full)\/([\w-]+)/);
    return m ? { src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`, provider: 'CodePen', ratio: 4 / 3 } : null;
  }
  if (host === 'loom.com') {
    const id = path.match(/^\/(?:share|embed)\/([\da-f]{16,})/)?.[1];
    return id ? { src: `https://www.loom.com/embed/${id}`, provider: 'Loom', ratio: 16 / 9 } : null;
  }
  if (host === 'open.spotify.com') {
    const m = path.match(/^\/(?:intl-[\w-]+\/)?(?:embed\/)?(track|album|playlist|episode|show|artist)\/(\w+)/);
    return m ? { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, provider: 'Spotify', ratio: 2, height: m[1] === 'track' || m[1] === 'episode' ? 152 : 352 } : null;
  }
  if (host === 'docs.google.com') {
    const m = path.match(/^\/(document|spreadsheets|presentation)\/d\/([\w-]+)/);
    return m ? { src: `https://docs.google.com/${m[1]}/d/${m[2]}/preview`, provider: 'Google 문서', ratio: 4 / 3 } : null;
  }
  return null;
}

/** 이 주소의 블록 크기 — 카드는 낮게, 끼워 넣기는 서비스 비율대로 (머리 줄 28px 포함) */
export function webBlockSize(url: string, view: WebView, w = 480): { w: number; h: number } {
  // 빈 임베드는 16:9 자리를 먼저 잡는다 — 주소를 넣은 뒤 커지면서 옆 블록과 겹치지 않게 (다른 블록은 움직이지 않으므로)
  const t = view === 'embed' ? (url ? embedTarget(url) : { ratio: 16 / 9, height: undefined }) : null;
  if (t) return { w, h: Math.round((t.height ?? w / t.ratio) + 28) };
  return { w: Math.min(w, 440), h: url ? 104 : 88 };
}

/** 웹 블록 만들기 — 실행 취소 한 번. url이 비면 주소 넣기 칸 */
export function createWebBlock(engine: Engine, at: Vec2, url: string, view: WebView, meta: WebMeta = {}): TxResult<{ blockId: Id; contentId: Id }> {
  const size = webBlockSize(url, view);
  return engine.transact((tx) => {
    const blockId = tx.createBlock({ x: at.x, y: at.y, ...size });
    const contentId = tx.createContent({ blockId, type: 'web', url, view, ...meta } as never);
    return { blockId, contentId };
  }, { origin: 'user', label: view === 'embed' ? '웹 임베드' : '웹 북마크' });
}

/** 주소 · 보기 바꾸기 (사용자 — 실행 취소 대상). 정보(meta)는 주소가 바뀌면 비운다 */
export function setWebContent(engine: Engine, contentId: Id, patch: { url?: string; view?: WebView }): TxResult<void> {
  return engine.transact((tx) => {
    const c = engine.getContent(contentId);
    if (!isWebContent(c)) return tx.fail('웹 블록이 아님');
    const urlChanged = patch.url !== undefined && patch.url !== c.url;
    tx.set('content', contentId, { ...patch, ...(urlChanged ? { title: undefined, description: undefined, image: undefined, site: undefined } : {}) });
    // 끼워 넣어 보기로 커지면 블록을 그 높이로 · 아래 상자는 겹치지 않을 만큼 내린다 — 캔버스에서 덮지 않게, 문서 뷰 넣기와 같게 (DQ-024)
    const b = engine.getBlock(c.blockId);
    const want = b ? webBlockSize(patch.url ?? c.url, patch.view ?? c.view, b.w).h : 0;
    if (b && want > b.h) {
      const below = [...engine.blocks()].filter((x) => x.id !== b.id && x.y >= b.y + b.h - 1);
      const first = below.reduce((m, x) => Math.min(m, x.y), Infinity);
      const dy = Number.isFinite(first) ? Math.max(0, b.y + want + DOC_GAP - first) : 0;
      tx.set('block', b.id, { h: want });
      if (dy) for (const x of below) tx.set('block', x.id, { y: x.y + dy });
    }
  }, { origin: 'user', label: patch.view && !patch.url ? (patch.view === 'embed' ? '끼워 넣어 보기' : '카드로 보기') : '웹 주소' });
}

/** 모아 온 정보 채우기 — 저절로 한 일이라 실행 취소 대상이 아니다. 그 사이 주소가 바뀌었으면 버린다 */
export function setWebMeta(engine: Engine, contentId: Id, url: string, meta: WebMeta): TxResult<void> {
  return engine.transact((tx) => {
    const c = engine.getContent(contentId);
    if (!isWebContent(c) || c.url !== url) return tx.fail('주소가 바뀜');
    const clean: Record<string, string> = {};
    for (const k of ['title', 'description', 'site'] as const) { const v = meta[k]?.replace(/\s+/g, ' ').trim().slice(0, k === 'description' ? 300 : 200); if (v) clean[k] = v; }
    const img = meta.image && webUrl(meta.image);
    if (img) clean.image = img;
    tx.set('content', contentId, clean);
  }, { origin: 'user', undoable: false, label: '웹 정보' });
}
