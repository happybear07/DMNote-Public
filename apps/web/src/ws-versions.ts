// 워크스페이스 버전 기록 층 (FR-093): 실행 취소는 지금 세션 안에서만 — 며칠 전으로 돌아가려면 따로 남긴 스냅샷이 필요하다.
// 언제 남기나: 고친 뒤 10분마다(자동) · 노트를 떠날 때 · 큰 변경 직전(AI 구조화 · 백업으로 바꾸기 · 버전 되돌리기) · 직접.
// 노트당 30개까지(저장소가 오래된 것부터 정리). 되돌리기도 한 번의 실행 취소 단위이고, 되돌리기 전 상태도 버전으로 남는다.
import { deserialize, Engine, replaceNoteContent, serialize, type Id } from '@dn/engine-core';
import type { VersionInfo, VersionReason } from '@dn/storage-idb';
import { DbPageLayer } from './ws-dbpages';

const AUTO_EVERY = 10 * 60_000;

export const VERSION_REASON: Record<VersionReason, string> = {
  auto: '자동', close: '노트를 떠날 때', 'before-ai': 'AI 구조화 전', 'before-restore': '되돌리기 전', 'before-replace': '백업으로 바꾸기 전', manual: '직접 저장',
  'before-sync': '동기화로 합치기 전', sync: '동기화로 합친 뒤',
};

export abstract class VersionLayer extends DbPageLayer {
  /** 노트 → 마지막으로 버전을 남긴(또는 연) 때의 엔진 변경 시각 · 그 시각 */
  private readonly versionBase = new Map<Id, { rev: number; at: number }>();
  private versionTimer: ReturnType<typeof setInterval> | null = null;

  /** 부팅 때 한 번: 노트를 열 때 기준점을 잡고, 1분마다 자동 저장 조건을 본다 */
  protected installVersioning(): void {
    let last: Id | null = null;
    this.subscribe((s) => {
      if (s.currentId === last) return;
      last = s.currentId;
      const o = this.open;
      if (o && !this.versionBase.has(o.engine.note.id)) this.versionBase.set(o.engine.note.id, { rev: o.engine.updatedAt, at: Date.now() });
    });
    this.versionTimer = setInterval(() => {
      const base = this.open && this.versionBase.get(this.open.engine.note.id);
      if (base && Date.now() - base.at >= AUTO_EVERY) void this.saveVersion('auto');
    }, 60_000);
  }

  protected stopVersioning(): void { if (this.versionTimer) clearInterval(this.versionTimer); }

  /** 지금 노트를 버전으로 남긴다. force가 아니면 마지막 버전 뒤로 바뀐 게 있을 때만 */
  async saveVersion(reason: VersionReason, force = false): Promise<VersionInfo | null> {
    const o = this.open;
    if (!o || o.session.readonly) return null;
    const id = o.engine.note.id;
    const base = this.versionBase.get(id);
    if (!force && base && o.engine.updatedAt <= base.rev) return null;
    const v = await this.store.saveVersion({ noteId: id, reason, title: o.engine.note.title, blocks: o.engine.blockCount }, serialize(o.engine)).catch(() => null);
    if (v) this.versionBase.set(id, { rev: o.engine.updatedAt, at: Date.now() });
    return v;
  }

  /**
   * 노트를 떠날 때: 바뀐 게 있으면 버전으로. 큰 노트는 직렬화 · 쓰기가 수백 ms라 다음 노트 열기를 막지 않게 조금 뒤에 한다
   * (닫은 엔진은 더 바뀌지 않으므로 그때 찍어도 떠날 때의 내용 그대로다).
   */
  protected override async closeCurrent(): Promise<void> {
    const o = this.open;
    const base = o && this.versionBase.get(o.engine.note.id);
    if (o && !o.session.readonly && (!base || o.engine.updatedAt > base.rev)) {
      const engine = o.engine, id = engine.note.id;
      this.versionBase.set(id, { rev: engine.updatedAt, at: Date.now() });
      setTimeout(() => {
        void this.store.saveVersion({ noteId: id, reason: 'close', title: engine.note.title, blocks: engine.blockCount }, serialize(engine)).catch(() => null);
      }, 1500);
    }
    return super.closeCurrent();
  }

  async listVersions(noteId: Id): Promise<VersionInfo[]> { return this.store.listVersions(noteId); }

  /** 미리보기용 엔진 (저장소에 쓰지 않음) */
  async versionEngine(noteId: Id, at: number): Promise<Engine | null> {
    const snap = await this.store.getVersion(noteId, at);
    const r = snap ? deserialize(snap) : null;
    return r?.ok ? new Engine(r.data) : null;
  }

  /** 이 버전으로 되돌리기 — 지금 상태를 먼저 버전으로 남기고, 내용을 통째로 바꾼다(실행 취소 한 번) */
  async restoreVersion(at: number): Promise<boolean> {
    const o = this.open;
    if (!o || o.session.readonly) return false;
    const src = await this.versionEngine(o.engine.note.id, at);
    if (!src) { this.toast('이 버전을 읽지 못했어요.'); return false; }
    await this.saveVersion('before-restore', true);
    const r = replaceNoteContent(o.engine, src, '버전 되돌리기');
    if (!r.ok) { this.toast('되돌리지 못했어요.'); return false; }
    this.toast(`${new Date(at).toLocaleString('ko-KR')} 버전으로 되돌렸어요. 실행 취소(Ctrl+Z)로 다시 돌아갈 수 있어요.`);
    return true;
  }

  openVersions(): void { if (this.open) this.set({ dialog: { kind: 'versions' } }); }
}
