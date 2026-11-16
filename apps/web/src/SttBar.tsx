// 녹음 받아쓰기 표시 (FR-044): 처음 한 번 모델 내려받기 확인 → 내려받는 양 · 받아쓰는 진행률 · 멈추기. 녹음 막대(RecordBar)와 같은 자리 · 모양.
import { formatBytes } from '@dn/engine-core';
import type { SttState } from './stt-flow';
import { STT_LANGS, STT_MODEL } from './stt';
import type { Workspace } from './workspace';

export function SttBar({ ws, st }: { ws: Workspace; st: SttState }) {
  if (st.step === 'ask') {
    return (
      <div className="record-bar stt-bar" role="dialog" aria-label="받아쓰기 모델 내려받기">
        <span className="rec-label">받아쓰기 모델(약 {STT_MODEL.approxMB}MB)을 처음 한 번 내려받아요. <small>녹음은 이 기기 밖으로 나가지 않아요 · 언어: {STT_LANGS.find((l) => l.id === st.lang)?.label}</small></span>
        <button className="btn sm primary" onClick={() => ws.stt.confirm()}>내려받고 받아쓰기</button>
        <button className="btn sm" onClick={() => ws.stt.cancel()}>취소</button>
      </div>
    );
  }
  const pct = Math.round(st.pct * 100);
  const label = st.step === 'decode' ? '녹음 읽는 중' : st.step === 'download'
    ? `받아쓰기 모델 내려받는 중${st.total ? ` · ${formatBytes(st.loaded ?? 0)} / ${formatBytes(st.total)}` : ''}`
    : `받아쓰는 중 · ${pct}%`;
  return (
    <div className="record-bar stt-bar" role="status" aria-live="polite" aria-label="받아쓰는 중">
      <span className="stt-meter" aria-hidden><span style={{ width: `${st.step === 'decode' ? 0 : pct}%` }} /></span>
      <span className="rec-label">{label} <small>· 이 기기에서</small></span>
      <button className="btn sm" onClick={() => ws.stt.cancel()}>멈추기</button>
    </div>
  );
}
