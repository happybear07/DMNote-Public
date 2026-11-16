// 작성 도우미 창 (FR-112): 고른 글 아래에 — 할 일(요약 · 자세히 · 다듬기 · 이어 쓰기, 말투 넷, 번역 언어)을 누르면 미리보기에
// 결과가 흘러나오고, 끝나면 바꾸기 · 아래에 넣기(이어 쓰기는 이어서 넣기). 노트 요약(FR-115)은 화면 위쪽에 열려 바로 보내고
// '노트 맨 위에 넣기', 노트 번역(FR-114)은 언어를 고르면 보내고 '새 노트로 만들기', 초안(FR-113)은 주제를 쓰고 '초안 쓰기'.
// 원문에 없던 숫자는 형광으로 강조(확인용). 바깥을 누르거나 Esc면 닫힌다(보내던 요청도 그만).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { stripSegments, type EditAction, type EditLang, type EditTone } from '@dn/ai-pipeline';
import { targetLangs, type AiEditState } from './ai-edit-flow';
import type { Workspace } from './workspace';
import { useEscape } from './hooks';
import { Icon } from './Icon';

const ACTIONS: { action: EditAction; label: string; title: string }[] = [
  { action: 'summarize', label: '요약', title: '요점만 짧게 (3분의 1 이하)' },
  { action: 'expand', label: '자세히', title: '글에 담긴 단계 · 이유를 풀어서 (새 사실은 넣지 않음)' },
  { action: 'polish', label: '다듬기', title: '맞춤법 · 띄어쓰기 · 어색한 문장만' },
  { action: 'continue', label: '이어 쓰기', title: '고른 글 다음에 올 두세 문장 (모르는 숫자 · 이름은 [ ] 자리로)' },
];
const TONES: { tone: EditTone; label: string }[] = [
  { tone: 'formal', label: '격식체' }, { tone: 'casual', label: '해요체' }, { tone: 'concise', label: '간결하게' }, { tone: 'friendly', label: '친근하게' },
];
const TITLES = { range: 'AI로 고치기', digest: 'AI로 노트 요약', translate: 'AI로 노트 번역', draft: 'AI로 초안 쓰기' };

