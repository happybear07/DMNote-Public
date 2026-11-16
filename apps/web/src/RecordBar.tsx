// 녹음 중 표시 (FR-043): 경과 시간 · 일시정지/계속 · 끝내고 붙이기 · 버리기. 다른 노트에 있어도 보인다(시작한 노트 이름과 함께).
import { formatBytes, formatDuration } from '@dn/engine-core';
import type { RecordingInfo } from './ws-model';
import type { Workspace } from './workspace';
import { Icon } from './Icon';

export function RecordBar({ ws, rec, here }: { ws: Workspace; rec: RecordingInfo; here: boolean }) {
  return (
    <div className={`record-bar${rec.paused ? ' paused' : ''}`} role="status" aria-live="polite" aria-label="녹음 중">
      <span className="rec-dot" aria-hidden />
      <span className="rec-time">{formatDuration(rec.elapsedMs / 1000)}</span>
      <span className="rec-label">
        {rec.paused ? '일시정지' : '녹음 중'}
        {!here && <small> · {rec.title}에 붙여요</small>}
        {rec.bytes > 0 && <small> · {formatBytes(rec.bytes)}</small>}
      </span>
      {rec.paused
        ? <button className="btn sm" onClick={() => ws.resumeRecording()}>계속</button>
        : <button className="btn sm" onClick={() => ws.pauseRecording()}>일시정지</button>}
      <button className="btn sm primary" onClick={() => void ws.stopRecording()}><Icon name="check" size={14} />끝내기</button>
      <button className="btn sm" aria-label="녹음 버리기" title="녹음 버리기" onClick={() => ws.cancelRecording()}>버리기</button>
    </div>
  );
}
