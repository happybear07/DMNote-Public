// 사이드바 (11/09 개편): 열린 노트(탭처럼 — × 로 닫기) · 지금 노트의 블록 ▸ 콘텐츠(SideOutline) · 즐겨찾기 · 폴더(폴더와 그 안 노트, FR-073)
// · 태그(#해시태그, SideTags) · 검색 진입(FR-121). 전체 노트 목록은 두지 않는다 — 다른 노트는 홈 책장 · 검색 · 빠른 전환(Ctrl+P) · 폴더에서 연다.
import { useCallback, useMemo, useState, type DragEvent, type MouseEvent } from 'react';
import type { NoteMeta } from '@dn/storage-idb';
import { Icon } from './Icon';
import { NoteGlyph } from './NoteLook';
import { displayTitle, SORT_LABEL, type NoteSort, type Workspace, type WorkspaceState } from './workspace';
import type { ConfirmRequest } from './ConfirmDialog';
import { buildTree, type TreeNode } from './tree';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { BulkBar } from './BulkBar';
import { SideOutline } from './SideOutline';
import { SideTags } from './SideTags';
import { useEscape } from './hooks';

type Drag = { kind: 'note' | 'folder'; id: string };
const DND = 'application/x-dn-item';

/** onNavigate: 노트 · 블록을 골라 옮겨 갈 때 (좁은 화면 서랍을 닫는다 — 지금 열린 노트를 눌러도) */
export function Sidebar({ ws, s, confirm, onNavigate }: { ws: Workspace; s: WorkspaceState; confirm: (r: ConfirmRequest) => void; onNavigate?: () => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: RowMenuItem[] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  /** 여러 노트 고르기 (FR-079): Ctrl/⌘+클릭 하나씩, Shift+클릭 범위. anchor = 범위의 시작 */
  const [picked, setPicked] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const clearPick = useCallback(() => { setPicked([]); setAnchor(null); }, []);
  /** 노트 화면이 아닐 때(홈 · 휴지통 · 할 일)는 지금 노트를 강조하지 않는다 */
  const onTrash = s.page !== 'note';
  // 열린 노트: 지운 노트는 빠지고, 노트 화면이면 지금 노트는 늘 들어간다 (탭에 막 넣는 중이어도)
  const tabs = useMemo(() => {
    const byId = new Map(s.notes.map((n) => [n.id, n]));
    const ids = !onTrash && s.currentId && !s.openTabs.includes(s.currentId) ? [...s.openTabs, s.currentId] : s.openTabs;
    return ids.map((id) => byId.get(id)).filter((n): n is NoteMeta => !!n);
  }, [s.notes, s.openTabs, s.currentId, onTrash]);
  // 폴더 나무: 폴더와 그 안 노트만 (폴더 밖 노트는 열린 노트 · 홈 · 검색에서)
  const tree = useMemo(() => buildTree(s.notes, s.folders).filter((n) => n.kind === 'folder'), [s.notes, s.folders]);
  // 지금 보이는 노트 순서 (Shift 범위 선택용) — 열린 노트, 그다음 펼친 폴더 안
  const visible = useMemo(() => {
    const out = tabs.map((n) => n.id);
    const walk = (ns: TreeNode[]) => {
      for (const n of ns) {
        if (n.kind === 'note' && !out.includes(n.note.id)) out.push(n.note.id);
        if (n.kind === 'folder' && s.expanded[`f:${n.folder.id}`]) walk(n.children);
      }
    };
    walk(tree);
    return out;
  }, [tabs, tree, s.expanded]);
  const live = picked.filter((id) => s.notes.some((n) => n.id === id));
  useEscape(clearPick, live.length > 0);

  /** 노트 줄 클릭: 수식키 없으면 열기(선택 해제), Ctrl/⌘ 하나씩 넣고 빼기, Shift 범위 */
  const clickNote = (e: MouseEvent, id: string) => {
    if (e.ctrlKey || e.metaKey) {
      const base = live.length ? live : s.currentId && s.currentId !== id ? [s.currentId] : [];
      setPicked(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
      setAnchor(id);
      return;
    }
    if (e.shiftKey) {
      const from = visible.indexOf(anchor ?? s.currentId ?? id), to = visible.indexOf(id);
      if (from >= 0 && to >= 0) { setPicked(visible.slice(Math.min(from, to), Math.max(from, to) + 1)); return; }
    }
    clearPick();
    setAnchor(id);
    onNavigate?.(); // 좁은 화면 서랍: 지금 열린 노트를 눌러도 닫는다 (AT-007)
    void ws.openById(id);
  };

  const startDrag = (e: DragEvent, d: Drag) => {
    e.dataTransfer.setData(DND, JSON.stringify(d));
    e.dataTransfer.effectAllowed = 'move';
    setDrag(d);
  };
  const endDrag = () => { setDrag(null); setDropKey(null); };
  /** 놓을 수 있는 자리면 강조. key: 'root'(폴더 밖) · 'f:<id>' · 'n:<id>' · 't:<id>'(열린 노트 순서) */
  const over = (e: DragEvent, key: string) => {
    if (!drag || key.slice(2) === drag.id) return;
    if (drag.kind === 'folder' && (key.startsWith('n:') || key.startsWith('t:'))) return; // 폴더는 노트 아래 · 탭 사이로 못 간다
    if (key.startsWith('t:') && !tabs.some((n) => n.id === drag.id)) return; // 탭 순서는 탭끼리만
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dropKey !== key) setDropKey(key);
  };
  const drop = async (e: DragEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData(DND);
    endDrag();
    if (!raw) return;
    const d = JSON.parse(raw) as Drag;
    const target = key.slice(2);
    if (key.startsWith('t:')) { if (d.kind === 'note') ws.moveTab(d.id, target); return; }
    let ok = true;
    if (d.kind === 'note') {
      // 노트 위에 놓으면 그 노트가 든 폴더로 (노트 안에 노트는 두지 않는다)
      const tf = key.startsWith('n:') ? s.notes.find((n) => n.id === target)?.folderId : target;
      ok = key === 'root' ? await ws.moveNote(d.id, {}) : await ws.moveNote(d.id, tf ? { folderId: tf } : {});
    } else if (!key.startsWith('n:')) {
      ok = await ws.moveFolder(d.id, key === 'root' ? undefined : target);
    }
    if (!ok && key !== 'root' && d.kind === 'folder') ws.toast('폴더를 자기 자신이나 하위 폴더 안으로는 옮길 수 없어요.');
  };

  const askDeleteFolder = (id: string) => {
    const f = s.folders.find((x) => x.id === id);
    if (!f) return;
    const empty = !s.notes.some((n) => n.folderId === id) && !s.folders.some((x) => x.parentId === id);
    if (empty) { void ws.deleteFolder(id, 'lift'); return; }
    confirm({
      title: `'${f.name}' 폴더를 지울까요?`,
      body: '안에 있는 노트를 어떻게 할지 골라 주세요. 휴지통으로 옮긴 노트는 30일 안에 복원할 수 있어요.',
      confirmLabel: '노트도 휴지통으로',
      onConfirm: () => void ws.deleteFolder(id, 'trash'),
      alt: { label: '노트는 위로 옮기기', onConfirm: () => void ws.deleteFolder(id, 'lift') },
    });
  };

  const showMenu = (e: MouseEvent, items: RowMenuItem[]) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, items }); };
  /** '이 노트'의 블록 줄 우클릭: 이동 · 이름 바꾸기 · 묶음 풀기 (AT-004) */
  const blockMenu = (e: MouseEvent, gid: string) => showMenu(e, [
    { label: '이 블록으로 이동', icon: 'goto', run: () => { onNavigate?.(); ws.focusNoteBlock(gid); } },
    { label: '이름 바꾸기', icon: 'pencil', run: () => setRenaming(`b:${gid}`) },
    { label: '묶음 풀기 (상자는 그대로)', icon: 'columns', run: () => ws.ungroupNoteBlock(gid) },
  ]);

  /** 우클릭 메뉴 (FR-077 복제 포함). tab: 열린 노트 줄이면 맨 위에 '탭 닫기' */
  const openMenu = (e: MouseEvent, node: TreeNode, tab = false) => showMenu(e, node.kind === 'folder' ? [
    { label: '이 폴더에 새 노트', icon: 'plus', run: () => void ws.newNote(ws.newNotePlace({ folderId: node.folder.id })) },
    { label: '이름 바꾸기', icon: 'pencil', run: () => setRenaming(node.folder.id) },
    { label: node.folder.locked ? '폴더 잠금 풀기' : '폴더 잠그기', icon: 'eyeOff', run: () => void ws.toggleFolderLock(node.folder.id) },
    { label: '폴더 삭제', icon: 'trash', danger: true, run: () => askDeleteFolder(node.folder.id) },
  ] : [
    ...(tab ? [{ label: '탭 닫기', icon: 'close' as const, run: () => void ws.closeTab(node.note.id) }] : []),
    { label: node.note.favoriteAt ? '즐겨찾기에서 빼기' : '즐겨찾기에 넣기', icon: 'star', run: () => void ws.toggleFavorite(node.note.id) },
    { label: '옆에 열기', icon: 'panel', run: () => void ws.openSide(node.note.id) },
    { label: '복제', icon: 'copy', run: () => void ws.duplicateNote(node.note.id) },
    { label: 'Markdown으로 내보내기', icon: 'note', run: () => void ws.exportNote(node.note.id) },
    { label: '백업 파일(.json)로 내보내기', icon: 'copy', run: () => void ws.exportNoteBackup(node.note.id) },
    { label: '이름 바꾸기', icon: 'pencil', run: () => { void ws.openById(node.note.id); setRenaming(node.note.id); } },
    { label: node.note.locked ? '잠금 풀기' : '잠그기', icon: 'eyeOff', run: () => void ws.toggleNoteLock(node.note.id) },
    { label: '휴지통으로', icon: 'trash', danger: true, run: () => void ws.trash(node.note.id) },
  ]);

  const renameInput = (value: string, placeholder: string, commit: (v: string) => void) => (
    <input className="note-rename" autoFocus defaultValue={value} placeholder={placeholder} aria-label="이름"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => { commit(e.target.value); setRenaming(null); }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setRenaming(null);
      }} />
  );
  const noteName = (n: NoteMeta) => renaming === n.id
    ? renameInput(n.title, n.preview || '제목 없음', (v) => { if (n.id === s.currentId) ws.setTitle(v); })
    : <span className={`note-title${n.title.trim() ? '' : ' auto'}`}>{displayTitle(n)}</span>;
  const dragProps = (key: string, d: Drag) => ({
    draggable: renaming !== d.id,
    onDragStart: (e: DragEvent) => startDrag(e, d), onDragEnd: endDrag,
    onDragOver: (e: DragEvent) => over(e, key), onDragLeave: () => { if (dropKey === key) setDropKey(null); },
    onDrop: (e: DragEvent) => void drop(e, key),
  });

  /** 열린 노트 한 줄 — × 는 탭 닫기 (노트는 그대로, 지우기는 우클릭 › 휴지통으로) */
  const tabRow = (n: NoteMeta) => {
    const key = `t:${n.id}`, active = n.id === s.currentId && !onTrash;
    return (
      <div key={n.id} className={`note-item tab-item${active ? ' active' : ''}${dropKey === key ? ' drop-before' : ''}${live.includes(n.id) ? ' picked' : ''}`} data-key={key}
        aria-current={active ? 'page' : undefined} aria-selected={live.length > 0 ? live.includes(n.id) : undefined}
        {...dragProps(key, { kind: 'note', id: n.id })}
        onClick={(e) => clickNote(e, n.id)} onDoubleClick={() => { void ws.openById(n.id); setRenaming(n.id); }}
        onContextMenu={(e) => openMenu(e, { kind: 'note', note: n, children: [] }, true)}>
        <span className="note-icon"><NoteGlyph icon={n.icon} /></span>
        {n.locked && <span className="lock-mark" title="잠김" aria-label="잠김"><Icon name="eyeOff" size={12} /></span>}
        {noteName(n)}
        <span className="row-actions">
          <button className="tab-close" title="탭 닫기 (노트는 그대로)" aria-label={`${displayTitle(n)} 탭 닫기`}
            onClick={(e) => { e.stopPropagation(); void ws.closeTab(n.id); }}><Icon name="close" size={14} /></button>
        </span>
      </div>
    );
  };

  /** 폴더 나무 한 줄 (폴더 · 폴더 안 노트) */
  const row = (node: TreeNode, depth: number): React.ReactNode => {
    const isFolder = node.kind === 'folder';
    const id = isFolder ? node.folder.id : node.note.id;
    const key = `${isFolder ? 'f' : 'n'}:${id}`;
    const open = !!s.expanded[key];
    const hasKids = node.children.length > 0;
    const active = !isFolder && id === s.currentId && !onTrash;
    return (
      <div key={key} role="treeitem" aria-expanded={isFolder ? open : undefined}>
        <div className={`note-item${active ? ' active' : ''}${dropKey === key ? ' drop' : ''}${isFolder ? ' folder' : ''}${!isFolder && live.includes(id) ? ' picked' : ''}`} data-key={key}
          aria-selected={!isFolder && live.length > 0 ? live.includes(id) : undefined}
          style={{ paddingLeft: 6 + depth * 14 }}
          {...dragProps(key, { kind: node.kind, id })}
          onClick={(e) => (isFolder ? ws.setExpanded(key, !open) : clickNote(e, id))}
          onDoubleClick={() => { if (!isFolder) void ws.openById(id); setRenaming(id); }}
          onContextMenu={(e) => openMenu(e, node)}>
          <span className={`caret${isFolder ? '' : ' none'}${open ? ' open' : ''}`}
            onClick={(e) => { e.stopPropagation(); ws.setExpanded(key, !open); }} aria-hidden />
          <span className="note-icon">{isFolder ? <Icon name={open ? 'folderOpen' : 'folder'} /> : <NoteGlyph icon={node.note.icon} />}</span>
          {(isFolder ? node.folder.locked : node.note.locked) && <span className="lock-mark" title="잠김" aria-label="잠김"><Icon name="eyeOff" size={12} /></span>}
          {isFolder ? (renaming === id ? renameInput(node.folder.name, '폴더 이름', (v) => void ws.renameFolder(id, v)) : <span className="note-title">{node.folder.name}</span>) : noteName(node.note)}
          {isFolder && (
            <span className="row-actions">
              <button title="이 폴더에 새 노트" aria-label="이 폴더에 새 노트" onClick={(e) => { e.stopPropagation(); void ws.newNote(ws.newNotePlace({ folderId: id })); }}><Icon name="plus" size={14} /></button>
              <button className="folder-del" title="폴더 삭제" aria-label="폴더 삭제" onClick={(e) => { e.stopPropagation(); askDeleteFolder(id); }}><Icon name="close" size={14} /></button>
            </span>
          )}
        </div>
        {open && hasKids && <div role="group">{node.children.map((c) => row(c, depth + 1))}</div>}
        {open && isFolder && !hasKids && <div className="tree-empty" style={{ paddingLeft: 34 + depth * 14 }}>비어 있어요</div>}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="ws-head"><span className="ws-name">DamianNote</span></div>
      <button className="side-search" onClick={() => ws.openOverlay('search')} title="모든 노트에서 검색 (Ctrl+Shift+F)">
        <span className="side-search-label"><Icon name="search" size={16} />검색</span><kbd>Ctrl+Shift+F</kbd>
      </button>
      <nav className="side-nav" aria-label="바로 가기">
        <div className={`note-item${s.page === 'home' ? ' active' : ''}`} onClick={() => ws.showHome()}>
          <span className="note-icon"><Icon name="home" /></span><span className="note-title">홈</span>
        </div>
        <div className={`note-item${s.page === 'me' ? ' active' : ''}`} onClick={() => { onNavigate?.(); ws.showMe(); }}>
          <span className="note-icon"><Icon name="user" /></span><span className="note-title">내 페이지</span>
        </div>
        <div className={`note-item${s.page === 'todos' ? ' active' : ''}`} onClick={() => ws.showTodos()}>
          <span className="note-icon"><Icon name="checkSquare" /></span><span className="note-title">할 일</span>
        </div>
        <div className={`note-item${s.page === 'graph' ? ' active' : ''}`} onClick={() => ws.showGraph()}>
          <span className="note-icon"><Icon name="link" /></span><span className="note-title">노트 그래프</span>
        </div>
      </nav>

      <div className="side-scroll">
        <div className="side-section"><span>열린 노트</span></div>
        <nav className="note-list open-tabs" aria-label="열린 노트">
          {tabs.map(tabRow)}
          <div className="note-item add" onClick={() => void ws.newNote(ws.newNotePlace())}><span className="note-icon"><Icon name="plus" /></span><span className="note-title">새 노트</span>
            <button className="tpl-btn" title="템플릿에서 새 노트" onClick={(e) => { e.stopPropagation(); ws.openTemplates(); }}>템플릿</button></div>
        </nav>

        <SideOutline ws={ws} s={s} onNavigate={onNavigate} renaming={renaming} setRenaming={setRenaming} renameInput={renameInput} blockMenu={blockMenu} />

        {ws.favorites.length > 0 && (
          <>
            <div className="side-section"><span>즐겨찾기</span></div>
            <nav className="fav-list" aria-label="즐겨찾기">
              {ws.favorites.map((n) => (
                <div key={n.id} className={`note-item${n.id === s.currentId && !onTrash ? ' active' : ''}`} onClick={() => { onNavigate?.(); void ws.openById(n.id); }}
                  onContextMenu={(e) => openMenu(e, { kind: 'note', note: n, children: [] })}>
                  <span className="note-icon fav"><Icon name="star" /></span>
                  <span className={`note-title${n.title.trim() ? '' : ' auto'}`}>{displayTitle(n)}</span>
                </div>
              ))}
            </nav>
          </>
        )}

        <div className="side-section">
          <span>폴더</span>
          <span className="side-tools">
            <select className="sort-select" aria-label="노트 정렬" value={s.sort} onChange={(e) => ws.setSort(e.target.value as NoteSort)}>
              {(Object.keys(SORT_LABEL) as NoteSort[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
            <button className="icon-btn" title="새 폴더" aria-label="새 폴더"
              onClick={async () => { const id = await ws.createFolder('새 폴더'); setRenaming(id); }}><Icon name="folderPlus" size={16} /></button>
          </span>
        </div>
        <nav className={`folder-tree${dropKey === 'root' ? ' drop-root' : ''}`} aria-label="폴더"
          onDragOver={(e) => over(e, 'root')} onDrop={(e) => void drop(e, 'root')}
          onDragLeave={(e) => { if (dropKey === 'root' && !e.currentTarget.contains(e.relatedTarget as Node)) setDropKey(null); }}>
          <div role="tree" aria-label="폴더 목록">{tree.map((n) => row(n, 0))}</div>
        </nav>

        <SideTags ws={ws} s={s} confirm={confirm} onNavigate={onNavigate} renaming={renaming} setRenaming={setRenaming} renameInput={renameInput} openMenu={showMenu} />
      </div>

      <div className="side-foot">
        <div className={`note-item${s.page === 'trash' ? ' active' : ''}`} onClick={() => ws.showTrash()}>
          <span className="note-icon"><Icon name="trash" /></span><span className="note-title">휴지통</span>
          {!!s.trash.length && <span className="count">{s.trash.length}</span>}
        </div>
        <button className="note-item side-btn" onClick={() => ws.qa.open()} title="내 노트에 적힌 내용으로 답하고 출처를 보여 줘요 (AI)">
          <span className="note-icon"><Icon name="sparkle" /></span><span className="note-title">노트에 묻기</span>
        </button>
        <div className="note-item" onClick={() => ws.openSettings()}><span className="note-icon"><Icon name="settings" /></span><span className="note-title">설정</span></div>
        {/* 로그인은 선택 (FR-094) — 하면 여러 기기 동기화 */}
        <button className="note-item side-btn account-btn" onClick={() => (s.account ? ws.openSettings('account') : ws.auth.open())} title={s.account ? '계정 · 동기화' : '로그인하면 여러 기기에서 같은 노트를 쓸 수 있어요'}>
          <span className="note-icon"><Icon name="globe" /></span><span className="note-title">{s.account ? s.account.email : '로그인'}</span>
        </button>
      </div>
      {live.length > 1 && <BulkBar ws={ws} s={s} ids={live} onDone={clearPick} />}
      {menu && <RowMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </aside>
  );
}
