// 알림 (FR-136): 노트 목록 정보(reminders)를 30초마다 · 앱으로 돌아올 때 훑어, 알림 시각이 지난 것을 띄운다.
// 기기 알림(권한이 있을 때) + 앱 안 알림(늘). 누르면 그 노트의 그 블록으로(FR-012). 보낸 기록은 이 기기 설정에 — 같은 알림을 두 번 띄우지 않는다.
// 앱이 닫혀 있던 동안 지난 알림(7일 안)은 다음에 열 때 "놓친 알림"으로 한꺼번에. 서버가 없어 기기 사이 "한 번만"은 아직 아니다.
import { inQuiet, lastOccurrence, nextOccurrence, reminderKey, type NoteReminder, type RemindPrefs } from './reminders';
import { scopeStagesFor } from './note-scope';
import { RecordLayer } from './ws-record';
import { createTextBlock, Engine, newId, type TextDoc } from '@dn/engine-core';
import { QaCtl } from './qa-flow';
import { focusInk } from './ink-focus';
import { isInkRef } from '@dn/search';

const TICK = 30_000;
const MISSED_WITHIN = 7 * 86_400_000;
/** 이보다 늦게 확인했으면 "놓친 알림" (탭이 잠들어 몇 분 늦은 것은 그냥 알림) */
const LATE = 10 * 60_000;

export interface DueReminder { noteId: string; title: string; r: NoteReminder; at: number }

const DEFAULT_PREFS: RemindPrefs = { inApp: true, device: true };

export abstract class RemindLayer extends RecordLayer {
  /** 내 노트에 질문하기 (FR-116~119, qa-flow.ts) */
  qa!: QaCtl;
  protected initQa(): void {
    const ws = this;
    this.qa = new QaCtl({
      meta: this.meta, get consent() { return ws.state.ai.consent; }, get hasKey() { return !!ws.state.ai.keyLast4; }, get qa() { return ws.state.qa; },
      get notes() { return ws.state.notes; }, get folders() { return ws.state.folders; }, get tags() { return ws.state.tags; }, get roles() { return ws.roles; }, get currentId() { return ws.state.currentId; },
      passages: (q, notes) => this.index.passages(q, notes),
      scopeStages: (q, notes) => scopeStagesFor(q, notes, this.state.notes, this.state.tags, this.index, this.roles),
      patch: (p) => this.set(p), toast: (t, a) => this.toast(t, a),
      askConsent: () => this.set({ dialog: { kind: 'consent' } }), askKey: (reason) => this.set({ dialog: { kind: 'settings', reason } }),
      openBlock: async (noteId, blockId) => {
        if (this.state.currentId !== noteId || this.state.page !== 'note') await this.openById(noteId);
        const ok = this.hasTarget(blockId);
        if (ok) this.focusBlock(blockId);
        return ok;
      },
      saveNote: async (title, doc) => {
        const e = new Engine({ note: { id: newId(), title, createdAt: Date.now(), updatedAt: Date.now() } });
        createTextBlock(e, { x: 0, y: 0 }, { doc, w: 560 });
        const id = await this.addEngine(e, {});
        await this.refreshList(); // 사이드바에 바로
        await this.openById(id);
      },
      insertHere: (doc: TextDoc) => {
        const o = this.open;
        if (!o) return null;
        const bottom = [...o.engine.blocks()].reduce((m, b) => Math.max(m, b.y + b.h), 0);
        const r = createTextBlock(o.engine, { x: 0, y: bottom + 40 }, { doc, w: 560 });
        if (!r.ok) return null;
        o.view.select([r.value.blockId]);
        this.focusBlock(r.value.blockId);
        return r.value.blockId;
      },
      structure: (id) => void this.structure(id),
    });
  }

  /** 필기에서 읽은 글(FR-120)로 가기 — 그 획들을 올가미로 고르고 화면을 그 자리로 (문서 뷰면 캔버스로 바꿔서) */
  override focusBlock(id: string): void {
    const e = this.open?.engine;
    const x = e && isInkRef(id) ? this.index.inkOf(e.note.id).find((i) => i.id === id) : undefined;
    if (!x) { super.focusBlock(id); return; }
    if (this.state.viewMode === 'doc') this.setViewMode('canvas');
    requestAnimationFrame(() => { if (this.view) focusInk(this.view, x.strokes); });
  }

  private remindTimer: ReturnType<typeof setInterval> | null = null;
  private remindBusy = false;
  private prefs: RemindPrefs | null = null;

  async remindPrefs(): Promise<RemindPrefs> {
    this.prefs ??= { ...DEFAULT_PREFS, ...((await this.meta.getSetting<RemindPrefs>('remindPrefs')) ?? {}) };
    return this.prefs;
  }

