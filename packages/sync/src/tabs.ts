// 같은 기기 탭 사이 실시간 동기화 (FR-095 · 096): 노트마다 BroadcastChannel 하나로 Y 변경을 주고받는다.
// 노트를 편집 · 저장하는 탭(쓰기 탭, 노트 잠금을 가진 탭)은 하나뿐이고, 다른 탭은 쓰기 탭이 있는 동안 함께 고칠 수 있다 —
// 그 탭의 편집은 Y로 쓰기 탭에 가고, 쓰기 탭이 저장한다(두 탭이 같은 저장 로그에 쓰지 않게).
// 인사(hello)에 상태 벡터를 실어 서로 빠진 부분만 보낸다. 나갈 때 bye.
import * as Y from 'yjs';

export interface TabPeer { id: string; writer: boolean; seen: number }
type Msg =
  | { t: 'hello'; from: string; writer: boolean; sv: Uint8Array }
  | { t: 'welcome'; from: string; to: string; writer: boolean; update: Uint8Array; sv: Uint8Array }
  | { t: 'update'; from: string; update: Uint8Array }
  | { t: 'catchup'; from: string; to: string; update: Uint8Array }
  | { t: 'bye'; from: string };

const REMOTE = 'dn-tab';

export class TabSync {
  readonly id = Math.random().toString(36).slice(2, 10);
  private readonly ch: BroadcastChannel | null;
  private readonly peers = new Map<string, TabPeer>();
  private readonly listeners = new Set<(peers: TabPeer[]) => void>();
  private gotState = false;
  private stateWaiters: (() => void)[] = [];
  private readonly onUpdate = (u: Uint8Array, origin: unknown) => { if (origin !== REMOTE) this.post({ t: 'update', from: this.id, update: u }); };

  /** prepare: 다른 탭에 처음 상태를 보내기 직전 한 번 (쓰기 탭은 이때 엔진을 Y.Doc에 옮긴다 — 혼자일 땐 비용 없음) */
  constructor(readonly noteId: string, readonly doc: Y.Doc, private readonly writer: boolean, private prepare?: () => void) {
    // 채널 이름의 3: Y 모양 버전(2 목록 항목 키 · 3 묘비) — 예전 앱의 탭과는 서로 보지 않는다(쓰기 탭 판단은 Web Lock이라 저장은 안전)
    this.ch = typeof BroadcastChannel === 'function' ? new BroadcastChannel(`dn-sync:3:${noteId}`) : null;
    if (this.ch) this.ch.onmessage = (e: MessageEvent<Msg>) => this.onMessage(e.data);
    doc.on('update', this.onUpdate);
    this.post({ t: 'hello', from: this.id, writer, sv: Y.encodeStateVector(doc) });
  }

  /** 다른 탭(특히 쓰기 탭)의 상태를 처음 받을 때까지 — 없으면 ms 뒤 그냥 진행. 받았으면 true */
  waitForState(ms: number): Promise<boolean> {
    if (this.gotState) return Promise.resolve(true);
    return new Promise((res) => {
      const t = setTimeout(() => res(false), ms);
      this.stateWaiters.push(() => { clearTimeout(t); res(true); });
    });
  }

  get peerList(): TabPeer[] { return [...this.peers.values()]; }
  get hasWriter(): boolean { return this.peerList.some((p) => p.writer); }
  onPeers(fn: (peers: TabPeer[]) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  close(): void {
    this.post({ t: 'bye', from: this.id });
    this.doc.off('update', this.onUpdate);
    this.ch?.close();
    this.listeners.clear();
  }

  private post(m: Msg): void { try { this.ch?.postMessage(m); } catch { /* 닫힌 채널 */ } }
  private notify(): void { const l = this.peerList; for (const fn of this.listeners) fn(l); }
  /** 다른 탭에 상태를 보내기 직전이라 prepare부터 */
  private meet(id: string, writer: boolean): void { this.prepare?.(); this.prepare = undefined; this.peers.set(id, { id, writer, seen: Date.now() }); this.notify(); }
  private apply(update: Uint8Array): void { Y.applyUpdate(this.doc, update, REMOTE); }
  private received(): void { if (this.gotState) return; this.gotState = true; for (const w of this.stateWaiters.splice(0)) w(); }

  private onMessage(m: Msg): void {
    if (m.from === this.id) return;
    switch (m.t) {
      case 'hello':
        this.meet(m.from, m.writer);
        // 새로 온 탭에 빠진 부분 + 내 상태 벡터(그쪽 것도 받으려고)
        this.post({ t: 'welcome', from: this.id, to: m.from, writer: this.writer, update: Y.encodeStateAsUpdate(this.doc, m.sv), sv: Y.encodeStateVector(this.doc) });
        break;
      case 'welcome':
        if (m.to !== this.id) return;
        this.meet(m.from, m.writer);
        this.apply(m.update);
        if (m.writer) this.received();
        this.post({ t: 'catchup', from: this.id, to: m.from, update: Y.encodeStateAsUpdate(this.doc, m.sv) });
        break;
      case 'catchup':
        if (m.to === this.id) this.apply(m.update);
        break;
      case 'update':
        this.apply(m.update);
        break;
      case 'bye':
        if (this.peers.delete(m.from)) this.notify();
        break;
    }
  }
}
