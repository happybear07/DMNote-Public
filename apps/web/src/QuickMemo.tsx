// 내 페이지 빠른 메모 (11/11, HOME-SCREEN H3 · H-U1 B): 떠오른 것을 적고 Enter → '받은 메모' 노트 맨 아래에 상자로 쌓고 이 화면에 머문다.
// Shift+Enter는 줄 바꿈, 한글 조합 중 Enter는 무시. 넣으면 칸을 비우고 바로 아래에 '받은 메모에 넣었어요 · 열기'(멀리 뜨는 알림 대신 제자리).
// 긴 글(세 줄 이상 · 80자 이상 — 붙여넣은 글)이면 '새 노트로 AI 정리' 칩: 새 노트를 열고 붙여넣기와 같은 구조화(UX-FLOW 3.2 붙여넣기 히어로).
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import type { Workspace } from './workspace';

export function QuickMemo({ ws }: { ws: Workspace }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [put, setPut] = useState<string | null>(null);
  const long = text.trim().length >= 80 || text.trim().split('\n').length >= 3;
  useEffect(() => { if (!put) return; const t = setTimeout(() => setPut(null), 5000); return () => clearTimeout(t); }, [put]);
  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    const id = await ws.addToInbox(t);
    setBusy(false);
    if (id) { setText(''); setPut(id); }
  };
  return (
    <div className="quick-memo">
      <label className="qm-box">
        <Icon name="pencil" size={16} />
        <textarea value={text} rows={Math.min(6, Math.max(1, text.split('\n').length))} placeholder="메모를 적거나 붙여넣기 — Enter로 받은 메모에" aria-label="빠른 메모"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
      </label>
      {long && (
        <div className="qm-actions">
          <button type="button" className="qm-ai" onClick={() => { const t = text.trim(); setText(''); void ws.memoToNote(t); }}>
            <Icon name="sparkle" size={14} />새 노트로 AI 정리
          </button>
          <span>또는 Enter로 받은 메모에</span>
        </div>
      )}
      {put && <p className="qm-done" role="status">받은 메모에 넣었어요 · <button className="text-btn" onClick={() => void ws.openById(put)}>열기</button></p>}
    </div>
  );
}
