// 단축키 도움말 (FR-023, Ctrl+/): 트래커 '단축키' 문서(FR.md 부록 A)에서 생성한 같은 정의를 보여 준다.
// macOS면 Ctrl → ⌘, Alt → ⌥ 로 바꿔 쓴다. 아직 미착수 기능의 키는 "준비 중".
// 보이는 쪽에서만 다듬는다(DS-006): 내부 번호(FR · PRD · CQ …)는 숨기고, 키가 아닌 설명 줄은 한 줄 메모로,
// 개발 규칙인 '브라우저 단축키와의 충돌 처리' 묶음은 뺀다. 원문(shortcuts.gen.ts)은 그대로.
import { useMemo, useState } from 'react';
import { SHORTCUT_SECTIONS } from './shortcuts.gen';
import type { Workspace } from './workspace';
import { Icon } from './Icon';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const forOs = (s: string) => (isMac ? s.replace(/Ctrl\/⌘/g, '⌘').replace(/\bCtrl\b/g, '⌘').replace(/\bAlt\b/g, '⌥') : s.replace(/Ctrl\/⌘/g, 'Ctrl'));
/** 내부 번호 괄호 — "(FR-027)" · "(PRD-26)" · "(CQ-002 · CQ-003)" · "(FR-034~042)" */
const clean = (s: string) => s.replace(/\s*\((?:FR|PRD|CQ|DQ|AT|UX)-[^)]*\)/g, '').trim();
/** 키처럼 보이는 앞부분 — 짧고 조합 키 · 특수 키 · 따옴표 입력이 들어 있다 */
const KEYISH = /Ctrl|Alt|Shift|⌘|⌥|Enter|Tab|Esc|Del|Backspace|Space|F\d|'|^\S$|^[A-Z0-9]\s|←|→|↑|↓|\//;
const HIDDEN_SECTION = '브라우저 단축키와의 충돌 처리';

type Row = { keys: string[]; desc: string } | { note: string };
/** "키 — 설명" 한 줄(또는 " / "로 이은 여러 쌍)을 줄들로 */
function rows(text: string): Row[] {
  const t = clean(forOs(text));
  // "A — 하나 / B — 둘" 또는 "V — 선택 · B — 상자 · T — 제목 …"처럼 여러 쌍을 이은 줄은 쌍마다 한 줄로
  const bySlash = t.split(' / '), byDot = t.split(' · ');
  const pairs = bySlash.length > 1 && bySlash.every((p) => p.includes(' — ')) ? bySlash
    : byDot.length > 2 && byDot.every((p) => /^\S{1,12} — /.test(p)) ? byDot : [t];
  return pairs.map((p) => {
    const i = p.indexOf(' — ');
    const keys = i < 0 ? '' : p.slice(0, i);
    if (!keys || keys.length > 44 || !KEYISH.test(keys)) return { note: p };
    // 키 나누기는 띄어 쓴 ' / ' · ' · '만 — 'Ctrl+/'가 'Ctrl+'로 잘리지 않게
    return { keys: keys.split(/\s+\/\s+|\s+·\s+/).filter(Boolean), desc: p.slice(i + 3) };
  });
}

export function ShortcutHelp({ ws }: { ws: Workspace }) {
  const [q, setQ] = useState('');
  const sections = useMemo(() => {
    const k = q.trim().toLowerCase();
    return SHORTCUT_SECTIONS.filter((s) => s.heading !== HIDDEN_SECTION)
      .map((s) => ({ ...s, heading: clean(s.heading), items: s.items.filter((i) => !k || i.text.toLowerCase().includes(k)) }))
      .filter((s) => s.items.length);
  }, [q]);
  return (
    <div className="dialog-backdrop" onMouseDown={() => ws.closeDialog()}>
      <div className="dialog help-dialog" role="dialog" aria-modal="true" aria-label="단축키" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') ws.closeDialog(); }}>
        <div className="tpl-head">
          <h2>단축키</h2>
          <input className="help-search" autoFocus value={q} placeholder="찾기 (예: 링크, 줌)" aria-label="단축키 찾기" onChange={(e) => setQ(e.target.value)} />
          <button className="icon-btn" aria-label="닫기" onClick={() => ws.closeDialog()}><Icon name="close" size={14} /></button>
        </div>
        <div className="help-body">
          {sections.map((s) => (
            <section key={s.heading}>
              <h3>{s.heading}</h3>
              <dl>
                {s.items.flatMap((it) => rows(it.text).map((r, n) => (
                  'note' in r
                    ? <div key={`${it.text}${n}`} className={`note${it.ready ? '' : ' later'}`}><dd>{r.note}{!it.ready && <em>준비 중</em>}</dd></div>
                    : (
                      <div key={`${it.text}${n}`} className={it.ready ? '' : 'later'}>
                        <dt>{r.keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
                        <dd>{r.desc}{!it.ready && <em>준비 중</em>}</dd>
                      </div>
                    )
                )))}
              </dl>
            </section>
          ))}
          {!sections.length && <p className="card-empty">맞는 단축키가 없어요.</p>}
        </div>
      </div>
    </div>
  );
}
