// AI 구조화 화면 조각: 03 "구조화하기" 칩 · 04 진행 카드 · AI 동의 다이얼로그 (MSG-AI-001 · 020~029).
import { useEffect, useMemo, useRef, useState } from 'react';
import { chunkText, MAX_CHARS, normalizeSource } from '@dn/ai-pipeline';
import type { CanvasView } from '@dn/engine-dom';
import { blockText, progressText, type AiRun } from './ai';
import type { Workspace } from './workspace';
import { useEscape } from './hooks';
import { Icon } from './Icon';
import { CONSENT_ITEMS } from './legal/consent';
import { LegalLinks } from './LegalDialog';

/** 블록 아래에 붙는 위치 (캔버스 영역 기준). 블록이 화면 밖이면 null. */
function below(view: CanvasView, blockId: string, gap = 16): { left: number; top: number; width: number } | null {
  const r = view.blockScreenRect(blockId);
  if (!r) return null;
  return { left: Math.max(12, r.x), top: r.y + r.h + gap, width: Math.max(r.w, 360) };
}

export function AiChip({ ws, view, blockId }: { ws: Workspace; view: CanvasView; blockId: string }) {
  // 긴 글은 미리 알린다 (FR-101, MSG-AI-029 · 033): 몇 번에 나눠 분석하는지, 상한을 넘으면 일부만 골라 달라고
  const length = useMemo(() => lengthHint(view, blockId), [view, blockId]);
  const pos = below(view, blockId);
  if (!pos) return null;
  return (
    <div className="ai-chip" style={{ left: pos.left, top: pos.top }} role="group" aria-label="붙여넣은 내용 구조화">
      <button className="btn ai" onClick={() => void ws.structure(blockId)}><Icon name="sparkle" size={14} />구조화하기</button>
      <button className="btn" onClick={() => ws.dismissChip()}>그대로 두기</button>
      <kbd>Ctrl+Alt+S</kbd>
      <span className={`ai-chip-hint${length?.warn ? ' warn' : ''}`}>{length?.text ?? '관계 · 수치 · 비교를 블록 · 화살표 · 그래프 · 표로 정리해요'}</span>
    </div>
  );
}

/** 칩 보조 문구: 보낼 원문을 실제와 같은 규칙(정규화 → 청킹)으로 나눠 본다 */
function lengthHint(view: CanvasView, blockId: string): { text: string; warn?: boolean } | null {
  const src = normalizeSource(blockText(view.engine, blockId));
  if (src.length > MAX_CHARS) return { text: '글이 너무 길어요. 일부만 선택해서 구조화해 주세요.', warn: true };
  const n = chunkText(src).length;
  return n > 1 ? { text: `긴 글이라 ${n}번에 나눠 분석해요.` } : null;
}

export function AiProgress({ ws, view, run }: { ws: Workspace; view: CanvasView; run: AiRun }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const pos = below(view, run.blockId) ?? { left: 24, top: 24, width: 360 };
  const p = run.progress;
  const t = progressText(p);
  const slow = Date.now() - run.startedAt > 10_000;
  return (
    <div className="ai-progress" style={{ left: pos.left, top: pos.top }} role="status" aria-live="polite">
      <div className="ai-progress-head"><span className="spark">✦</span><strong>{t.title}</strong></div>
      <div className="ai-progress-sub">{t.sub}</div>
      <div className="bar"><div style={{ width: `${Math.max(4, Math.round(p?.pct ?? 4))}%` }} /></div>
      <div className="ai-progress-foot">
        <span>{p?.chunks && p.chunks > 1 ? `구간 ${Math.min((p.chunk ?? 0) + 1, p.chunks)} / ${p.chunks}` : ''}{slow ? ' 긴 글은 조금 더 걸려요. 다른 작업을 해도 괜찮아요.' : ''}</span>
        <button className="btn sm" onClick={() => ws.cancelStructure()}>취소</button>
      </div>
      <div className="ai-progress-note">취소해도 붙여넣은 원문은 사라지지 않아요</div>
    </div>
  );
}

/** AI 전송 동의 (MSG-AI-001 · LEGAL-RISK R2): 생성형 AI 사전 고지 + 국외 이전 알릴 사항(제28조의8 제2항) 전부 — 동의는 기능 셋(구조화 · 손글씨 · 묻기)에 하나 */
export function ConsentDialog({ ws, old }: { ws: Workspace; old: boolean }) {
  // 처음 초점은 창(안내 글) — '동의하고 계속'에 두면 Enter 한 번에 동의가 된다 (교차 검토 C10). 화면 읽기는 제목부터
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { boxRef.current?.focus(); }, [ws]);
  useEscape(() => ws.closeDialog());
  return (
    <div className="dialog-backdrop" onMouseDown={() => ws.closeDialog()}>
      <div ref={boxRef} tabIndex={-1} className="dialog consent-dialog" role="dialog" aria-modal="true" aria-labelledby="consent-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="consent-title">AI를 쓰기 전에 알려 드려요</h2>
        {old && <p className="consent-old" role="status">안내 내용이 바뀌어 다시 여쭤봐요.</p>}
        <p>AI로 구조화하기 · 손글씨를 글로 · AI로 고치기 · AI로 초안 쓰기 · AI로 노트 요약 · AI로 노트 번역 · 노트에 묻기는 <b>생성형 AI(Anthropic Claude)</b>로 동작해요. 실행할 때마다 아래처럼 미국으로 전송돼요.</p>
        <dl className="consent-items">
          {CONSENT_ITEMS.map((x) => <div key={x.k}><dt>{x.k}</dt><dd>{x.v}</dd></div>)}
        </dl>
        <p className="consent-note">다른 사람의 개인정보나 건강 · 법률 같은 민감한 내용은 보내기 전에 빼 주세요.</p>
        <p className="consent-links"><LegalLinks ids={['ai', 'privacy']} /><a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noopener noreferrer">Anthropic 개인정보 방침</a></p>
        <div className="dialog-actions">
          <button className="btn" onClick={() => ws.closeDialog()}>취소</button>
          <button className="btn primary" onClick={() => void ws.acceptConsent()}>동의하고 계속</button>
        </div>
      </div>
    </div>
  );
}
