import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { TopMore } from './TopMore';
import { BlockMenu } from './BlockMenu';
import { ArrowMenu } from './MeaningMenu';
import { Workspace, type WorkspaceState } from './workspace';
import { Sidebar } from './Sidebar';
import { TagBar } from './TagBar';
import { SearchOverlay } from './SearchOverlay';
import { TrashPage } from './TrashPage';
import { TodoPage } from './TodoPage';
import { HomePage } from './HomePage';
import { MePage } from './MePage';
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog';
import { AiChip, AiProgress, ConsentDialog } from './AiPanels';
import { SettingsDialog } from './SettingsDialog';
import { CommandPalette } from './CommandPalette';
import { MoveToDialog } from './MoveToDialog';
import { Breadcrumb } from './Breadcrumb';
import { ReplaceOverlay } from './ReplaceOverlay';
import { NotePanel } from './NotePanel';
import { TemplateGallery } from './TemplateGallery';
import { ImportDialog, pickImportFiles } from './ImportDialog';
import { ShortcutHelp } from './ShortcutHelp';
import { InkBar } from './InkBar';
import { DbRowBar } from './DbRowBar';
import { VersionsDialog } from './VersionsDialog';
import { InsertMenu } from './InsertMenu';
import { Toolbar } from './Toolbar';
import { CardFixPill } from './CardMenu';
import { DocRibbon } from './DocRibbon';
import { DocStatus } from './DocStatus';
import { LoginDialog } from './LoginDialog';
import { ExportDialog } from './ExportDialog';
import { OcrDialog } from './OcrDialog';
import { SnippetName } from './SnippetName';
import { MenuBtn } from './MenuBtn';
import { NoteMenu } from './NoteMenu';
import { AiEditPanel } from './AiEditPanel';
import { QaPanel } from './QaPanel';
import { ChartEditor } from './ChartEditor';
import { RecordBar } from './RecordBar';
import { SttBar } from './SttBar';
import { CoverBanner, IconPicker, NoteGlyph } from './NoteLook';
import { CommentThread } from './CommentThread';
import { GraphPage } from './GraphPage';
import { SidePane } from './SidePane';
import { LockScreen, NoteUnlock } from './LockScreen';
import { isInkTool } from '@dn/engine-dom';
import { InstallHint } from './Onboarding';
import { useEscape } from './hooks';

const STATUS_LABEL: Record<WorkspaceState['status'], string> = {
  saved: '저장됨', pending: '저장 대기', saving: '저장 중…', error: '저장 실패', readonly: '읽기 전용',
};

