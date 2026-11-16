// 08 설정 — AI (FR-139 키 관리 · FR-142 자동 구조화 유형 · 모델 선택). 로컬 전용 모드 기준 (SECURITY 4절).
import { AccountSettings } from './AccountSettings';
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { ALLOWED_MODELS, type Effort, type StructureKind } from '@dn/ai-pipeline';
import type { AiUsageTotal } from './ai';
import { NotifySettings } from './NotifySettings';
import { pickImportFiles, pickSyncFile } from './ImportDialog';
import { SecuritySettings } from './SecuritySettings';
import type { ConfirmRequest } from './ConfirmDialog';
import type { Workspace, WorkspaceState } from './workspace';
import { useEscape } from './hooks';
import { LegalLinks } from './LegalDialog';

const EFFORTS: { v: Effort; label: string }[] = [{ v: 'low', label: '낮음' }, { v: 'medium', label: '보통' }, { v: 'high', label: '높음' }];

/** API 사용량 (FR-141): 이 기기에서 보낸 요청 · 토큰 */
function AiUsageSection({ ws }: { ws: Workspace }) {
  const [u, setU] = useState<AiUsageTotal | null>(null);
  useEffect(() => { void ws.aiUsage().then(setU); }, [ws]);
  const n = (x: number) => x.toLocaleString('ko-KR');
  return (
    <section>
      <h3>사용량</h3>
      <p className="desc">{u ? `${new Date(u.since).toLocaleDateString('ko-KR')}부터 이 기기에서 보낸 구조화 요청` : '불러오는 중…'}</p>
      {u && (
        <dl className="usage-list" aria-label="API 사용량">
          <dt>요청</dt><dd>{n(u.requests)}회</dd>
          <dt>입력 토큰</dt><dd>{n(u.input)}</dd>
          <dt>출력 토큰</dt><dd>{n(u.output)}</dd>
          <dt>캐시 읽기</dt><dd>{n(u.cacheRead)}</dd>
        </dl>
      )}
      {!!u?.recent?.length && (
        <details className="usage-recent"><summary>최근 요청 {u.recent.length}개</summary>
          <ul>{u.recent.map((r) => <li key={r.at}>{new Date(r.at).toLocaleString('ko-KR')} · 입력 {n(r.input)} · 출력 {n(r.output)} · {r.model}</li>)}</ul>
        </details>
      )}
      {!!u?.requests && <button className="btn sm" onClick={() => void ws.resetAiUsage().then(() => ws.aiUsage()).then(setU)}>사용량 초기화</button>}
    </section>
  );
}

const MODEL_LABEL: Record<string, string> = {
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 (기본)',
  'claude-opus-5-5': 'Claude Opus 5.5 (더 정확 · 느림)',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5 (빠름 · 저렴)',
};
const KINDS: { k: StructureKind; label: string }[] = [
  { k: 'relation', label: '관계 → 블록 · 화살표' },
  { k: 'chart', label: '수치 → 그래프' },
  { k: 'table', label: '비교 · 대조 → 표' },
];
type Tab = 'edit' | 'account' | 'ai' | 'notify' | 'data' | 'security' | 'about';
const TAB_NAME: Record<Tab, string> = { edit: '편집', account: '계정', ai: 'AI', notify: '알림', data: '데이터', security: '보안', about: '정보' };

