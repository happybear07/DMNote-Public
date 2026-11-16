// 웹 북마크 · 임베드 그리기 (FR-050 · FR-051): 주소가 없으면 주소 넣기 칸, 북마크는 카드(제목 · 설명 · 주소 · 그림),
// 임베드는 머리 줄(서비스 · ↗ 열기 · 카드로) + iframe. 캔버스에서는 iframe 위에 덮개를 둬서 끌기 · 고르기를 캔버스가 받고,
// 두 번 누르면 덮개를 걷어 그 안을 쓴다(다른 곳을 누르면 다시 덮음). 허용 목록 밖 주소는 카드로 대신한다.
// 제목 · 설명이 없으면 앱이 넘긴 unfurl로 한 번 모아 채운다(실행 취소 대상 아님).
import { embedTarget, setWebContent, setWebMeta, webUrl, type Engine, type WebContent, type WebMeta, type WebView } from '@dn/engine-core';

export interface WebHost {
  /** 주소의 제목 · 설명 · 그림 — 못 가져오면 null (배포 판은 서버가 없어 늘 null) */
  unfurl?(url: string): Promise<WebMeta | null>;
}

export interface WebRenderOpts {
  engine: Engine;
  readOnly?: boolean;
  host?: WebHost;
  /** 캔버스: iframe 덮개 (끌기 · 고르기를 캔버스가 받게) */
  shield?: boolean;
}

/** 한 번 모으려 한 주소 (실패해도 다시 묻지 않는다 — 다시 그릴 때마다 요청하지 않게) */
const asked = new Set<string>();

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const x = document.createElement(tag);
  x.className = cls;
  if (text !== undefined) x.textContent = text;
  return x;
};

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

function openLink(url: string, label: string): HTMLAnchorElement {
  const a = el('a', 'dn-web-open dn-ui', label);
  const safe = webUrl(url); // 저장된 주소도 http(s)만 (보안 1-7)
  if (safe) a.href = safe;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = `${url} — 새 탭에서 열기`;
  return a;
}

export function renderWeb(c: WebContent, root: HTMLElement, o: WebRenderOpts): void {
  root.className = 'dn-web';
  if (!c.url) { renderInput(c, root, o); return; }
  const t = c.view === 'embed' ? embedTarget(c.url) : null;
  if (t) {
    root.classList.add('dn-web-embed');
    const head = el('div', 'dn-web-head');
    head.append(el('span', 'dn-web-provider', t.provider), el('span', 'dn-web-host', c.title || hostOf(c.url)), openLink(c.url, '↗ 열기'));
    if (!o.readOnly) head.append(viewButton(c, 'bookmark', o.engine));
    const frame = el('div', 'dn-web-frame');
    if (t.height) frame.style.height = `${t.height}px`; else frame.style.aspectRatio = String(t.ratio);
    const f = document.createElement('iframe');
    f.src = t.src;
    f.title = `${t.provider} — ${c.title || c.url}`;
    f.loading = 'lazy';
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms');
    frame.append(f);
    if (o.shield) frame.append(shield());
    root.replaceChildren(head, frame);
    return;
  }
  renderCard(c, root, o, c.view === 'embed');
}

function renderCard(c: WebContent, root: HTMLElement, o: WebRenderOpts, notEmbeddable: boolean): void {
  root.classList.add('dn-web-card');
  const text = el('div', 'dn-web-text');
  const title = openLink(c.url, c.title || hostOf(c.url));
  title.className = 'dn-web-title dn-ui';
  text.append(title);
  if (c.description) text.append(el('div', 'dn-web-desc', c.description));
  const foot = el('div', 'dn-web-url');
  foot.append(el('span', '', c.site ? `${c.site} · ${c.url}` : c.url));
  text.append(foot);
  if (notEmbeddable) text.append(el('div', 'dn-web-note', '이 주소는 끼워 넣을 수 없어 카드로 보여요'));
  else if (!o.readOnly && embedTarget(c.url)) foot.append(viewButton(c, 'embed', o.engine));
  const kids: HTMLElement[] = [text];
  if (c.image) {
    const img = el('img', 'dn-web-thumb');
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.draggable = false;
    img.addEventListener('error', () => img.remove());
    img.src = c.image;
    kids.push(img);
  }
  root.replaceChildren(...kids);
  // 제목 · 설명이 없으면 한 번 모은다
  if (!o.readOnly && o.host?.unfurl && !c.title && !c.description && !asked.has(`${c.id}|${c.url}`)) {
    asked.add(`${c.id}|${c.url}`);
    void o.host.unfurl(c.url).then((m) => { if (m && (m.title || m.description || m.image)) setWebMeta(o.engine, c.id, c.url, m); }, () => {});
  }
}

