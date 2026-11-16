// 홈 = 서재 (11/10): 모든 노트를 도서관 서가처럼 책으로 세워 보여 준다 — 맨 위 '최근에 펼친 책' 전시대(크게, 한 줄),
// 그 아래 서가: 즐겨찾기 · 폴더마다(폴더 색 = 책 색 — 이름표 앞 색 칸에서 바꾸기) · 폴더 밖. 서가 끝 점선 '빈 책'은 그 폴더에 새 노트.
// 책 차례는 노트 정렬(최근 수정 · 이름 · 생성 — 사이드바 폴더와 같은 설정). 오늘 할 일 · 달력 · 저장 같은 작은 것은 내 페이지(MePage.tsx).
import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import type { Folder, NoteMeta } from '@dn/storage-idb';
import { Book } from './Book';
import { zoomOpen } from './book-zoom';
import { bookColorOf, folderColor, type BookColor } from './book-colors';
import { BookPalette } from './BookPalette';
import { Icon } from './Icon';
import { pickImportFiles } from './ImportDialog';
import { LegalLinks } from './LegalDialog';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { useEscape } from './hooks';
import { folderNames } from './tree';
import { SORT_LABEL, type NoteSort, type Workspace, type WorkspaceState } from './workspace';

/** 전시대에 세우는 최근 책 수 (화면이 좁으면 한 줄에 드는 만큼만 보인다) */
const RECENT_MAX = 8;

interface Shelf { key: string; name: string; notes: NoteMeta[]; folder?: Folder; color?: BookColor }