export function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Workspace | null>(null);
  const [s, setS] = useState<WorkspaceState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  // 펜 · 형광펜 설정 창 — 필기 막대 굵기 단추 · 도구 막대 펜/형광펜 두 번 누르기가 같이 연다
  const [inkSettings, setInkSettings] = useState(false);

  useEffect(() => {
    const ws = new Workspace();
    wsRef.current = ws;
    const off = ws.subscribe(setS);
    void ws.init(canvasRef.current!, docRef.current!);
    // e2e · 디버깅용 (개발 서버 · VITE_E2E 빌드만): 가져오기 파일 고르기 창
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') (window as unknown as { __dnPickImport: (f?: boolean) => void }).__dnPickImport = (f) => pickImportFiles(ws, f);
    // Ctrl+Alt+S: 선택한 블록 구조화 (부록 A · MSG-AI-028)
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.altKey && e.code === 'KeyS') { e.preventDefault(); void ws.structure(ws.state.chip ?? undefined); }
      // 전체 검색 · 빠른 전환 (FR-121 · FR-087) — 브라우저의 인쇄(Ctrl+P)보다 앱 동작이 먼저 (FR.md 단축키 원칙)
      if (mod && !e.altKey && e.shiftKey && e.code === 'KeyF') { e.preventDefault(); ws.openOverlay('search'); }
      if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyP') { e.preventDefault(); ws.openOverlay('switch'); }
      if (mod && !e.altKey && e.shiftKey && e.code === 'KeyP') { e.preventDefault(); ws.openOverlay('command'); }
      // 부록 A 전역 단축키 (FR-023) — 브라우저가 선점하지 않는 조합만
      if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyF') { e.preventDefault(); ws.openOverlay('replace'); } // 이 노트에서 찾기
      if (mod && e.altKey && !e.shiftKey && e.code === 'KeyN') { e.preventDefault(); void ws.newNote(ws.newNotePlace()); }
      // 선택한 블록에 댓글 (FR-132)
      if (mod && e.altKey && !e.shiftKey && e.code === 'KeyM') { e.preventDefault(); ws.commentOnSelection(); }
      // 녹음 시작 / 끝내기 (FR-043)
      if (mod && e.altKey && !e.shiftKey && e.code === 'KeyR') { e.preventDefault(); void (ws.isRecording ? ws.stopRecording() : ws.startRecording()); }
      if (mod && !e.altKey && e.code === 'Backslash' && !e.shiftKey) { e.preventDefault(); ws.toggleSidebar(); }
      if (mod && !e.altKey && !e.shiftKey && e.code === 'Comma') { e.preventDefault(); ws.openSettings(); }
      if (mod && !e.altKey && e.code === 'Slash') { e.preventDefault(); ws.openHelp(); }
      if (mod && e.altKey && e.key === 'Enter') { e.preventDefault(); ws.setReadMode(!ws.state.readMode); }
      if (mod && e.altKey && !e.shiftKey && e.code === 'KeyP' && ws.state.currentId && ws.state.page === 'note') { e.preventDefault(); ws.present(); } // 발표 모드 (GAP #21)
      if (e.key === 'Escape' && ws.state.readMode && !ws.state.overlay && !ws.state.dialog) ws.setReadMode(false);
      // 실행 취소 · 다시 실행 — 초점이 문서 · 캔버스 밖(BODY · 도구 막대 단추 · 필기 막대 …)에 있을 때도 (DQ-019 · CQ-004 · 알파 10/31:
      // 단추를 누른 뒤엔 Ctrl+Z가 죽어 '한 번만 된다'). 입력 칸은 제 실행 취소, 캔버스 · 문서 · 편집기는 제 키로(처리하면 defaultPrevented)
      const typing = (e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
      if (mod && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY') && !e.defaultPrevented && !typing && ws.view && !ws.view.readOnly && !ws.state.dialog && !ws.state.overlay) {
        e.preventDefault();
        if (e.code === 'KeyY' || e.shiftKey) ws.view.redo(); else ws.view.undo();
      }
      // Ctrl+L — 고른 블록 하나의 링크 복사 (FR-025) · 캔버스에서만 — 문서 뷰의 Ctrl+L은 왼쪽 맞춤 (DQ-020)
      if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyL' && ws.view && ws.state.viewMode !== 'doc' && !ws.view.root.querySelector('.dn-text-editing') && ws.view.selectedBlocks.length === 1 && ws.state.currentId) {
        e.preventDefault();
        const url = `${location.origin}${location.pathname}#n=${ws.state.currentId}&b=${ws.view.selectedBlocks[0]}`;
        void navigator.clipboard.writeText(url).then(() => ws.toast('블록 링크를 복사했어요.'), () => ws.toast('링크를 복사하지 못했어요.'));
      }
      // 찾아 바꾸기 (FR-123) — 글 편집 중에도
      if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyH') { e.preventDefault(); ws.openOverlay('replace'); }
    };
    window.addEventListener('keydown', onKey);
    return () => { off(); window.removeEventListener('keydown', onKey); void ws.dispose(); };
  }, []);

  const ws = wsRef.current;
  const view = ws?.view;
  const ui = s?.ui;
  const current = s?.notes.find((n) => n.id === s.currentId);
  // 고칠 수 없는 탭: 보기 전용으로 연 노트 — 저장하는 탭과 함께 편집 중이면 고칠 수 있다
  const noWrite = s?.status === 'readonly' && s?.tabRole !== 'guest';
  // 백링크 수 (topbar 배지) — 목록이 바뀔 때마다(편집 400ms 뒤) 다시 센다
  const backlinks = s?.currentId && ws ? ws.backlinks().length : 0;
  const closeMenu = useCallback(() => wsRef.current?.closeBlockMenu(), []);
  const closeArrowMenu = useCallback(() => wsRef.current?.closeArrowMenu(), []);
  const closeInsert = useCallback(() => wsRef.current?.closeInsertMenu(), []);
  // 노트 아이콘 · 커버 고르기 (FR-070) — 위 막대 아이콘을 누르면
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const closePicker = useCallback(() => setPicker(null), []);
  useEffect(() => { setPicker(null); }, [s?.currentId]);
  // 좁은 화면 (FR-152): 사이드바는 서랍 — 노트를 고르거나 다른 화면으로 가면 닫힌다
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { setDrawer(false); }, [s?.currentId, s?.page]);
  // 문서 뷰 쪽 보기: 전체 폭 · 창 크기에 맞춰 (좁으면 종이 없이)
  useEffect(() => {
    ws?.syncDocPages();
    const on = () => ws?.syncDocPages();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [ws, s?.look.page?.fullWidth, s?.viewMode, s?.currentId]);
  useEscape(() => setDrawer(false), drawer);
  // 서랍 여는 단추 — 노트 위 막대와 홈 · 할 일 · 그래프 · 휴지통 머리에 같은 것 (좁은 화면에서 노트 밖 화면에도 사이드바를)
  const menuBtn = <MenuBtn open={drawer} onOpen={() => setDrawer(true)} />;

  return (
    <>
    <div inert={s?.appLocked || undefined} aria-hidden={s?.appLocked || undefined} className={`app${s?.readMode ? ' read-mode' : ''}${s?.sidebarHidden ? ' side-hidden' : ''}${drawer ? ' drawer-open' : ''}`}>
      {ws && s && <Sidebar ws={ws} s={s} confirm={setConfirm} onNavigate={() => setDrawer(false)} />}
      {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)} aria-hidden />}

      <main className="main">
        {s?.page === 'trash' && ws && s && <TrashPage ws={ws} trash={s.trash} confirm={setConfirm} menu={menuBtn} />}
        {s?.page === 'todos' && ws && <TodoPage ws={ws} s={s} menu={menuBtn} />}
        {s?.page === 'home' && ws && <HomePage ws={ws} s={s} menu={menuBtn} />}
        {s?.page === 'me' && ws && <MePage ws={ws} s={s} menu={menuBtn} />}
        {s?.page === 'graph' && ws && <GraphPage ws={ws} s={s} menu={menuBtn} />}

        {/* 휴지통은 위에 덮는다 — 캔버스를 display:none으로 숨기면 ResizeObserver가 높이 0을 측정해 레이아웃이 깨진다 */}
        <div className="note-page" aria-hidden={(s && s.page !== 'note') || undefined} inert={(s && s.page !== 'note') || undefined}>
          <header className="topbar">
            {menuBtn}
            <button className={`doc-icon${s?.look.icon ? ' set' : ''}`} title="아이콘 · 커버" aria-label="노트 아이콘 · 커버 고르기" aria-haspopup="dialog" aria-expanded={!!picker}
              disabled={!current || noWrite || s?.readMode}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPicker(picker ? null : { x: r.left - 4, y: r.bottom + 6 }); }}>
              <NoteGlyph icon={s?.look.icon} size={20} />
            </button>
            {ws && s && current && <Breadcrumb ws={ws} s={s} note={current} />}
            <input
              className="title-input"
              value={s?.title ?? ''}
              placeholder={current?.preview || '제목 없음'}
              disabled={!current || noWrite}
              onChange={(e) => ws?.setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') view?.root.focus(); }}
            />
            {ws && current && s && <TagBar ws={ws} note={current} tags={s.tags} />}
            {!!s?.todos.total && (
              <span className={`todo-count${s.todos.done === s.todos.total ? ' all' : ''}`} title="이 노트의 할 일 (완료 / 전체)">
                <Icon name="checkSquare" size={14} />{s.todos.done}/{s.todos.total}
              </span>
            )}
            {current && (
              <button className={`fav-btn${current.favoriteAt ? ' on' : ''}`} title={current.favoriteAt ? '즐겨찾기에서 빼기' : '즐겨찾기에 넣기'}
                aria-label={current.favoriteAt ? '즐겨찾기에서 빼기' : '즐겨찾기에 넣기'} aria-pressed={!!current.favoriteAt} onClick={() => void ws?.toggleFavorite(current.id)}>
                <Icon name="star" size={16} />
              </button>
            )}
            {current && (
              <button className={`panel-btn${s?.panel ? ' on' : ''}`} title="노트 정보 · 백링크" aria-label="노트 정보 · 백링크" aria-pressed={!!s?.panel}
                onClick={() => ws?.togglePanel()}>
                <Icon name="panel" size={16} />{backlinks > 0 && <span className="count">{backlinks}</span>}
              </button>
            )}
            <div className="view-toggle" role="group" aria-label="보기">
              <button className={s?.viewMode !== 'doc' ? 'on' : ''} aria-pressed={s?.viewMode !== 'doc'} onClick={() => ws?.setViewMode('canvas')} title="자유 배치 캔버스">캔버스</button>
              <button className={s?.viewMode === 'doc' ? 'on' : ''} aria-pressed={s?.viewMode === 'doc'} onClick={() => ws?.setViewMode('doc')} title="위에서 아래로 읽는 문서 (인쇄 기준)">문서</button>
            </div>
            {/* 발표 · 인쇄 · 내보내기 · 버전 기록은 ⋯ 안 (DS-009) */}
            {current && ws && <TopMore ws={ws} fav={!!current.favoriteAt} />}
            {!!s?.tabPeers && s.tabRole !== 'readonly' && (
              <span className="tab-sync" title={s.tabRole === 'guest' ? '다른 탭과 함께 고치는 중 — 저장은 처음 연 탭이 해요' : `같은 노트를 연 다른 탭 ${s.tabPeers}개와 실시간으로 맞추는 중`}>
                {s.tabRole === 'guest' ? '함께 편집 중' : `탭 ${s.tabPeers}개와 동기화`}
              </span>
            )}
            <span className={`save-status ${s?.status ?? ''}`}>{s ? (s.tabRole === 'guest' ? '다른 탭이 저장' : STATUS_LABEL[s.status]) : ''}</span>
          </header>

          {s?.look.cover && ws && s.currentId && <CoverBanner key={s.currentId} ws={ws} cover={s.look.cover} readOnly={noWrite || s.readMode} />}
          <div className={`note-body${s?.look.page?.fullWidth ? ' full-width' : ''}${s?.look.page?.smallText ? ' small-text' : ''}`}>
          <div className="canvas-wrap" style={s?.side && s.side.noteId !== s.currentId ? { flex: `${s.side.ratio} 1 0` } : undefined}>
            <div ref={canvasRef} className="canvas-host" />
            {ws && s?.unlockFor && s.unlockFor === s.currentId && <NoteUnlock ws={ws} title={s.title} />}
            <div className="doc-host" hidden={s?.viewMode !== 'doc'}>
              {/* 워드처럼 고치기: 서식 막대 (보기 전용 · 읽기 모드에서는 없음) */}
              {ws && s?.viewMode === 'doc' && !s.readMode && !noWrite && !s.look.page?.editLock && <DocRibbon ws={ws} ui={s.docUi} pages={s.docPages && !s.look.page?.fullWidth} />}
              <div ref={docRef} className="doc-scroll" />
              {ws && s?.viewMode === 'doc' && <DocStatus ws={ws} engine={view?.engine ?? null} host={docRef} zoom={s.docZoom} now={s.docZoomNow} pages={s.docPages && !s.look.page?.fullWidth} />}
            </div>
            {ws && s?.currentId && s.page === 'note' && <DbRowBar ws={ws} noteId={s.currentId} rev={s.notes} />}
            {s?.error && <div className="banner" onClick={() => setS({ ...s, error: null })}>{s.error}</div>}
            {s?.chip && view && !s.aiRun && <AiChip ws={ws!} view={view} blockId={s.chip} />}
            {s?.aiRun && view && <AiProgress ws={ws!} view={view} run={s.aiRun} />}
            {s?.reload && (
              <div className="reload-banner" role="alert">
                <span>{s.reload.text}</span>
                <button className="btn primary sm" onClick={() => ws?.reloadApp()}>다시 열기</button>
                {s.reload.later && <button className="btn sm" onClick={() => ws?.dismissReload()}>나중에</button>}
              </div>
            )}
            {s?.installHint && ws && <InstallHint ws={ws} />}
            {s?.recording && ws && <RecordBar ws={ws} rec={s.recording} here={s.recording.noteId === s.currentId} />}
            {s?.stt && !s.recording && ws && <SttBar ws={ws} st={s.stt} />}
            {s && !s.currentId && !s.booting && (
              <div className="empty">
                <strong>아직 노트가 없어요</strong>
                <span>새 노트를 만들어 바로 시작해 보세요.</span>
                <button className="btn primary" onClick={() => ws && void ws.newNote(ws.newNotePlace())}>새 노트</button>
              </div>
            )}

            {s?.look.page?.editLock && !s.readMode && ws && (
              <button className="read-pill" onClick={() => ws.setNotePage({ editLock: false })} title="편집 잠금 풀기">편집 잠금 · 풀기</button>
            )}
            {s?.readMode && <button className="read-pill" onClick={() => ws?.setReadMode(false)}>읽기 모드 · 나가기 <kbd>Esc</kbd></button>}
            {ui && view && s?.viewMode !== 'doc' && !s.readMode && (isInkTool(ui.tool) || (ui.tool === 'both' && ui.ink.selected > 0)) && <InkBar view={view} ui={ui} settings={inkSettings} onSettings={setInkSettings} onOcr={() => void ws?.ocr.start()} onStructure={() => void ws?.ocr.start(false, 'structure')} onToast={(t) => ws?.toast(t, { label: '실행 취소', run: () => ws.view?.undo() })} />}
            {ui && ws && view && s?.viewMode !== 'doc' && !s.readMode && <Toolbar ws={ws} s={s} view={view} ui={ui} onInkSettings={() => setInkSettings(true)} />}
            {view && s && s.viewMode !== 'doc' && !s.readMode && <CardFixPill view={view} />}

            {ui && s?.viewMode !== 'doc' && (
              <div className="zoom" onMouseDown={(e) => e.preventDefault()} /* 초점은 캔버스에 — 단추를 눌러도 단축키가 듣게 (CQ-012) */>
                {/* A4로 고정 (11/03): 90도 돌려 세로 ↔ 가로 — 예전 끝없는 캔버스 노트는 A4로 (쪽에 맞춰 겹치지 않게) */}
                <button className={`sheet-btn${s.look.sheet ? ' on' : ''}`} aria-pressed={!!s.look.sheet?.landscape}
                  title={!s.look.sheet ? 'A4로 — 쪽에 맞춰 겹치지 않게 다시 놓아요 (Ctrl+Z로 되돌리기)' : s.look.sheet.landscape ? '90도 돌려 A4 세로로' : '90도 돌려 A4 가로로 (넘치는 내용은 다음 쪽으로)'}
                  onClick={() => ws?.setNoteSheet({ size: 'a4', ...(s.look.sheet && !s.look.sheet.landscape ? { landscape: true } : {}) })}>
                  <Icon name="rotate" size={14} />{!s.look.sheet ? 'A4로' : s.look.sheet.landscape ? 'A4 가로' : 'A4 세로'}</button>
                <button aria-label="축소" onClick={() => view?.zoomStep(-1)}><Icon name="minus" size={14} /></button>
                <button className="pct" title="100%로 (Shift+0)" onClick={() => view?.zoomTo(1)}>{Math.round(ui.zoom * 100)}%</button>
                <button aria-label="확대" onClick={() => view?.zoomStep(1)}><Icon name="plus" size={14} /></button>
                <button aria-label="전체 맞춤" title="전체 맞춤 (Shift+1)" onClick={() => view?.fit(true)}><Icon name="fit" size={14} /></button>
              </div>
            )}
          </div>
          {s?.side && ws && s.side.noteId !== s.currentId && <SidePane ws={ws} s={s} side={s.side} />}
          {s?.panel && ws && current && <NotePanel ws={ws} s={s} note={current} />}
          </div>
        </div>
      </main>

      {s?.toast && (
        <div className="toast" role="status" key={s.toast.id}>
          <span>{s.toast.text}</span>
          {s.toast.action && (
            <button onClick={() => { s.toast!.action!.run(); ws?.dismissToast(); }}>{s.toast.action.label}</button>
          )}
          {s.toast.alt && (
            <button className="toast-alt" onClick={() => { s.toast!.alt!.run(); ws?.dismissToast(); }}>{s.toast.alt.label}</button>
          )}
        </div>
      )}
      {s?.blockMenu && view && s.currentId && (
        <BlockMenu req={s.blockMenu} view={view} noteId={s.currentId} onClose={closeMenu} onToast={(t) => ws?.toast(t)} onSnippet={(ids) => ws?.saveSnippet(ids)}
          onStructure={(id) => void ws?.structure(id)} onTidy={(ids) => ws?.tidy(ids)} onRestructure={(ids) => void ws?.restructure(ids)} onMove={(ids) => ws?.openMoveTo(ids)} onTranscribe={(id, lang) => ws?.transcribe(id, lang)} docEditor={() => ws?.docView?.word.editor?.ed ?? null} />
      )}
      {s?.arrowMenu && view && <ArrowMenu req={s.arrowMenu} view={view} onClose={closeArrowMenu} />}
      {s?.comments && ws && s.currentId && <CommentThread ws={ws} req={s.comments} rev={s.ui} />}
      {picker && ws && s?.currentId && <IconPicker ws={ws} icon={s.look.icon} hasCover={!!s.look.cover} at={picker} onClose={closePicker} />}
      {s?.login && ws && <LoginDialog ws={ws} login={s.login} />}
      {s?.ocr && ws && <OcrDialog ws={ws} ocr={s.ocr} />}
      {s?.aiEdit && ws && <AiEditPanel ws={ws} st={s.aiEdit} />}
      {s?.qa && ws && <QaPanel ws={ws} s={s} qa={s.qa} />}
      {s?.insertMenu && view && s.currentId && s.viewMode !== 'doc' && <InsertMenu req={s.insertMenu} view={view} onClose={closeInsert} pins={s.toolbarPins} onPin={(k) => ws?.togglePin(k)}
        snippets={s.snippets} onSnippet={(id, at) => ws?.useSnippet(id, at)} onRenameSnippet={(id, n) => ws?.renameSnippet(id, n)} onRemoveSnippet={(id) => ws?.removeSnippet(id)} />}
      {s?.noteMenu && view && ws && s.currentId && s.viewMode !== 'doc' && <NoteMenu key={`${s.noteMenu.x},${s.noteMenu.y}`} ws={ws} view={view} req={s.noteMenu} />}
      {s?.dialog?.kind === 'chart' && ws && <ChartEditor key={s.dialog.contentId} ws={ws} blockId={s.dialog.blockId} contentId={s.dialog.contentId} tab={s.dialog.tab} />}
      {s?.dialog?.kind === 'consent' && ws && <ConsentDialog ws={ws} old={s.ai.consentOld} />}
      {s?.dialog?.kind === 'templates' && ws && <TemplateGallery ws={ws} s={s} />}
      {s?.dialog?.kind === 'import' && ws && <ImportDialog ws={ws} s={s} />}
      {s?.dialog?.kind === 'help' && ws && <ShortcutHelp ws={ws} />}
      {s?.dialog?.kind === 'snippet' && ws && <SnippetName key={s.dialog.save?.join() ?? s.dialog.use} ws={ws} d={s.dialog} />}
      {s?.dialog?.kind === 'versions' && ws && s.currentId && <VersionsDialog ws={ws} noteId={s.currentId} />}
      {s?.dialog?.kind === 'export' && ws && s.currentId && <ExportDialog ws={ws} s={s} />}
      {s?.dialog?.kind === 'settings' && ws && <SettingsDialog ws={ws} s={s} reason={s.dialog.reason} confirm={setConfirm} />}
      {s?.overlay === 'command' && ws && <CommandPalette ws={ws} s={s} />}
      {s?.moveBlocks && ws && <MoveToDialog ws={ws} s={s} ids={s.moveBlocks} />}
      {s?.overlay === 'replace' && ws && <ReplaceOverlay ws={ws} s={s} />}
      {(s?.overlay === 'search' || s?.overlay === 'switch') && ws && <SearchOverlay ws={ws} s={s} mode={s.overlay} />}
      {confirm && <ConfirmDialog req={confirm} onClose={() => setConfirm(null)} />}
    </div>
    {/* 앱 잠금 화면은 inert인 앱 바깥에 */}
    {s?.appLocked && ws && <LockScreen ws={ws} />}
    </>
  );
}