/** 카드 ↔ 끼워 넣기 */
function viewButton(c: WebContent, to: WebView, engine: Engine): HTMLButtonElement {
  const b = el('button', 'dn-web-view dn-ui', to === 'embed' ? '끼워 넣어 보기' : '카드로 보기');
  b.type = 'button';
  b.addEventListener('click', (e) => { e.stopPropagation(); setWebContent(engine, c.id, { view: to }); });
  return b;
}

/** iframe 덮개 — 캔버스가 끌기 · 고르기를 받게. 두 번 누르기는 캔버스(handleDblClick)가 받아 liveWeb으로 걷는다 (포인터를 캔버스가 잡고 있어서) */
function shield(): HTMLDivElement {
  const s = el('div', 'dn-web-shield');
  s.title = '두 번 누르면 이 안을 써요';
  return s;
}

/** 덮개를 걷어 iframe 안을 쓰게 — 블록 밖을 누르면 다시 덮는다 */
export function liveWeb(root: HTMLElement): void {
  if (root.classList.contains('dn-web-live')) return;
  root.classList.add('dn-web-live');
  const off = (ev: PointerEvent) => {
    if (root.contains(ev.target as Node)) return;
    root.classList.remove('dn-web-live');
    document.removeEventListener('pointerdown', off, true);
  };
  document.addEventListener('pointerdown', off, true);
}

/** 주소 넣기 칸 (노션 /bookmark · /embed를 막 넣었을 때) */
function renderInput(c: WebContent, root: HTMLElement, o: WebRenderOpts): void {
  root.classList.add('dn-web-empty');
  if (c.view === 'embed') root.classList.add('dn-web-empty-embed');
  const label = c.view === 'embed' ? '웹 임베드 — 유튜브 · 비메오 · 피그마 · 구글 지도 · 코드펜 · 룸 · 스포티파이 · 구글 문서' : '웹 북마크 — 주소를 넣으면 제목 · 설명 카드로';
  if (o.readOnly) { root.replaceChildren(el('div', 'dn-web-note', `${label} (주소 없음)`)); return; }
  const form = el('form', 'dn-web-input dn-ui');
  form.noValidate = true; // 브라우저 자체 검사 말풍선 대신 아래 안내로
  const input = el('input', '');
  input.type = 'url';
  input.placeholder = '웹 주소 붙여넣기 (https://…)';
  input.setAttribute('aria-label', c.view === 'embed' ? '임베드할 웹 주소' : '북마크할 웹 주소');
  input.spellcheck = false;
  const ok = el('button', 'dn-web-ok', c.view === 'embed' ? '끼워 넣기' : '북마크 만들기');
  ok.type = 'submit';
  const msg = el('div', 'dn-web-note', label);
  form.append(input, ok);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = webUrl(input.value);
    if (!url) { msg.textContent = 'http:// 또는 https://로 시작하는 주소를 넣어 주세요'; msg.classList.add('dn-web-err'); input.focus(); return; }
    setWebContent(o.engine, c.id, { url });
  });
  // 캔버스 · 문서의 키(지우기 · 방향키 …)가 입력을 가로채지 않게
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') input.blur(); });
  root.replaceChildren(form, msg);
}
