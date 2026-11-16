import type { FormatCommand } from './format';
import type { TextEditor } from './editor';
import { iconElement, type IconName } from './icons';
import { colorPanel } from './bubble-color';
import { markColorAt } from './mark-style';
import { bgColorCss, textColorCss } from './text-colors';

// ───────── 서식 툴바 (Figma 07 · 서식 툴바) ─────────
// 늘 보이는 것은 글자 꾸밈 · 색 · '바꾸기' · 댓글 · ⋯ 열한 개 안팎 (DS-008 — 한 줄 18개가 너무 많았다).
// 제목 · 목록 · 인용 · 수식은 '바꾸기 ▾', 블록으로 분리는 '⋯' 안에. 판은 한 번에 하나만 연다.
const BUBBLE_ITEMS: { cmd: FormatCommand; label: string; title: string; icon?: IconName }[] = [
  { cmd: 'strong', label: 'B', title: '굵게 (Ctrl+B)' },
  { cmd: 'em', label: 'I', title: '기울임 (Ctrl+I)' },
  { cmd: 'underline', label: 'U', title: '밑줄 (Ctrl+U)' },
  { cmd: 'strike', label: 'S', title: '취소선 (Ctrl+Shift+X)' },
  { cmd: 'code', label: '', icon: 'code', title: '인라인 코드 (Ctrl+E)' },
  { cmd: 'link', label: '', icon: 'link', title: '링크' },
  { cmd: 'highlight', label: '', icon: 'highlight', title: '형광펜 (Ctrl+Shift+H)' },
  { cmd: 'h1', label: 'H1', title: '제목 1 (Ctrl+Alt+1)' },
  { cmd: 'h2', label: 'H2', title: '제목 2 (Ctrl+Alt+2)' },
  { cmd: 'h3', label: 'H3', title: '제목 3 (Ctrl+Alt+3)' },
  { cmd: 'bullet', label: '', icon: 'list', title: '글머리 목록' },
  { cmd: 'ordered', label: '', icon: 'listOrdered', title: '번호 목록' },
  { cmd: 'task', label: '', icon: 'checkSquare', title: '할 일' },
  { cmd: 'quote', label: '', icon: 'quote', title: '인용' },
  { cmd: 'mathInline', label: '', icon: 'mathInline', title: '수식으로 — 고른 글을 LaTeX 수식으로 (Ctrl+Shift+E)' },
];
const MARKS: FormatCommand[] = ['strong', 'em', 'underline', 'strike', 'code', 'link'];
const TURN: FormatCommand[] = ['h1', 'h2', 'h3', 'bullet', 'ordered', 'task', 'quote', 'mathInline'];
const item = (cmd: FormatCommand) => BUBBLE_ITEMS.find((x) => x.cmd === cmd)!;
const plain = (title: string) => title.replace(/ \(.*\)$/, '').replace(/ — .*$/, '');

export class Bubble {
  private readonly el: HTMLDivElement;
  private readonly buttons = new Map<FormatCommand, HTMLButtonElement>();
  /** 글자 색 단추 (A — 밑줄이 지금 색) · 열린 판 (색 · 바꾸기 · ⋯ 중 하나) */
  private colorBtn: HTMLButtonElement | null = null;
  private panel: HTMLDivElement | null = null;
  private turnPop: HTMLDivElement | null = null;
  private morePop: HTMLDivElement | null = null;