export function SettingsDialog({ ws, s, reason, confirm }: { ws: Workspace; s: WorkspaceState; reason?: string; confirm: (r: ConfirmRequest) => void }) {
  const [tab, setTab] = useState<Tab>(reason === 'security' || reason === 'account' ? reason : reason ? 'ai' : 'edit');
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ai = s.ai;

  useEscape(() => ws.closeDialog());

  const check = async () => {
    setBusy(true);
    setMsg(null);
    const err = await ws.saveKey(key).catch((e: unknown) => `키를 저장하지 못했어요. 다시 시도해 주세요. (${String(e)})`);
    setBusy(false);
    if (err) setMsg({ ok: false, text: err });
    else { setMsg({ ok: true, text: `키가 확인됐어요. 끝자리 ${key.trim().slice(-4)}` }); setKey(''); }
  };

  const toggleKind = (k: StructureKind) => {
    const next = ai.kinds.includes(k) ? ai.kinds.filter((x) => x !== k) : [...ai.kinds, k];
    void ws.setAiKinds(next);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={() => ws.closeDialog()}>
      <div className="settings" role="dialog" aria-modal="true" aria-label="설정" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="settings-nav">
          <div className="settings-title">설정</div>
          {(['edit', 'account', 'ai', 'notify', 'data', 'security', 'about'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{TAB_NAME[t]}</button>
          ))}
          <div className="settings-ver">DamianNote 0.1</div>
        </nav>
        <div className="settings-body">
          <header><h2>{TAB_NAME[tab]}</h2><button className="x" aria-label="닫기" onClick={() => ws.closeDialog()}><Icon name="close" size={14} /></button></header>
          {tab === 'edit' && (
            <>
            <section>
              <h3>글자 크기 · 줄 간격</h3>
              <p className="desc">블록 안 글자에 적용돼요.</p>
              <div className="pair">
                <select aria-label="글자 크기" value={s.textScale} onChange={(e) => ws.setTextScale(Number(e.target.value))}>
                  <option value={0.9}>글자 작게</option><option value={1}>글자 보통</option><option value={1.15}>글자 크게</option><option value={1.3}>글자 아주 크게</option>
                </select>
                <select aria-label="줄 간격" value={s.lineSpacing} onChange={(e) => ws.setLineSpacing(Number(e.target.value))}>
                  <option value={1}>줄 간격 보통</option><option value={1.2}>줄 간격 넓게</option><option value={1.4}>줄 간격 아주 넓게</option>
                </select>
              </div>
            </section>
            <section>
              <h3>마우스 휠</h3>
              <p className="desc">마우스 휠로 바로 확대하고 싶을 때만 바꾸세요.</p>
              <label className="radio-row"><input type="radio" name="wheel" checked={s.wheelMode === 'pan'} onChange={() => ws.setWheelMode('pan')} /> 휠로 화면 이동 · Ctrl+휠로 확대 (기본, 트랙패드 권장)</label>
              <label className="radio-row"><input type="radio" name="wheel" checked={s.wheelMode === 'zoom'} onChange={() => ws.setWheelMode('zoom')} /> 휠로 확대 · 축소 · Shift+휠로 가로 이동</label>
            </section>
            <section>
              <h3>맞춤법 검사</h3>
              <p className="desc">틀린 낱말에 빨간 밑줄을 그어요.</p>
              <label className="radio-row"><input type="checkbox" aria-label="맞춤법 검사" checked={s.spellcheck} onChange={(e) => ws.setSpellcheck(e.target.checked)} /> 맞춤법 검사 켜기 (기본)</label>
            </section>
            <section>
              <h3>새 노트 용지</h3>
              <p className="desc">A4로 시작하면 인쇄 · PDF 모양을 바로 볼 수 있어요.</p>
              <label className="radio-row"><input type="radio" name="new-sheet" checked={s.newNoteSheet !== 'a4l'} onChange={() => ws.setNewNoteSheet('a4')} /> A4 세로 (기본)</label>
              <label className="radio-row"><input type="radio" name="new-sheet" checked={s.newNoteSheet === 'a4l'} onChange={() => ws.setNewNoteSheet('a4l')} /> A4 가로</label>
            </section>
            <section>
              <h3>테마</h3>
              <label className="radio-row"><input type="radio" name="theme" checked={s.theme === 'system'} onChange={() => ws.setTheme('system')} /> 시스템 설정 따라 (기본)</label>
              <label className="radio-row"><input type="radio" name="theme" checked={s.theme === 'light'} onChange={() => ws.setTheme('light')} /> 밝게</label>
              <label className="radio-row"><input type="radio" name="theme" checked={s.theme === 'dark'} onChange={() => ws.setTheme('dark')} /> 어둡게</label>
            </section>
            <section>
              <h3>노트를 여는 보기</h3>
              <label className="radio-row"><input type="radio" name="defview" checked={s.defaultView === 'last'} onChange={() => ws.setDefaultView('last')} /> 마지막으로 쓴 보기 (기본)</label>
              <label className="radio-row"><input type="radio" name="defview" checked={s.defaultView === 'canvas'} onChange={() => ws.setDefaultView('canvas')} /> 늘 캔버스 — 자유 배치</label>
              <label className="radio-row"><input type="radio" name="defview" checked={s.defaultView === 'doc'} onChange={() => ws.setDefaultView('doc')} /> 늘 문서 — 위에서 아래로 읽기</label>
            </section>
            <section>
              <h3>시작 화면</h3>
              <label className="radio-row"><input type="radio" name="start" checked={s.startPage === 'last'} onChange={() => ws.setStartPage('last')} /> 마지막으로 보던 노트 (기본)</label>
              <label className="radio-row"><input type="radio" name="start" checked={s.startPage === 'home'} onChange={() => ws.setStartPage('home')} /> 홈 — 모든 노트를 책으로 꽂은 서재</label>
            </section>
            </>
          )}
          {tab === 'ai' ? (
            <>
              {reason && <div className="settings-reason">{reason}</div>}
              <section>
                <h3>Claude API 키</h3>
                <p className="desc">Anthropic 콘솔에서 받은 내 키로 AI 기능을 써요. 요금은 Anthropic이 키 주인에게 청구하고, DamianNote는 요금을 받지 않아요.</p>
                <details className="more"><summary>자세히</summary>
                  <p className="desc">키는 이 기기에 암호화해 두고, 브라우저에서 Claude로 바로 요청해요. 키 사용은 키 주인과 Anthropic 사이의 약관과 이용 정책을 따라요. 여러 사람이 쓰는 기기에는 키를 넣지 말고, Anthropic 콘솔에서 사용 한도를 정해 두세요.</p>
                  <p className="desc key-links">
                    <a href="https://www.anthropic.com/legal/commercial-terms" target="_blank" rel="noopener noreferrer">Anthropic Commercial Terms</a>
                    <a href="https://www.anthropic.com/legal/aup" target="_blank" rel="noopener noreferrer">Anthropic 이용 정책</a>
                    <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">Anthropic 콘솔</a>
                  </p>
                </details>
                {ai.keySource === 'env' && (
                  <div className="key-env" role="status">
                    <strong>.env.local의 키를 쓰는 중이에요 (끝자리 {ai.keyLast4})</strong>
                    <span>키는 개발 서버만 알고 있고 브라우저로는 오지 않아요. 아래에 키를 넣어도 env 키가 먼저 쓰여요.</span>
                  </div>
                )}
                <div className="key-row">
                  <div className="key-input">
                    <input type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={key}
                      placeholder={ai.keySource === 'device' ? `sk-ant-…${ai.keyLast4} (바꾸려면 새 키 입력)` : 'sk-ant-...'}
                      aria-label="Claude API 키" onChange={(e) => { setKey(e.target.value); setMsg(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) void check(); }} />
                    <button className="eye" aria-label={show ? '키 숨기기' : '키 보기'} onClick={() => setShow(!show)}><Icon name={show ? 'eyeOff' : 'eye'} size={16} /></button>
                  </div>
                  <button className="btn" disabled={!key.trim() || busy} onClick={() => void check()}>{busy ? '확인 중…' : '확인'}</button>
                  {ai.keySource === 'device' && !key && <span className="ok">● 연결됨</span>}
                </div>
                {msg && <div className={`key-msg ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.text}</div>}
                {ai.keySource === 'device' && (
                  <button className="link-danger" onClick={() => confirm({
                    title: 'API 키를 삭제할까요?', body: '삭제하면 AI 기능을 쓸 수 없어요. 이미 만든 블록은 그대로예요.',
                    confirmLabel: '키 삭제', onConfirm: () => void ws.deleteKey(),
                  })}>키 삭제</button>
                )}
              </section>
              <section>
                <h3>모델</h3>
                <p className="desc">구조 분석에 쓸 모델이에요.</p>
                <select value={ai.model} onChange={(e) => void ws.setAiModel(e.target.value)} aria-label="모델">
                  {ALLOWED_MODELS.map((m) => <option key={m} value={m}>{MODEL_LABEL[m] ?? m}</option>)}
                </select>
              </section>
              <section>
                <h3>추론 강도</h3>
                <p className="desc">높을수록 꼼꼼하지만 느리고 비싸요. 보통을 권해요.</p>
                <div className="seg" role="radiogroup" aria-label="추론 강도">
                  {EFFORTS.map((x) => (
                    <button key={x.v} role="radio" aria-checked={ai.effort === x.v} className={ai.effort === x.v ? 'on' : ''} onClick={() => void ws.setAiEffort(x.v)}>{x.label}</button>
                  ))}
                </div>
              </section>
              <AiUsageSection ws={ws} />
              <section>
                <h3>AI 자동 태그</h3>
                <p className="desc">구조화할 때 원문에서 찾을 만한 낱말을 골라 노트 태그로 붙여요. 노트에 묻기가 이 태그로 범위를 좁혀요.</p>
                <label className="toggle-row"><span>키워드를 태그로 붙이기</span>
                  <input type="checkbox" role="switch" checked={ai.autoTag} onChange={(e) => void ws.setAiAutoTag(e.target.checked)} />
                </label>
              </section>
              <section>
                <h3>자동 구조화 유형</h3>
                <p className="desc">끈 유형은 원문 그대로 둬요.</p>
                {KINDS.map(({ k, label }) => (
                  <label key={k} className="toggle-row">
                    <span>{label}</span>
                    <input type="checkbox" role="switch" checked={ai.kinds.includes(k)} disabled={ai.kinds.length === 1 && ai.kinds.includes(k)}
                      onChange={() => toggleKind(k)} />
                  </label>
                ))}
              </section>
              <section>
                <h3>데이터 전송</h3>
                <p className="desc">AI 기능을 실행하면 그 기능에 필요한 내용이 이 기기에서 Anthropic(미국)으로 바로 전송돼요. <LegalLinks ids={['ai']} /></p>
                {ai.consent
                  ? <div className="row-gap"><span className="desc">{ai.consentAt ? `${new Date(ai.consentAt).toLocaleDateString('ko-KR')}에 동의했어요.` : '동의했어요.'}</span><button className="btn sm" onClick={() => void ws.withdrawConsent()}>전송 동의 철회</button></div>
                  : <span className="desc">{ai.consentOld ? '안내 내용이 바뀌었어요. 다음에 AI를 쓸 때 다시 여쭤볼게요.' : '아직 동의하지 않았어요. 처음 AI를 쓸 때 여쭤볼게요.'}</span>}
              </section>
            </>
          ) : tab === 'data' ? (
            <section>
              <h3>내보내기 · 백업</h3>
              <p className="desc">노트는 이 브라우저에만 있어요. 가끔 내보내 두세요.</p>
              <details className="more"><summary>자세히</summary><p className="desc">브라우저 데이터를 지우면 노트도 함께 사라져요. ZIP 안에는 폴더 구조 그대로의 Markdown 파일과, 상자 위치 · 화살표 · 필기까지 담긴 백업 파일(.json)이 들어 있어요.</p></details>
              <div className="row-gap">
                <button className="btn primary" onClick={() => void ws.exportAll()}>모든 노트 내보내기 (ZIP)</button>
                {s.currentId && <button className="btn" onClick={() => void ws.exportNote(s.currentId!)}>이 노트만 Markdown으로</button>}
              </div>
              <h3>가져오기</h3>
              <p className="desc">백업 · Markdown · 옵시디언 폴더를 가져와요. 실행 전에 미리 보여 드려요.</p>
              <div className="row-gap">
                <button className="btn" onClick={() => pickImportFiles(ws)}>파일 가져오기</button>
                <button className="btn" onClick={() => pickImportFiles(ws, true)}>폴더 가져오기 (옵시디언)</button>
                <button className="btn" onClick={() => void ws.undoImport()}>마지막 가져오기 되돌리기</button>
              </div>
              <h3>기기 사이 동기화 (파일)</h3>
              <p className="desc">서버 없이 파일로 다른 기기와 노트를 맞춰요.</p>
              <details className="more"><summary>자세히</summary><p className="desc">이 기기에서 만든 동기화 파일을 다른 기기에서 가져오면, 양쪽에서 고친 내용이 블록 · 글자 단위로 합쳐져요. 한쪽에서 지운 블록을 다른 쪽에서 고쳤다면 지우지 않고 주황 테두리로 표시해요. 합치기 전 상태는 버전 기록에 남고, 잠긴 노트는 넣지 않아요.</p></details>
              <div className="row-gap">
                <button className="btn" onClick={() => void ws.exportSyncFile()}>동기화 파일 만들기</button>
                <button className="btn" onClick={() => pickSyncFile(ws)}>동기화 파일 가져오기</button>
              </div>
              <h3>검색 색인</h3>
              <p className="desc">검색 · 노트에 묻기가 쓰는 색인이에요. 노트를 고칠 때마다 저절로 맞춰지고, 손글씨에서 읽은 글도 함께 찾아요(이 기기에만). 결과가 이상하면 다시 만들어 보세요.</p>
              <div className="row-gap">
                <button className="btn reindex-btn" disabled={!!s.indexing} onClick={() => void ws.rebuildIndex()}>색인 다시 만들기</button>
                {s.indexing && <span className="desc" role="status">색인 중 {Math.round((s.indexing.done / Math.max(1, s.indexing.total)) * 100)}% ({s.indexing.done}/{s.indexing.total})</span>}
              </div>
              <p className="desc small">{s.lastExportAt ? `마지막 내보내기: ${new Date(s.lastExportAt).toLocaleString('ko-KR')}` : '아직 내보낸 적이 없어요.'}</p>
            </section>
          ) : tab === 'notify' ? (
            <NotifySettings ws={ws} />
          ) : tab === 'account' ? (
            <AccountSettings ws={ws} s={s} confirm={confirm} />
          ) : tab === 'security' ? (
            <SecuritySettings ws={ws} s={s} />
          ) : tab === 'about' && (
            <>
            <section>
              <p className="desc">DamianNote 0.1 · 로컬 우선 노트앱. 노트는 이 기기의 브라우저 저장소에만 보관되고, 운영자 서버로 보내지 않아요.</p>
            </section>
            <section>
              <h3>약관 · 개인정보</h3>
              <p className="desc about-legal"><LegalLinks /></p>
              <p className="desc small">Notion · Microsoft Word · Obsidian · Anthropic · Claude 등은 각 소유자의 상표이며, DamianNote는 이들과 제휴 관계가 없어요.</p>
            </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

