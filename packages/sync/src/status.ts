// 서버 동기화 상태 (SYNC.md 12.9): 문서마다 하나, 앱 전체 표시는 문서 중 가장 높은 것.
// 우선순위 off > error > conflict > pending > synced — 로그아웃 · 해지 · 구버전이면 다른 상태보다 '이 기기에만 저장'을 먼저 보인다.

export type SyncStatus = 'off' | 'synced' | 'pending' | 'error' | 'conflict';
export type Connectivity = 'online' | 'connecting' | 'offline';
export type SyncError = 'bad-update' | 'bridge' | 'local-quota' | 'doc-too-large' | 'quota' | 'auth' | 'outdated' | 'revoked' | 'network';

export interface DocSyncState {
  status: SyncStatus;
  connectivity: Connectivity;
  /** 로컬 상태 벡터가 서버가 확인(ack)한 것보다 앞섬 (12.5) */
  unsynced: boolean;
  /** 보류 그룹 수 — 지우기 ↔ 고치기 충돌 (13.2) */
  conflicts: number;
  lastAckAt?: number;
  lastError?: SyncError;
}

const RANK: Record<SyncStatus, number> = { synced: 0, pending: 1, conflict: 2, error: 3, off: 4 };

/** 앱 전체 상태 — 문서 상태 중 가장 높은 것 (문서가 없으면 off) */
export function overallStatus(docs: Iterable<Pick<DocSyncState, 'status'>>): SyncStatus {
  let top: SyncStatus | null = null;
  for (const d of docs) if (top === null || RANK[d.status] > RANK[top]) top = d.status;
  return top ?? 'off';
}

/** 문서 하나의 상태 — 상태 기계(12.9)의 도착점만 계산: 끔이면 off, 오류가 있으면 error, 충돌이 있으면 conflict, 덜 올렸거나 따라잡는 중이면 pending */
export function docStatus(s: { enabled: boolean; error?: SyncError | null; conflicts: number; unsynced: boolean; caughtUp: boolean }): SyncStatus {
  if (!s.enabled) return 'off';
  if (s.error) return 'error';
  if (s.conflicts > 0) return 'conflict';
  if (s.unsynced || !s.caughtUp) return 'pending';
  return 'synced';
}
