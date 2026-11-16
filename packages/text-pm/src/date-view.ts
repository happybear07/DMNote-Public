// 날짜 멘션 편집 (FR-133 · FR-136): 글 상자를 고치는 중에 날짜를 누르면 작은 창 — 날짜 · 알림 시각 · 반복(매일 · 매주) · 알림 끄기.
// 바꿀 때마다 그 노드만 고친다(실행 취소 한 번). 창은 이 노드 DOM 안에 둔다 — 포커스가 블록 밖으로 나가 편집이 끝나지 않게.
// 노드가 바뀌어도 창을 다시 만들지 않고 칸 값만 맞춘다 — 포커스가 있던 칸을 떼어 내면 편집이 끝나 버린다.
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { dateLabel, dateTense, fromIso } from './dates';
import { AttrView } from './node-views';

const REPEAT: [string, string][] = [['', '반복 안 함'], ['daily', '매일'], ['weekly', '매주']];
type Attrs = { date: string; time: string; repeat: string };

export class DateView extends AttrView implements NodeView {
  dom: HTMLElement;
  private readonly label: HTMLSpanElement;
  private pop: HTMLDivElement | null = null;
  private ctl: { date: HTMLInputElement; time: HTMLInputElement; repeat: HTMLSelectElement; off: HTMLButtonElement } | null = null;
  private readonly onDocDown = (e: MouseEvent) => { if (this.pop && !this.dom.contains(e.target as Node)) this.close(); };

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    super(node, view, getPos);
    this.dom = document.createElement('time');
    this.dom.contentEditable = 'false';
    this.label = document.createElement('span');
    this.dom.append(this.label);
    this.sync();
    this.dom.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.view.editable) return;
      if (this.pop?.contains(e.target as Node)) return;
      e.preventDefault();
      if (this.pop) this.close(); else this.open();
    });
  }

  private open(): void {
    const a = this.node.attrs as Attrs;
    const pop = document.createElement('div');
    pop.className = 'dn-date-pop';
    const row = (label: string, el: HTMLElement) => {
      const l = document.createElement('label');
      l.append(Object.assign(document.createElement('span'), { textContent: label }), el);
      pop.appendChild(l);
    };
    const date = Object.assign(document.createElement('input'), { type: 'date', value: a.date, className: 'dn-date-input' });
    date.setAttribute('aria-label', '날짜');
    date.addEventListener('change', () => { if (fromIso(date.value) && date.value !== this.node.attrs.date) this.set({ date: date.value }); });
    row('날짜', date);
    const time = Object.assign(document.createElement('input'), { type: 'time', value: a.time, className: 'dn-date-time' });
    time.setAttribute('aria-label', '알림 시각');
    time.addEventListener('change', () => {
      if (!/^\d{2}:\d{2}$/.test(time.value) || time.value === this.node.attrs.time) return;
      // 처음 알림을 켤 때 기기 알림 권한을 묻는다 (거절해도 앱 안 알림은 뜬다)
      if (!this.node.attrs.time && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().catch(() => {});
      this.set({ time: time.value });
    });
    row('알림', time);
    const repeat = document.createElement('select');
    repeat.className = 'dn-date-repeat';
    repeat.setAttribute('aria-label', '반복');
    for (const [v, t] of REPEAT) repeat.appendChild(Object.assign(document.createElement('option'), { value: v, textContent: t, selected: v === a.repeat }));
    repeat.addEventListener('change', () => this.set({ repeat: repeat.value }));
    row('반복', repeat);
    const off = Object.assign(document.createElement('button'), { type: 'button', className: 'dn-date-off', textContent: '알림 끄기' });
    off.addEventListener('click', () => { this.set({ time: '', repeat: '' }); this.close(); this.view.focus(); });
    pop.appendChild(off);
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); this.view.focus(); } });
    this.dom.appendChild(pop);
    this.pop = pop;
    this.ctl = { date, time, repeat, off };
    this.sync();
    document.addEventListener('mousedown', this.onDocDown, true);
  }

  /** 노드 값을 화면에 — 글자 · 제목, 열린 창의 칸(포커스는 그대로) */
  protected override sync(): void {
    const a = this.node.attrs as Attrs;
    const { date, time, repeat } = a;
    this.dom.className = `dn-date dn-date-${dateTense(date)}${time ? ' dn-date-remind' : ''}`;
    this.dom.dataset.date = date;
    this.dom.setAttribute('datetime', time ? `${date}T${time}` : date);
    this.dom.title = `${date}${time ? ` ${time} 알림${repeat ? ` · ${repeat === 'daily' ? '매일' : '매주'}` : ''}` : ''} — 눌러서 바꾸기`;
    this.label.textContent = dateLabel(date) + (time ? ` ${time}` : '');
    const c = this.ctl;
    if (!c) return;
    if (c.date.value !== a.date && document.activeElement !== c.date) c.date.value = a.date;
    if (c.time.value !== a.time && document.activeElement !== c.time) c.time.value = a.time;
    if (c.repeat.value !== a.repeat) c.repeat.value = a.repeat;
    c.repeat.disabled = !a.time;
    c.off.hidden = !a.time;
  }

  private close(): void {
    this.pop?.remove();
    this.pop = null;
    this.ctl = null;
    document.removeEventListener('mousedown', this.onDocDown, true);
  }

  ignoreMutation(): boolean { return true; }
  stopEvent(e: Event): boolean { return e.type === 'mousedown' || !!this.pop?.contains(e.target as Node); }
  destroy(): void { this.close(); }
}
