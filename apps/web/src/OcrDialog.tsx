// 손글씨 → 글 미리보기 (FR-038 · 화면 11): 왼쪽 고른 필기, 오른쪽 읽은 글(고칠 수 있음) · 신뢰도 → 글로 바꾸기 · 글 상자 추가 · 정밀 인식.
// 신뢰도가 낮으면 필기를 그대로 묶어 두기를 권한다.
import { useEffect, useState } from 'react';
import { longEnough, type OcrState } from './ocr-flow';
import type { Workspace } from './workspace';
import { useEscape } from './hooks';
import { Icon } from './Icon';

const level = (c: number) => (c >= 0.8 ? { cls: 'hi', label: '잘 읽혔어요' } : c >= 0.6 ? { cls: 'mid', label: '몇 글자는 확인해 주세요' } : { cls: 'lo', label: '잘못 읽었을 수 있어요' });

export function OcrDialog({ ws, ocr }: { ws: Workspace; ocr: OcrState }) {
  const [text, setText] = useState(ocr.text);
  useEffect(() => { setText(ocr.text); }, [ocr.text, ocr.step]);
  // 닫을 때도 고친 글을 넘긴다 — 필기 검색 글이 OCR 원문으로 남지 않게 (교차 검토 B4)
  const close = () => ws.ocr.close(text);
  useEscape(close);
  const lv = level(ocr.confidence);
  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div className="ocr-dialog" role="dialog" aria-modal="true" aria-labelledby="ocr-title" onMouseDown={(e) => e.stopPropagation()}>
        <header><h2 id="ocr-title">손글씨를 글로</h2><button className="x" aria-label="닫기" onClick={close}><Icon name="close" size={14} /></button></header>
        <div className="ocr-body">
          <figure className="ocr-ink"><img src={ocr.image} alt="고른 손글씨" /></figure>
          <div className="ocr-text">
            {ocr.step === 'running' && <p className="ocr-wait" role="status"><i />{ocr.precise ? '더 꼼꼼히 읽는 중…' : '손글씨를 읽는 중…'}</p>}
            {ocr.step === 'error' && <p className="ocr-err" role="alert">{ocr.error}</p>}
            {ocr.step === 'done' && (
              <>
                <p className={`ocr-conf ${lv.cls}`}><i />{lv.label} · 읽을 수 없는 글자는 □</p>
                <textarea aria-label="읽은 글 (고칠 수 있어요)" value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(14, Math.max(4, text.split('\n').length + 1))} />
                {lv.cls === 'lo' && <p className="ocr-hint">글자가 많이 틀렸다면 필기를 그대로 블록으로 묶어 두는 것도 좋아요.</p>}
                {ocr.then === 'structure' && !longEnough(text) && <p className="ocr-hint">글이 짧아 구조화하기 어려워요 — 글 상자로 바꾸는 게 나아요.</p>}
              </>
            )}
          </div>
        </div>
        <footer>
          {/* 'AI로 구조화'로 열었으면 구조화가 주 단추 (FR-039) — 고친 글로 붙여넣기와 같은 구조화 */}
          {ocr.step === 'done' && ocr.then === 'structure' && <button className="btn primary" onClick={() => ws.ocr.structure(text)} title="고친 글을 블록 · 화살표 · 그래프 · 표로 (필기는 그대로)">구조화하기</button>}
          {ocr.step === 'done' && <button className={`btn${ocr.then ? '' : ' primary'}`} onClick={() => ws.ocr.apply(text, true)}>글로 바꾸기</button>}
          {ocr.step === 'done' && <button className="btn" onClick={() => ws.ocr.apply(text, false)} title="필기는 남기고 아래에 글 상자">글 상자 추가</button>}
          {ocr.step === 'done' && !ocr.then && <button className="btn" onClick={() => ws.ocr.structure(text)} title="읽은 글을 블록 · 화살표 · 그래프 · 표로 (필기는 그대로)">구조화하기</button>}
          {ocr.step !== 'running' && !ocr.precise && <button className="btn" onClick={() => void ws.ocr.start(true)} title="더 큰 모델로 한 번 더 (조금 느림)">정밀 인식</button>}
          {ocr.step === 'error' && ocr.precise && <button className="btn" onClick={() => void ws.ocr.start(true)}>다시 시도</button>}
          {ocr.step !== 'running' && <button className="btn" onClick={() => ws.ocr.bindInstead(text)}>필기 그대로 묶기</button>}
          <button className="btn ghost" onClick={close}>취소</button>
        </footer>
      </div>
    </div>
  );
}
