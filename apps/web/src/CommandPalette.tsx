// 명령 팔레트 (FR-087, Ctrl+Shift+P): 앱의 주요 기능을 이름 · 초성으로 찾아 실행한다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { filterSlash, type IconName } from '@dn/text-pm';
import { Icon } from './Icon';
import { pickImportFiles, pickSyncFile } from './ImportDialog';
import type { Workspace, WorkspaceState } from './workspace';

interface Command {
  id: string;
  label: string;
  icon: IconName;
  /** 단축키 표시 */
  key?: string;
  keywords: string[];
  /** 지금 노트가 열려 있어야 하는 명령 */
  note?: boolean;
  run(ws: Workspace): void | Promise<void>;
}

const COMMANDS: Command[] = [
  { id: 'new-note', label: '새 노트', icon: 'plus', key: 'Ctrl+Alt+N', keywords: ['new', 'note', '만들기'], run: (ws) => ws.newNote(ws.newNotePlace()) },
  { id: 'template', label: '템플릿에서 새 노트', icon: 'note', keywords: ['template', '회의록', '강의', '리서치', '주간', '양식'], run: (ws) => ws.openTemplates() },
  { id: 'save-template', label: '이 노트를 템플릿으로 저장', icon: 'bookmark', keywords: ['template', 'save', '양식'], note: true, run: (ws) => ws.openTemplates() },
  { id: 'new-folder', label: '새 폴더', icon: 'folderPlus', keywords: ['folder'], run: (ws) => void ws.createFolder('새 폴더') },
  { id: 'replace', label: '찾아 바꾸기', icon: 'pencil', key: 'Ctrl+H', keywords: ['replace', 'find', '바꾸기', '치환'], run: (ws) => ws.openOverlay('replace') },
  { id: 'switch', label: '노트로 이동', icon: 'goto', key: 'Ctrl+P', keywords: ['switch', 'open', '빠른 전환'], run: (ws) => ws.openOverlay('switch') },
  { id: 'search', label: '모든 노트에서 검색', icon: 'search', key: 'Ctrl+Shift+F', keywords: ['search', 'find', '찾기'], run: (ws) => ws.openOverlay('search') },
  { id: 'panel', label: '노트 정보 · 백링크 패널 열고 닫기', icon: 'panel', keywords: ['info', 'backlink', '정보', '링크'], note: true, run: (ws) => ws.togglePanel() },
  { id: 'duplicate', label: '이 노트 복제', icon: 'copy', keywords: ['duplicate', 'copy', '복제', '사본', '복사'], note: true, run: (ws) => { if (ws.state.currentId) void ws.duplicateNote(ws.state.currentId); } },
  { id: 'insert', label: '넣기 — 사진 · 표 · 그래프 · 수식 …', icon: 'plus', key: '/', keywords: ['insert', 'add', '추가', '넣기', '삽입', '사진', '표', '그래프'], note: true, run: (ws) => { const r = ws.view?.root.getBoundingClientRect(); if (r) ws.openInsertMenu({ x: r.left + r.width / 2 - 150, y: r.top + 80 }); } },
  { id: 'side', label: '노트를 옆에 열기 (빠른 전환에서 Shift+Enter)', icon: 'panel', keywords: ['split', 'side', '나란히', '옆', '분할', '스플릿'], note: true, run: (ws) => ws.openOverlay('switch') },
  { id: 'side-close', label: '옆에 연 노트 닫기', icon: 'panel', keywords: ['split', 'side', '닫기', '분할'], note: true, run: (ws) => ws.closeSide() },
  { id: 'record', label: '음성 녹음 시작 · 끝내기', icon: 'mic', keywords: ['record', 'audio', 'voice', 'mic', '녹음', '음성', '마이크'], note: true, run: (ws) => (ws.isRecording ? ws.stopRecording() : ws.startRecording()) },
  { id: 'structure', label: 'AI로 구조화하기 (선택한 상자)', icon: 'sparkle', key: 'Ctrl+Alt+S', keywords: ['ai', 'claude', 'structure', '정리'], note: true, run: (ws) => ws.structure(ws.view?.selectedBlocks[0]) },
  { id: 'tidy', label: '배치 다듬기 (고른 상자 · 없으면 캔버스 전체)', icon: 'fit', keywords: ['tidy', 'arrange', 'layout', 'align', '배치', '정렬', '정리', '다듬기', '간격', '줄 맞춤', '서브 구조화'], note: true, run: (ws) => ws.tidy() },
  { id: 'note-summary', label: 'AI로 노트 요약 (요약 · 결정 · 할 일을 맨 위에)', icon: 'sparkle', keywords: ['ai', 'summary', 'digest', 'tldr', '요약', '정리', '핵심', '결정', '할 일'], note: true, run: (ws) => ws.summarizeNote() },
  { id: 'note-translate', label: 'AI로 노트 번역 (새 노트로)', icon: 'sparkle', keywords: ['ai', 'translate', 'translation', 'english', '번역', '영어', '한국어', '일본어', '중국어'], note: true, run: (ws) => ws.translateNote() },
  { id: 'note-draft', label: 'AI로 초안 쓰기 (노트 맨 끝에)', icon: 'sparkle', keywords: ['ai', 'draft', 'write', 'generate', '초안', '글쓰기', '쓰기', '생성', '이어 쓰기'], note: true, run: (ws) => ws.draftNote() },
  { id: 'reindex', label: '검색 색인 다시 만들기', icon: 'search', keywords: ['index', 'reindex', 'search', '색인', '검색', '다시', '인덱스'], run: (ws) => void ws.rebuildIndex() },
  { id: 'restructure', label: 'AI로 다시 구조화 (고른 AI 상자만)', icon: 'sparkle', keywords: ['ai', 'again', 'retry', '다시', '재구조화', '재요청', '일부'], note: true, run: (ws) => void ws.restructure() },
  { id: 'sample', label: '샘플 글로 AI 구조화 체험', icon: 'sparkle', keywords: ['sample', 'demo', '예시', '체험'], note: true, run: (ws) => ws.trySample() },
  { id: 'export-md', label: '이 노트를 Markdown 파일로 내보내기', icon: 'note', keywords: ['export', 'markdown', 'md', '저장', '다운로드'], note: true, run: (ws) => { if (ws.state.currentId) void ws.exportNote(ws.state.currentId); } },
  { id: 'versions', label: '버전 기록 (지난 상태 보기 · 되돌리기)', icon: 'copy', keywords: ['version', 'history', 'restore', '버전', '기록', '되돌리기', '복원'], note: true, run: (ws) => ws.openVersions() },
  { id: 'sync-export', label: '동기화 파일 만들기 (다른 기기와 맞추기)', icon: 'copy', keywords: ['sync', '동기화', '기기', 'merge', '합치기'], run: (ws) => void ws.exportSyncFile() },
  { id: 'sync-import', label: '동기화 파일 가져오기 (다른 기기 내용 합치기)', icon: 'copy', keywords: ['sync', '동기화', '기기', 'import', '합치기'], run: (ws) => pickSyncFile(ws) },
  { id: 'export-backup', label: '이 노트를 백업 파일(.json)로 내보내기', icon: 'copy', keywords: ['backup', 'json', 'export', '백업', '저장', '다운로드'], note: true, run: (ws) => { if (ws.state.currentId) void ws.exportNoteBackup(ws.state.currentId); } },
  { id: 'export-png-paper', label: 'PNG로 내보내기 (배경 포함)', icon: 'eye', keywords: ['png', 'image', 'background', '배경', '괘선', '모눈'], note: true, run: (ws) => void ws.exportPng(false, true) },
  { id: 'export-png', label: 'PNG 이미지로 내보내기 (고른 상자 · 없으면 전체)', icon: 'eye', keywords: ['png', 'image', 'export', '이미지', '그림', '사진', '캡처', '공유'], note: true, run: (ws) => void ws.exportPng(true) },
  { id: 'export-png-all', label: '캔버스 전체를 PNG로', icon: 'eye', keywords: ['png', 'image', 'export', '이미지', '전체'], note: true, run: (ws) => void ws.exportPng(false) },
  { id: 'copy-md', label: '이 노트를 Markdown으로 복사', icon: 'copy', keywords: ['copy', 'markdown', 'md', '클립보드'], note: true, run: (ws) => { if (ws.state.currentId) void ws.copyMarkdown(ws.state.currentId); } },
  { id: 'export-all', label: '모든 노트 내보내기 (ZIP · 백업)', icon: 'folder', keywords: ['export', 'backup', 'zip', '백업', '저장', '다운로드'], run: (ws) => void ws.exportAll() },
  { id: 'import', label: '가져오기 (백업 · Markdown · 워드 · CSV 파일)', icon: 'folderOpen', keywords: ['import', 'restore', 'backup', 'markdown', 'obsidian', 'csv', 'docx', 'word', '워드', '엑셀', '복원', '옵시디언', '불러오기'], run: (ws) => pickImportFiles(ws) },
  { id: 'import-dir', label: '폴더 가져오기 (옵시디언 볼트)', icon: 'folderOpen', keywords: ['import', 'obsidian', 'vault', '폴더', '옵시디언'], run: (ws) => pickImportFiles(ws, true) },
  { id: 'doc-view', label: '문서 뷰로 보기 · 캔버스로 돌아가기', icon: 'note', keywords: ['document', 'doc', 'linear', '문서', '읽기', '캔버스'], note: true, run: (ws) => ws.setViewMode(ws.state.viewMode === 'doc' ? 'canvas' : 'doc') },
  { id: 'print', label: '인쇄 · PDF · 다른 파일로 저장', icon: 'note', keywords: ['print', 'pdf', 'html', 'export', '인쇄', '출력', '내보내기', '저장'], note: true, run: (ws) => ws.printNote() },
  { id: 'present', label: '발표 (장면별로 화면 가득)', icon: 'play', key: 'Ctrl+Alt+P', keywords: ['present', 'presentation', 'slide', 'slides', '발표', '슬라이드', '프레젠테이션'], note: true, run: (ws) => ws.present() },
  { id: 'read', label: '읽기 모드 켜기 · 끄기', icon: 'eye', key: 'Ctrl+Alt+Enter', keywords: ['read', 'focus', '읽기', '집중', '보기'], note: true, run: (ws) => ws.setReadMode(!ws.state.readMode) },
  { id: 'sidebar', label: '사이드바 접기 · 펼치기', icon: 'panel', key: 'Ctrl+\\', keywords: ['sidebar', '사이드바', '목록'], run: (ws) => ws.toggleSidebar() },
  { id: 'help', label: '단축키 도움말', icon: 'command', key: 'Ctrl+/', keywords: ['shortcut', 'help', 'keys', '단축키', '도움말'], run: (ws) => ws.openHelp() },
  { id: 'theme', label: '밝게 · 어둡게 바꾸기', icon: 'eye', keywords: ['theme', 'dark', 'light', '다크', '테마', '어둡게', '밝게', '야간'], run: (ws) => ws.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
  { id: 'fit', label: '전체 맞춤', icon: 'target', key: 'Shift+1', keywords: ['fit', 'zoom', '화면'], note: true, run: (ws) => ws.view?.fit(true) },
  { id: 'zoom100', label: '100%로 보기', icon: 'target', key: 'Shift+0', keywords: ['zoom', '확대', '배율'], note: true, run: (ws) => ws.view?.zoomTo(1) },
  { id: 'sheet-a4', label: '용지: A4 세로 (페이지 캔버스)', icon: 'note', keywords: ['a4', 'page', 'paper', 'sheet', '용지', '페이지', '종이', '인쇄'], note: true, run: (ws) => ws.setNoteSheet({ size: 'a4' }) },
  { id: 'sheet-a4l', label: '용지: A4 가로', icon: 'note', keywords: ['a4', 'landscape', '가로', '용지', '페이지'], note: true, run: (ws) => ws.setNoteSheet({ size: 'a4', landscape: true }) },
  { id: 'trash-note', label: '이 노트를 휴지통으로', icon: 'trash', keywords: ['delete', 'remove', '삭제', '지우기'], note: true, run: (ws) => { if (ws.state.currentId) void ws.trash(ws.state.currentId); } },
  { id: 'home', label: '홈 (서재)', icon: 'home', keywords: ['home', 'library', '서재', '책장', '처음'], run: (ws) => ws.showHome() },
  { id: 'me', label: '내 페이지', icon: 'user', keywords: ['me', 'dashboard', '대시보드', '할 일', '달력', '계정'], run: (ws) => ws.showMe() },
  { id: 'favorite', label: '이 노트 즐겨찾기 넣기 · 빼기', icon: 'star', keywords: ['favorite', 'star', 'pin', '고정', '별'], note: true, run: (ws) => { if (ws.state.currentId) void ws.toggleFavorite(ws.state.currentId); } },
  { id: 'todos', label: '할 일 모아보기', icon: 'checkSquare', keywords: ['todo', 'task', '할일', '오늘', '체크', '마감'], run: (ws) => ws.showTodos() },
  { id: 'trash', label: '휴지통 보기', icon: 'trash', keywords: ['trash', 'restore', '복원'], run: (ws) => ws.showTrash() },
  { id: 'ask', label: '노트에 질문하기 (AI)', icon: 'sparkle', keywords: ['ask', 'question', 'qa', '질문', '물어보기', '찾기', 'ai'], run: (ws) => ws.qa.open() },
  { id: 'login', label: '로그인 · 계정', icon: 'user', keywords: ['login', 'account', 'sync', '동기화', '계정'], run: (ws) => (ws.state.account ? ws.openSettings('account') : ws.auth.open()) },
  { id: 'settings', label: '설정', icon: 'settings', key: 'Ctrl+,', keywords: ['settings', 'api', 'key', '키', '글자 크기'], run: (ws) => ws.openSettings() },
];

export function CommandPalette({ ws, s }: { ws: Workspace; s: WorkspaceState }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const hasNote = !!s.currentId && s.page === 'note';
  const rows = useMemo(() => filterSlash(COMMANDS.filter((c) => !c.note || hasNote), q), [q, hasNote]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    ws.closeOverlay();
    void c.run(ws);
  };

  return (
    <div className="overlay-backdrop" onMouseDown={() => ws.closeOverlay()}>
      <div className="search-box" role="dialog" aria-modal="true" aria-label="명령 팔레트" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-head">
          <span className="search-icon"><Icon name="command" size={16} /></span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="명령 찾기 (예: 복제, ㅅㅈ)" aria-label="명령 찾기"
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, rows.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(rows[sel]); }
              else if (e.key === 'Escape') { e.preventDefault(); ws.closeOverlay(); }
            }} />
        </div>
        <div className="search-results" ref={listRef} role="listbox" aria-label="명령" tabIndex={0}>
          {rows.map((c, i) => (
            <div key={c.id} role="option" aria-selected={i === sel} className={`search-row cmd-row${i === sel ? ' on' : ''}`}
              onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); run(c); }}>
              <span className="search-name"><Icon name={c.icon} size={16} />{c.label}</span>
              {c.key && <kbd>{c.key}</kbd>}
            </div>
          ))}
          {!rows.length && <div className="search-empty"><strong>맞는 명령이 없어요</strong><span>다른 낱말로 찾아보세요.</span></div>}
        </div>
      </div>
    </div>
  );
}