  constructor(private readonly editor: TextEditor, private readonly overlay: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dn-bubble';
    this.el.hidden = true;
    const sep = () => this.el.appendChild(Object.assign(document.createElement('span'), { className: 'dn-bubble-sep' }));
    const btn = (parent: HTMLElement, label: string, title: string, onClick: () => void, icon?: IconName) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, title });
      b.setAttribute('aria-label', title.replace(/ \(.*\)$/, ''));
      if (icon) b.prepend(iconElement(icon, 15));
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', onClick);
      return parent.appendChild(b);
    };
    const cmdBtn = (parent: HTMLElement, cmd: FormatCommand, withName = false) => {
      const it = item(cmd);
      // 문서 뷰에서 Ctrl+E는 가운데 맞춤 — 인라인 코드 단축키 안내는 캔버스에서만 (DQ-030)
      const title = cmd === 'code' && this.editor.view.dom.closest('.dn-doc') ? '인라인 코드' : it.title;
      const b = btn(parent, withName ? '' : it.label, title, () => { this.closePops(); this.run(cmd); }, it.icon);
      if (withName) {
        if (it.label) b.append(Object.assign(document.createElement('b'), { textContent: it.label }));
        b.append(Object.assign(document.createElement('span'), { textContent: plain(it.title) }));
      }
      b.dataset.cmd = cmd;
      this.buttons.set(cmd, b);
      return b;
    };
    const pop = (cls: string) => Object.assign(document.createElement('div'), { className: `dn-bubble-pop ${cls}` });

    // 고른 글 AI 편집 (FR-112) — 노션처럼 맨 앞에. 문서 뷰의 Ctrl+J는 양쪽 맞춤이라 캔버스에서만 단축키 안내
    if (editor.canAi) {
      const key = this.editor.view.dom.closest('.dn-doc') ? '' : ' (Ctrl+J)';
      const ai = btn(this.el, 'AI', `AI로 고치기 — 요약 · 다듬기 · 말투 · 이어 쓰기 · 번역${key}`, () => { this.hide(); editor.aiSelection(); }, 'sparkle');
      ai.className = 'dn-bubble-ai';
      sep();
    }
    for (const cmd of MARKS) cmdBtn(this.el, cmd);
    sep();
    // 글자 색 · 배경 색 (노션 A) + 형광펜
    this.colorBtn = btn(this.el, 'A', '글자 색 · 배경 색', () => this.toggle('color'));
    this.colorBtn.className = 'dn-bubble-color';
    cmdBtn(this.el, 'highlight');
    // 제목 상자는 글자 서식만 (제목 · 목록 · 인용은 내용 상자에서)
    if (editor.mode !== 'title') {
      sep();
      const turn = btn(this.el, '바꾸기', '제목 · 목록 · 인용 · 수식으로 바꾸기', () => this.toggle('turn'));
      turn.className = 'dn-bubble-turn';
      this.turnPop = pop('dn-bubble-turnpop');
      for (const cmd of TURN) cmdBtn(this.turnPop, cmd, true);
    }
    // 고른 글에 댓글 (FR-132)
    if (editor.canComment) {
      sep();
      btn(this.el, '', '고른 글에 댓글 달기', () => { this.hide(); editor.commentSelection(); }, 'comment').className = 'dn-bubble-comment';
    }
    // 선택한 글을 새 블록으로 분리 (FR-017) · 원문과 이어진 새 상자로(원문은 그대로) — 블록을 다루는 앱에서만, ⋯ 안에
    if ((editor.canExtract || editor.canCopyOut) && editor.mode === 'body') {
      btn(this.el, '⋯', '더 보기', () => this.toggle('more')).className = 'dn-bubble-more';
      this.morePop = pop('dn-bubble-morepop');
      if (editor.canExtract) btn(this.morePop, '블록으로 분리', '선택한 글을 새 블록으로 옮기기', () => { this.hide(); editor.extractSelection(); }).className = 'dn-bubble-extract';
      if (editor.canCopyOut) btn(this.morePop, '새 상자로 (원문 연결)', "고른 글을 새 상자로 — 원문은 그대로 두고, 새 상자를 고르면 원문에 그 구절이 보여요. 캔버스로 끌어 놓아도 돼요", () => { this.hide(); editor.copyOutSelection(); }).className = 'dn-bubble-copyout';
    }
    overlay.appendChild(this.el);
  }

  /** 링크 주소 묻기 (Ctrl+K · 툴바 링크 버튼) */
  promptLink(): void { this.run('link'); }

  private run(cmd: FormatCommand): void {
    if (cmd === 'link') {
      const current = this.editor.isActive('link');
      this.editor.busy = true;
      const href = window.prompt(current ? '링크 주소 (비우면 링크 제거)' : '링크 주소 (https://…)', 'https://');
      this.editor.busy = false;
      if (href === null) { this.editor.focus(); return; }
      this.editor.exec('link', href === 'https://' ? '' : href);
    } else {
      this.editor.exec(cmd);
    }
    this.update();
  }

  update(): void {
    const { view } = this.editor;
    const sel = view.state.selection;
    if (sel.empty || !view.hasFocus()) { this.hide(); return; }
    for (const [cmd, b] of this.buttons) b.classList.toggle('on', this.editor.isActive(cmd));
    if (this.colorBtn) {
      const t = markColorAt(view.state, 'textColor'), g = markColorAt(view.state, 'bgColor');
      this.colorBtn.style.color = t ? textColorCss(t) : '';
      this.colorBtn.style.background = g && g !== 'default' ? bgColorCss(g) : '';
    }
    const a = view.coordsAtPos(sel.from), z = view.coordsAtPos(sel.to);
    const r = this.overlay.getBoundingClientRect();
    this.el.hidden = false;
    const w = this.el.offsetWidth;
    const x = Math.min(Math.max(8, (a.left + z.right) / 2 - r.left - w / 2), r.width - w - 8);
    const top = Math.min(a.top, z.top) - r.top - this.el.offsetHeight - 8;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${top < 8 ? Math.max(a.bottom, z.bottom) - r.top + 8 : top}px`;
  }

  /** 판 열고 닫기 — 한 번에 하나. 색 판은 고르면 고른 글자에 칠하고 닫는다 */
  private toggle(which: 'color' | 'turn' | 'more'): void {
    const open = which === 'color' ? this.panel : which === 'turn' ? this.turnPop?.isConnected : this.morePop?.isConnected;
    this.closePops();
    if (open) return;
    if (which === 'color') {
      const st = this.editor.view.state;
      const cur = { text: markColorAt(st, 'textColor'), bg: markColorAt(st, 'bgColor') };
      this.panel = colorPanel(cur, (kind, color) => { this.editor.exec(kind, color ?? ''); this.closePops(); this.update(); });
      this.el.append(this.panel);
    } else {
      const p = which === 'turn' ? this.turnPop : this.morePop;
      const anchor = this.el.querySelector<HTMLElement>(which === 'turn' ? '.dn-bubble-turn' : '.dn-bubble-more');
      if (!p || !anchor) return;
      p.style.left = `${anchor.offsetLeft}px`;
      this.el.append(p);
    }
  }
  private closePops(): void {
    this.panel?.remove(); this.panel = null;
    this.turnPop?.remove(); this.morePop?.remove();
  }

  hide(): void { this.el.hidden = true; this.closePops(); }
  destroy(): void { this.el.remove(); }
}