/** 원문에 없던 숫자에 표시 — 다른 숫자의 일부(2015의 15)는 건드리지 않는다 */
function marked(text: string, nums: readonly string[]): ReactNode {
  if (!nums.length) return text;
  const esc = [...nums].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(?<![\\d.,])(${esc.join('|')})(?![\\d])`, 'g'));
  return parts.map((p, i) => (i % 2 ? <mark key={i} className="ai-edit-new" title="원문에 없던 숫자 — 맞는지 확인해 주세요">{p}</mark> : p));
}

export function AiEditPanel({ ws, st }: { ws: Workspace; st: AiEditState }) {
  const ref = useRef<HTMLDivElement>(null);
  /** 바깥을 눌러 닫음 — 그때는 초점을 되돌리지 않는다 */
  const outside = useRef(false);
  const [pos, setPos] = useState({ x: st.x, y: st.y });
  const [brief, setBrief] = useState('');
  // 연 자리와 그 상자 (렌더 때 — 초안 칸의 autoFocus보다 먼저)
  const [back] = useState(() => {
    const a = document.activeElement as HTMLElement | null;
    return { el: a, block: a?.closest<HTMLElement>('.dn-block[data-id]')?.dataset.id };
  });
  const close = () => ws.aiEdit.close();
  useEscape(close);
  // 키보드로 쓸 수 있게 (교차 검토 C5 — 창이 문서 끝에 따로 떠서 Tab으로 닿지 않았다): 열리면 첫 단추로 초점,
  // 닫히면 초점이 창 안에 있었을 때만 연 자리로 돌려준다 — 바깥을 눌러 닫았으면 그대로.
  // 캔버스 글 상자는 초점이 창으로 오면 편집이 끝나므로 그 상자를 고른 채 캔버스로 (Enter면 다시 고치기)
  useEffect(() => {
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('textarea, .ai-edit-chip, footer .btn')?.focus({ preventScroll: true });
    return () => {
      const a = document.activeElement;
      if (outside.current || (a && a !== document.body && !el?.contains(a))) return;
      const v = ws.view;
      if (back.el?.isConnected && back.el !== document.body) back.el.focus({ preventScroll: true });
      else if (back.block && v?.engine.getBlock(back.block)) { v.select([back.block]); v.root.focus({ preventScroll: true }); }
    };
  }, []);
  // 보내는 동안 · 결과가 나오면 초점을 할 수 있는 단추로 (보내기 단추가 사라져 초점을 잃었거나 창 안에 있을 때만)
  useEffect(() => {
    const el = ref.current, a = document.activeElement;
    if (!el || st.step === 'choose' || !(a === document.body || el.contains(a))) return;
    if (st.step === 'running' && a !== document.body) return;
    (el.querySelector<HTMLElement>('footer .btn.primary') ?? el.querySelector<HTMLElement>('footer .btn'))?.focus({ preventScroll: true });
  }, [st.step]);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.max(8, Math.min(st.x, innerWidth - r.width - 8)), y: st.y + r.height > innerHeight - 8 ? Math.max(8, innerHeight - r.height - 8) : st.y });
  }, [st.x, st.y, st.step, st.text.length > 0]);
  useEffect(() => {
    // 동의 · 키 창에서 누른 것은 바깥이 아니다 — 등록하고 돌아와 다시 누를 수 있게
    const onDown = (e: PointerEvent) => { const t = e.target as Element; if (!ref.current?.contains(t) && !t.closest?.('[role="dialog"], .dialog-backdrop')) { outside.current = true; close(); } };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });
  const run = (action: EditAction, tone?: EditTone, target?: EditLang) => void ws.aiEdit.run(action, tone, target);
  const busy = st.step === 'running', done = st.step === 'done';
  const mode = st.kind === 'note' ? st.intent ?? 'digest' : st.kind;
  const on = (a: EditAction, t?: EditTone, l?: EditLang) => st.step !== 'choose' && st.action === a && (!t || st.tone === t) && (!l || st.target === l);
  const langs = (
    <div className="ai-edit-row" role="group" aria-label="번역">
      <span className="ai-edit-label">번역</span>
      {targetLangs(st.lang).map((l) => <button key={l.lang} className={`ai-edit-chip${on('translate', undefined, l.lang) ? ' on' : ''}`} title={`${l.label}로 번역`} onClick={() => run('translate', undefined, l.lang)}>{l.label}</button>)}
    </div>
  );
  const out = mode === 'translate' ? stripSegments(st.text) : ws.aiEdit.previewText(st.text);
  // 바꾸면 서식이 사라지거나 AI가 링크 · 날짜를 빠뜨렸으면 '아래에 넣기'가 주 단추 (원문을 지킨다)
  const keepOrig = !!st.lost?.length || !!st.missing;
  const hint = mode === 'digest' ? '요약 · 결정 · 할 일을 뽑아 노트 맨 위에 넣어요.'
    : mode === 'translate' ? '글 상자 · 화살표 이름을 번역해 새 노트로 만들어요. 원본 노트는 그대로예요.'
    : mode === 'range' && st.step === 'choose' ? '결과는 먼저 보여 드리고, 바꿀지 아래에 넣을지 고를 수 있어요.' : null;
  return (
    <div ref={ref} className="ai-edit" role="dialog" aria-label={TITLES[mode]} style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
      <header>
        <span className="ai-edit-title"><Icon name="sparkle" size={14} />{TITLES[mode]} {mode !== 'draft' && <small>{st.kind === 'note' ? '노트 글' : '고른 글'} {st.chars.toLocaleString()}자</small>}</span>
        <button className="x" aria-label="닫기" onClick={close}><Icon name="close" size={14} /></button>
      </header>
      {mode === 'range' && <>
        <div className="ai-edit-row" role="group" aria-label="할 일">
          {ACTIONS.map((a) => <button key={a.action} className={`ai-edit-chip${on(a.action) ? ' on' : ''}`} title={a.title} onClick={() => run(a.action)}>{a.label}</button>)}
        </div>
        <div className="ai-edit-row" role="group" aria-label="말투">
          <span className="ai-edit-label">말투</span>
          {TONES.map((t) => <button key={t.tone} className={`ai-edit-chip${on('tone', t.tone) ? ' on' : ''}`} onClick={() => run('tone', t.tone)}>{t.label}</button>)}
        </div>
        {langs}
      </>}
      {mode === 'translate' && langs}
      {mode === 'draft' && (
        <form className="ai-edit-brief" onSubmit={(e) => { e.preventDefault(); void ws.aiEdit.draft(brief); }}>
          <textarea autoFocus rows={2} value={brief} maxLength={1000} placeholder="무엇에 대한 초안인가요? (예: 신입 사원 첫 주 안내 — 친근하게, 목록으로)" aria-label="초안 주제"
            onChange={(e) => setBrief(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ws.aiEdit.draft(brief); } }} />
          <button className="btn sm" type="submit" disabled={!brief.trim() || busy}>{st.step === 'choose' ? '초안 쓰기' : '다시 쓰기'}</button>
        </form>
      )}
      {hint && <p className="ai-edit-hint">{hint}</p>}
      {st.step !== 'choose' && (
        <div className={`ai-edit-out${busy ? ' busy' : ''}`} aria-live="polite" aria-busy={busy}>
          {st.step === 'error' ? <p className="ai-edit-err" role="alert">{st.error}</p>
            : out ? marked(out, done ? st.newNumbers : []) : <span className="ai-edit-wait"><i />{mode === 'translate' || st.action === 'translate' ? '번역하는 중…' : mode === 'draft' || st.action === 'continue' ? '쓰는 중…' : '고치는 중…'}</span>}
        </div>
      )}
      {done && st.newNumbers.length > 0 && <p className="ai-edit-warn">원문에 없던 숫자가 있어요({st.newNumbers.join(', ')}) — 맞는지 확인해 주세요.</p>}
      {done && (mode === 'draft' || st.action === 'continue') && /\[[^\]\n]{1,20}\]/.test(st.text) && <p className="ai-edit-hint">[ ] 안은 직접 채울 자리예요.</p>}
      {done && st.truncated && <p className="ai-edit-warn">결과가 길어 끝이 잘렸어요. 고른 글을 지우지 않게 '아래에 넣기'만 돼요 — 글을 나눠서 다시 해 보세요.</p>}
      {mode === 'range' && !!st.lost?.length && <p className="ai-edit-warn">바꾸면 사라지는 서식: {st.lost.join(' · ')} — 원문을 지키려면 '아래에 넣기'를 쓰세요.</p>}
      {done && !!st.missing && <p className="ai-edit-warn">AI가 노트 링크 · 날짜 같은 물건 {st.missing}개를 빠뜨렸어요 — 바꾸면 그것도 사라져요.</p>}
      <footer>
        {busy && <button className="btn" onClick={close}>그만두기</button>}
        {mode === 'digest' && st.step === 'choose' && <button className="btn primary" onClick={() => run('digest')}>요약하기</button>}
        {done && mode === 'digest' && <button className="btn primary" onClick={() => ws.aiEdit.applyNote()}>노트 맨 위에 넣기</button>}
        {done && mode === 'translate' && <button className="btn primary" onClick={() => void ws.aiEdit.applyTranslation()}>새 노트로 만들기</button>}
        {done && mode === 'draft' && <button className="btn primary" onClick={() => ws.aiEdit.applyDraft()}>{st.inBox ? '이 상자에 넣기' : '노트 맨 끝에 넣기'}</button>}
        {done && mode === 'range' && (st.action === 'continue'
          ? <button className="btn primary" onClick={() => ws.aiEdit.apply('after')} title="고른 글 바로 뒤에">이어서 넣기</button>
          : <>
            {/* 끝이 잘린 결과로 바꾸면 고른 글 뒷부분이 사라진다 — 아래에 넣기만 (교차 검토 A5) */}
            {!st.truncated && <button className={`btn${keepOrig ? '' : ' primary'}`} onClick={() => ws.aiEdit.apply('replace')}>바꾸기</button>}
            <button className={`btn${keepOrig || st.truncated ? ' primary' : ''}`} onClick={() => ws.aiEdit.apply('below')} title="고른 글은 그대로 두고 아래에">아래에 넣기</button>
          </>)}
        {(done || st.step === 'error') && st.action && mode !== 'draft' && <button className="btn ghost" onClick={() => run(st.action!, st.tone, st.target)}>다시</button>}
      </footer>
    </div>
  );
}