  async setRemindPrefs(p: RemindPrefs): Promise<void> {
    this.prefs = p;
    await this.meta.setSetting('remindPrefs', p);
  }

  /** 시험 알림: 지금 설정대로 앱 안 · 기기 알림을 하나 띄운다 */
  testReminder(): void {
    const now = Date.now();
    this.showReminders([{ noteId: this.state.currentId ?? '', title: '시험', r: { blockId: '', date: '', time: new Date(now).toTimeString().slice(0, 5), repeat: '', text: '시험 알림이에요', done: false }, at: now }], now, true);
  }

  protected installReminders(): void {
    this.remindTimer = setInterval(() => void this.checkReminders(), TICK);
    document.addEventListener('visibilitychange', this.onVisible);
    void this.checkReminders();
  }

  protected stopReminders(): void {
    if (this.remindTimer) clearInterval(this.remindTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private onVisible = (): void => { if (document.visibilityState === 'visible') void this.checkReminders(); };

  /** 지금 알릴 것을 찾아 띄운다 (e2e · 디버깅은 `now`로 시각을 줄 수 있다). 띄운 알림 */
  async checkReminders(now = Date.now()): Promise<DueReminder[]> {
    if (this.remindBusy || this.state.appLocked) return [];
    // 방해 금지 시간에는 보낸 것으로 치지 않고 기다린다 — 끝나면 "놓친 알림"으로 (FR-138)
    const prefs = await this.remindPrefs();
    if (inQuiet(prefs, now)) return [];
    this.remindBusy = true;
    try {
      const fired = (await this.meta.getSetting<Record<string, number>>('reminderFired')) ?? {};
      const due: DueReminder[] = [];
      let changed = false;
      for (const n of this.state.notes) {
        for (const r of n.reminders ?? []) {
          if (r.done) continue;
          const at = lastOccurrence(r, now);
          const key = reminderKey(n.id, r);
          if (at === null || (fired[key] ?? 0) >= at) continue;
          fired[key] = at;
          changed = true;
          // 잠긴 노트는 글자를 띄우지 않는다 (예전 빌드가 남긴 글자가 있어도)
          if (now - at <= MISSED_WITHIN) due.push({ noteId: n.id, title: n.title.trim() || '제목 없음', r: n.locked ? { ...r, text: '' } : r, at });
        }
      }
      if (changed) await this.meta.setSetting('reminderFired', fired);
      if (due.length) this.showReminders(due, now);
      return due;
    } finally {
      this.remindBusy = false;
    }
  }

  /** 다가오는 알림 (설정 · 목록 화면용) — 이른 순서 */
  upcomingReminders(now = Date.now(), limit = 20): DueReminder[] {
    const out: DueReminder[] = [];
    for (const n of this.state.notes) for (const r of n.reminders ?? []) {
      const at = r.done ? null : nextOccurrence(r, now);
      if (at !== null) out.push({ noteId: n.id, title: n.title.trim() || '제목 없음', r: n.locked ? { ...r, text: '' } : r, at });
    }
    return out.sort((a, b) => a.at - b.at).slice(0, limit);
  }

  private showReminders(due: DueReminder[], now: number, test = false): void {
    const prefs = this.prefs ?? DEFAULT_PREFS;
    const late = due.filter((d) => now - d.at > LATE);
    const onTime = due.filter((d) => now - d.at <= LATE);
    const go = (d: DueReminder) => { window.focus(); if (d.noteId) void this.openHit(d.noteId, d.r.blockId || undefined); };
    // 기기 알림: 탭이 안 보일 때 · 권한이 있을 때만 (보이는 탭에서는 앱 안 알림이면 충분)
    if (prefs.device && typeof Notification !== 'undefined' && Notification.permission === 'granted' && (test || document.visibilityState !== 'visible')) {
      for (const d of onTime.slice(0, 3)) {
        try {
          const n = new Notification(d.r.text || '알림', { body: `${d.title} · ${d.r.time}`, tag: reminderKey(d.noteId, d.r) });
          n.onclick = () => { n.close(); go(d); };
        } catch { /* 일부 브라우저는 페이지에서 직접 만들 수 없다 — 앱 안 알림만 */ }
      }
    }
    if (!prefs.inApp) return;
    const first = onTime[0] ?? late[0]!;
    const what = first.r.text || first.title;
    const more = due.length - 1;
    const text = onTime.length
      ? `알림 · ${first.r.time} ${what}${more ? ` 외 ${more}개` : ''}`
      : `놓친 알림 ${late.length}개 — ${what}${late.length > 1 ? ' 등' : ''}`;
    this.toast(text, { label: '열기', run: () => go(first) });
  }
}