/** menu: 좁은 화면에서 사이드바 서랍을 여는 단추 (MenuBtn) */
export function HomePage({ ws, s, menu }: { ws: Workspace; s: WorkspaceState; menu?: ReactNode }) {
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; items: RowMenuItem[] } | null>(null);
  const [palette, setPalette] = useState<string | null>(null);
  /** 책 우클릭 › 표지 색: 그 책 자리에 뜨는 색 판 */
  const [bookPal, setBookPal] = useState<{ id: string; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setRowMenu(null), []);
  useEscape(() => { setPalette(null); setBookPal(null); }, !!palette || !!bookPal);
  const folders = useMemo(() => new Map(s.folders.map((f) => [f.id, f])), [s.folders]);
  const books = useMemo(() => s.notes.filter((n) => !n.dbRef), [s.notes]); // 데이터베이스 행 페이지는 서재에 꽂지 않는다
  const pathOf = useCallback((f: Folder) => folderNames(f, folders).join(' / '), [folders]);
  const folderName = (n: NoteMeta) => { const f = n.folderId ? folders.get(n.folderId) : undefined; return f?.name; };
  const colorOf = (n: NoteMeta) => bookColorOf(n, folders);

  const recent = useMemo(() => {
    const byId = new Map(books.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const list: NoteMeta[] = [];
    for (const n of [...s.recent.map((id) => byId.get(id)), ...[...books].sort((a, b) => b.updatedAt - a.updatedAt)]) {
      if (n && !seen.has(n.id)) { seen.add(n.id); list.push(n); }
      if (list.length >= RECENT_MAX) break;
    }
    return list;
  }, [s.recent, books]);

  const shelves = useMemo(() => {
    const out: Shelf[] = [];
    const fav = ws.favorites.filter((n) => !n.dbRef);
    if (fav.length) out.push({ key: 'fav', name: '즐겨찾기', notes: fav });
    const inFolder = new Map<string, NoteMeta[]>();
    const loose: NoteMeta[] = [];
    for (const n of books) {
      if (n.folderId && folders.has(n.folderId)) inFolder.set(n.folderId, [...(inFolder.get(n.folderId) ?? []), n]);
      else loose.push(n);
    }
    for (const f of [...s.folders].sort((a, b) => pathOf(a).localeCompare(pathOf(b), 'ko'))) {
      out.push({ key: f.id, name: pathOf(f), notes: inFolder.get(f.id) ?? [], folder: f, color: folderColor(f) });
    }
    if (loose.length || !s.folders.length) out.push({ key: 'loose', name: s.folders.length ? '폴더 밖' : '모든 노트', notes: loose });
    return out;
  }, [ws.favorites, books, folders, s.folders, pathOf]);

  const open = (id: string, el?: HTMLElement) => { if (el) zoomOpen(el, () => void ws.openById(id)); else void ws.openById(id); };
  const bookMenu = (e: MouseEvent, n: NoteMeta) => {
    e.preventDefault();
    setRowMenu({ x: e.clientX, y: e.clientY, items: [
      { label: '열기', icon: 'goto', run: () => open(n.id) },
      { label: '옆에 열기', icon: 'panel', run: () => void ws.openSide(n.id) },
      { label: n.favoriteAt ? '즐겨찾기에서 빼기' : '즐겨찾기에 넣기', icon: 'star', run: () => void ws.toggleFavorite(n.id) },
      { label: '표지 색 바꾸기', icon: 'brush', run: () => setBookPal({ id: n.id, x: Math.min(e.clientX, innerWidth - 168), y: Math.min(e.clientY, innerHeight - 120) }) },
      { label: '휴지통으로', icon: 'trash', danger: true, run: () => void ws.trash(n.id) },
    ] });
  };
  const newBook = (folderId?: string) => void ws.newNote(ws.newNotePlace(folderId ? { folderId } : {}));

  return (
    <div className="trash-page home-page library">
      <div className="home-scroll">
        <header className="home-head">
          <div>
            <h1>{menu}서재</h1>
            <p>노트 {books.length.toLocaleString()}권{s.folders.length ? ` · 폴더 ${s.folders.length}개` : ''}</p>
          </div>
          <div className="home-actions">
            <select className="lib-sort" aria-label="책 차례" value={s.sort} onChange={(e) => ws.setSort(e.target.value as NoteSort)}>
              {(Object.keys(SORT_LABEL) as NoteSort[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
            <button className="text-btn" onClick={() => pickImportFiles(ws)}>가져오기</button>
            <button className="text-btn" onClick={() => ws.openTemplates()}>템플릿</button>
            <button className="btn primary" onClick={() => newBook()}><Icon name="plus" size={14} />새 노트</button>
          </div>
        </header>

        {recent.length > 0 && (
          <section className="lib-section" aria-label="최근에 펼친 책">
            <h2 className="lib-sign">최근에 펼친 책</h2>
            <ul className="lib-shelf lib-display">
              {recent.map((n) => <li key={n.id}><Book n={n} color={colorOf(n)} foot={folderName(n)} big onOpen={open} onMenu={bookMenu} /></li>)}
            </ul>
          </section>
        )}

        {shelves.map((sh) => (
          <section key={sh.key} className="lib-section" aria-label={`${sh.name} 서가`}>
            <h2 className="lib-sign">
              {sh.folder && sh.color && (
                <button className="lib-swatch" style={{ background: sh.color.bg }} title="책 색 바꾸기" aria-label={`${sh.name} 책 색 바꾸기`} aria-expanded={palette === sh.key}
                  onClick={() => setPalette(palette === sh.key ? null : sh.key)} />
              )}
              <span>{sh.name}</span><small>{sh.notes.length}권</small>
              {palette === sh.key && sh.folder && (
                <>
                  <button className="lib-backdrop" aria-label="색 판 닫기" tabIndex={-1} onClick={() => setPalette(null)} />
                  <BookPalette value={sh.folder.color} autoLabel="기본 색" onPick={(k) => { setPalette(null); void ws.setFolderColor(sh.folder!.id, k); }} />
                </>
              )}
            </h2>
            <ul className="lib-shelf">
              {sh.notes.map((n) => <li key={n.id}><Book n={n} color={colorOf(n)} foot={sh.folder ? undefined : folderName(n)} onOpen={open} onMenu={bookMenu} /></li>)}
              {sh.key !== 'fav' && (
                <li><button className="book-new" onClick={() => newBook(sh.folder?.id)} aria-label={sh.folder ? `${sh.name}에 새 노트` : '새 노트'}>
                  <Icon name="plus" size={20} /><span>새 노트</span>
                </button></li>
              )}
            </ul>
          </section>
        ))}
        {!books.length && <p className="lib-empty">첫 노트를 만들면 여기에 책으로 꽂혀요.</p>}

        {/* 약관 · 처리방침 · AI 안내 (LEGAL-RISK R1 · DEPLOY-PLAN 6.5 "첫 화면 아래") */}
        <footer className="home-legal"><LegalLinks /></footer>
      </div>
      {rowMenu && <RowMenu x={rowMenu.x} y={rowMenu.y} items={rowMenu.items} onClose={closeMenu} />}
      {bookPal && (
        <>
          <button className="lib-backdrop" aria-label="색 판 닫기" tabIndex={-1} onClick={() => setBookPal(null)} />
          <BookPalette value={books.find((n) => n.id === bookPal.id)?.bookColor} autoLabel="폴더 색 따르기" style={{ position: 'fixed', left: bookPal.x, top: bookPal.y }}
            onPick={(k) => { const id = bookPal.id; setBookPal(null); void ws.setNoteColor(id, k); }} />
        </>
      )}
    </div>
  );
}

