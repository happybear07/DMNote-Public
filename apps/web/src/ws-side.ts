// 사이드바 (11/09 개편): 전체 노트 목록 대신 '열린 노트'(탭처럼 — × 로 닫기)와 지금 노트의 '블록 ▸ 콘텐츠' 나무.
// 열린 노트는 기기 설정(openTabs)에 남아 다음에 앱을 열어도 그대로. 지운 노트는 그릴 때 빠진다(Sidebar).
import { bodyDoc, createTextBlock, Engine, newId } from '@dn/engine-core';
import { noteOutline } from './side-outline';
import { AiLayer } from './ws-ai';
import type { OpenNote } from './ws-base';
import { firstLine } from './ws-model';

/** 탭이 너무 많아지지 않게 — 넘으면 가장 오래 안 본 것부터 닫힌다 */
const TABS_MAX = 12;

export abstract class SideLayer extends AiLayer {
  private tabsLoaded = false;
  private outlineTimer: ReturnType<typeof setTimeout> | null = null;

  protected override afterOpen(o: OpenNote, writer: boolean): void {
    super.afterOpen(o, writer);
    queueMicrotask(() => { const id = this.state.currentId; if (id && this.open === o) void this.addTab(id); }); // currentId는 열기가 끝난 뒤에 정해진다
    this.refreshOutline(o);
    o.offs.push(o.engine.subscribe(() => {
      if (this.outlineTimer) clearTimeout(this.outlineTimer);
      this.outlineTimer = setTimeout(() => { if (this.open === o) this.refreshOutline(o); }, 200);
    }));
  }
  protected override beforeClose(o: OpenNote): void {
    if (this.outlineTimer) { clearTimeout(this.outlineTimer); this.outlineTimer = null; }
    if (this.state.outline.rows.length) this.set({ outline: { rows: [], more: 0 } });
    super.beforeClose(o);
  }
  private refreshOutline(o: OpenNote): void {
    const next = noteOutline(o.engine);
    if (JSON.stringify(next) !== JSON.stringify(this.state.outline)) this.set({ outline: next });
  }

  private async loadTabs(): Promise<string[]> {
    if (!this.tabsLoaded) {
      this.tabsLoaded = true;
      const saved = (await this.meta.getSetting<string[]>('openTabs')) ?? [];
      const merged = [...saved, ...this.state.openTabs.filter((x) => !saved.includes(x))];
      this.set({ openTabs: merged });
    }
    return this.state.openTabs;
  }
  private saveTabs(tabs: string[]): void {
    this.set({ openTabs: tabs });
    void this.meta.setSetting('openTabs', tabs);
  }
  /** 연 노트를 탭 끝에 (이미 있으면 그 자리 그대로) */
  private async addTab(id: string): Promise<void> {
    const tabs = await this.loadTabs();
    if (tabs.includes(id)) return;
    let next = [...tabs, id];
    if (next.length > TABS_MAX) {
      // 가장 오래 안 본 탭부터 닫는다 (최근 목록에 없으면 가장 오래된 것) — 지금 노트는 남긴다
      const rank = (x: string) => { const r = this.state.recent.indexOf(x); return r < 0 ? Infinity : r; };
      const drop = next.filter((x) => x !== id).reduce((a, b) => (rank(b) > rank(a) ? b : a));
      next = next.filter((x) => x !== drop);
    }
    this.saveTabs(next);
  }
  /** 탭 닫기 (노트는 그대로) — 지금 노트를 닫으면 옆 탭으로, 남은 탭이 없으면 홈으로 */
  async closeTab(id: string): Promise<void> {
    const tabs = (await this.loadTabs()).filter((x) => this.state.notes.some((n) => n.id === x));
    const i = tabs.indexOf(id);
    const next = tabs.filter((x) => x !== id);
    this.saveTabs(next);
    if (id !== this.state.currentId || this.state.page !== 'note') return;
    const to = next[Math.min(Math.max(i, 0), next.length - 1)];
    if (to) await this.openById(to);
    else this.showHome();
  }
  /** 탭 순서 바꾸기 (끌어 놓기) — before 앞에, 없으면 끝에 */
  moveTab(id: string, before: string | null): void {
    const tabs = this.state.openTabs.filter((x) => x !== id);
    const at = before ? tabs.indexOf(before) : -1;
    tabs.splice(at < 0 ? tabs.length : at, 0, id);
    this.saveTabs(tabs);
  }

  /** 서재 책장 색 (폴더마다, book-colors.ts 이름) — null이면 기본(폴더 id로 고른 색) */
  async setFolderColor(id: string, color: string | null): Promise<void> {
    const f = this.state.folders.find((x) => x.id === id);
    if (!f || (f.color ?? null) === color) return;
    const { color: _old, ...rest } = f;
    await this.meta.putFolder({ ...rest, ...(color ? { color } : {}), updatedAt: Date.now() });
    await this.refreshList();
  }

  /** 이 노트만 책 표지 색 (null = 폴더 색 따르기) */
  async setNoteColor(id: string, color: string | null): Promise<void> {
    const n = this.state.notes.find((x) => x.id === id);
    if (!n || (n.bookColor ?? null) === color) return;
    await this.meta.patch(id, { bookColor: color ?? undefined });
    await this.refreshList();
  }

  /** 내 페이지 빠른 메모 → '받은 메모' 노트 맨 아래에 상자로 (없으면 만든다 — 열지 않는다). 넣은 노트 id, 못 넣으면 null */
  async addToInbox(text: string): Promise<string | null> {
    const saved = await this.meta.getSetting<string>('inboxNoteId');
    const put = (e: Engine): boolean => {
      const bs = [...e.blocks()];
      const x = bs.length ? Math.min(...bs.map((b) => b.x)) : 48, y = bs.length ? Math.max(...bs.map((b) => b.y + b.h)) + 24 : 48;
      return createTextBlock(e, { x, y }, { doc: bodyDoc(text), w: 480 }).ok;
    };
    if (saved && this.state.notes.some((n) => n.id === saved)) {
      const r = await this.editNote(saved, put, (e) => ({ updatedAt: Date.now(), preview: firstLine(e), stats: { blocks: e.blockCount } }));
      if (r === 'busy') { this.toast('받은 메모를 다른 탭에서 고치는 중이에요. 잠시 뒤에 다시 넣어 주세요.'); return null; }
      if (!r) { this.toast('받은 메모 노트를 열지 못했어요.'); return null; }
      await this.refreshList();
      return saved;
    }
    const now = Date.now(), sheet = this.newNotePlace().sheet;
    const e = new Engine({ note: { id: newId(), title: '받은 메모', createdAt: now, updatedAt: now, ...(sheet ? { sheet } : {}) } });
    if (!put(e)) return null;
    const id = await this.addEngine(e);
    await this.meta.setSetting('inboxNoteId', id);
    await this.refreshList();
    return id;
  }

  /** 빠른 메모의 긴 글 → 새 노트를 열고 붙여넣기와 같은 AI 구조화로 (동의 · 키가 없으면 그 단계부터, 못 하면 '글 상자로 넣기') */
  async memoToNote(text: string): Promise<void> {
    await this.newNote(this.newNotePlace());
    if (this.view) await this.structureText(text, { x: 48, y: 48 });
  }

  /** 사이드바 콘텐츠 한 줄 → 그 상자로 (문서 보기면 문서에서 그 자리로) */
  focusNoteBox(id: string): void {
    if (this.state.viewMode === 'doc' && this.doc) { this.doc.focusBlock(id); return; }
    if (!this.view) return;
    this.view.focusBlock(id);
    this.view.root.focus({ preventScroll: true });
  }
}
