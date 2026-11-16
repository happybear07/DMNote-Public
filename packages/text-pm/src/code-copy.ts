// 코드 블록 '복사' 단추 (노션): 코드 위에 마우스를 올리면 오른쪽 위에 뜨고, 누르면 코드 글을 클립보드로.
// 단추는 하나만 body에 띄운다 — 글 DOM 안에 넣으면 HTML · PDF 내보내기(문서 DOM 복제)와 PDF 글자 층에 '복사'가 섞인다.
// 정적 렌더 · 편집 중 모두 같은 단추. 누르는 동안 편집기 초점을 빼앗지 않는다(dn-editor-pop).

let btn: HTMLButtonElement | null = null;
let target: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
/** 단 class만 뗀다 (없는 class를 떼도 편집기 DOM이 바뀐 것으로 잡힐 수 있어서) */
const unmark = (el: HTMLElement | null) => { if (el?.classList.contains('dn-code-hover')) el.classList.remove('dn-code-hover'); };

function hide(): void {
  if (!btn) return;
  btn.hidden = true;
  unmark(target);
  target = null;
}

function show(pre: HTMLElement): void {
  if (!btn) return;
  if (target !== pre) {
    unmark(target);
    target = pre;
    // 정적 글만 언어 이름(::before)을 단추 밑에서 숨긴다 — 편집기 DOM에 class를 달면 ProseMirror가 그 코드를 다시 그려 pre가 바뀐다
    if (!pre.closest('.ProseMirror')) pre.classList.add('dn-code-hover');
    btn.textContent = '복사';
  }
  btn.hidden = false;
  const r = pre.getBoundingClientRect();
  // 편집 중이면 언어 고르기 칸 왼쪽에
  const lang = pre.querySelector(':scope > .dn-code-lang')?.getBoundingClientRect();
  const right = lang?.width ? lang.left - 4 : r.right - 4;
  btn.style.top = `${r.top + 3}px`;
  btn.style.left = `${right - btn.offsetWidth}px`;
}

/** 처음 그릴 때 한 번 (정적 렌더 · 편집기) */
export function installCodeCopy(): void {
  if (btn || typeof document === 'undefined') return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dn-code-copy dn-ui dn-editor-pop';
  b.setAttribute('aria-label', '코드 복사');
  b.hidden = true;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const code = target?.isConnected ? target.querySelector('code') : null;
    if (!code) { hide(); return; }
    const text = code.textContent ?? '';
    void navigator.clipboard?.writeText(text).then(() => {
      b.textContent = '복사됨';
      clearTimeout(timer);
      timer = setTimeout(() => { if (b.textContent === '복사됨') b.textContent = '복사'; }, 1200);
    }, () => { b.textContent = '복사 못 함'; });
  });
  document.body.append(b);
  btn = b;
  document.addEventListener('pointerover', (e) => {
    const t = e.target as Element | null;
    if (!t || t === b) return;
    const pre = t.closest?.('.dn-text pre');
    if (pre instanceof HTMLElement) show(pre); else hide();
  }, true);
  // 스크롤하면 코드를 따라가고(화면 밖이면 숨김), 캔버스를 휠로 옮기거나 확대하면 숨긴다
  let raf = 0;
  document.addEventListener('scroll', () => {
    if (!target || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = target?.isConnected ? target.getBoundingClientRect() : null;
      if (r && r.bottom > 0 && r.top < innerHeight) show(target!); else hide();
    });
  }, true);
  document.addEventListener('wheel', (e) => { if (!(e.target instanceof Element && e.target.closest('.doc-scroll'))) hide(); }, { capture: true, passive: true });
}
