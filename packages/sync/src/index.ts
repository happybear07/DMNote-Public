// 동기화 (FR-095 ~ 097): 엔진 ⇄ Y.Doc 다리 · 같은 기기 탭 사이 실시간 동기화 · 동기화 파일
export { attach, docSchema, knownIds, type AttachOptions, type Bridge, type OnRemote } from './bridge';
export { fragmentToDoc, writeDoc } from './text-y';
export { TabSync } from './tabs';
export { docAttachments, fingerprints, fromB64, isSyncFile, mergeRemote, toB64, type Conflict, type SyncFile } from './exchange';
export {
  ChunkAssembler, CHUNK_TIMEOUT_MS, CLOSE, decodeFrame, encodeFrame, FRAME_MAX, frameOut, PROTO, SUBPROTOCOL, type ErrorCode, type Frame,
} from './protocol';
export { docStatus, overallStatus, type Connectivity, type DocSyncState, type SyncError, type SyncStatus } from './status';
