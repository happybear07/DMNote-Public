// 문서 뷰 블록 넣기 (doc-word.ts): 슬래시 메뉴 · 서식 막대 · 붙여넣은 주소로 지금 상자 바로 아래에 블록을 넣는다(문서 순서대로, 아래 상자는 내림).
// 슬래시 메뉴의 블록 동작(색 · 복제 · 삭제 · 링크 복사 · 댓글)도 여기서.
import { createWebBlock, deleteDocBlocks, isBlankDoc, joinBelow, makeRoomBelow, webBlockSize, type Id, type WebView } from '@dn/engine-core';
import type { DocWord } from './doc-word';
import { copyBlockLink, slashBlockStyle } from './slash-block';
import { pickTableSize, sizedTable, tableBlockSize, type TableSize } from './table-picker';
import { focusWebInput } from './insert';

/** 넣을 블록 높이 (아래 상자를 그만큼 내린다) */
const ROOM: Record<string, number> = { 'columns-2': 100, 'columns-3': 100, 'columns-4': 100, 'columns-5': 100, image: 200, video: 240, audio: 80, file: 72, record: 112, chart: 280, database: 220, 'db-board': 320, 'db-calendar': 420, 'db-gallery': 300, 'db-list': 220, toc: 160, bookmark: 104, 'web-embed': 300 };

/** 표 · 사진 · 그래프 · 파일 · 녹음 · 목차 · 데이터베이스를 지금 상자 바로 아래에 */
export function insertBelow(w: DocWord, kind: string, size?: TableSize): void {
  const cur = w.editor, e = w.engine, b = cur && e.getBlock(cur.blockId);
  if (!cur || !b) return;
  if (kind.includes(':')) { blockAction(w, cur.blockId, kind); return; }
  if (kind === 'table' && !size) { pickTableSize((s) => w.insert('table', s)); return; }
  if (kind !== 'table') {
    // 빈 줄 없애기 · 자리 만들기 · 넣기 · 빈 문단 지우기를 한 트랜잭션으로 — 실행 취소 한 번에 넣기 전으로 (DQ-025 · DQ-028)
    let made: string | null | void = undefined;
    const ok = e.transact(() => {
      const line = w.takeBlankLine();
      const r = makeRoomBelow(e, b.id, ROOM[kind] ?? 160, line.curH);
      if (!r.ok) return false;
      const at = { x: r.value.x, y: r.value.y };
      made = w.host?.insertBlock ? w.host.insertBlock(kind, at, b.w) : kind === 'image' ? w.host?.insertImage?.(at) : undefined;
      if (typeof made === 'string') joinBelow(e, b.id, [made]);
      // 고를 블록: 열 나누기 · 웹 블록(제 칸에 커서) · 그래프(데이터 창이 열림)는 빼고
      afterInsert(w, typeof made === 'string' && !kind.startsWith('columns-') && !['bookmark', 'web-embed', 'chart'].includes(kind) ? made : null, line.took);
      return true;
    }, { origin: 'user', label: '넣기' });
    if (!ok.ok || !ok.value) return;
    const id = made as string | null | void; // (트랜잭션 안에서 정해져 좁혀지지 않는다)
    // 열 나누기: 첫 칸에서 바로 쓴다
    const first = kind.startsWith('columns-') && typeof id === 'string' ? e.contentsOf(id)[0] : undefined;
    if (first) w.openNew(first.id, 'start');
    if (typeof id === 'string' && (kind === 'bookmark' || kind === 'web-embed')) focusWebInput(() => w.dv.items.get(id)?.el);
    return;
  }
  const table = sizedTable(size!), dim = tableBlockSize(size!);
  let took = false;
  const r = e.transact((tx) => {
    const line = w.takeBlankLine();
    took = line.took;
    const at = makeRoomBelow(e, b.id, dim.h, line.curH);
    if (!at.ok) return null;
    const blockId = tx.createBlock({ x: at.value.x, y: at.value.y, w: Math.max(dim.w, at.value.w), h: dim.h });
    joinBelow(e, b.id, [blockId]);
    return { blockId, contentId: tx.createContent({ blockId, type: 'table', ...table }) };
  }, { origin: 'user', label: '표 넣기' });
  const made = r.ok ? r.value : null;
  afterInsert(w, null, took);
  // 새 표: 첫 칸에서 바로 쓴다 (캔버스는 첫 열 이름부터) — 다음 그리기 뒤 (DQ-028)
  if (made) requestAnimationFrame(() => requestAnimationFrame(() => {
    const part = w.dv.page.querySelector<HTMLElement>(`[data-part="${made.contentId}"]`);
    if (part) w.dv.table.open(made.blockId, part, table.rows[0]!.id, table.columns[0]!.id);
  }));
}

/** 붙여넣은 주소 › 북마크 · 임베드 (FR-050): 이 상자 바로 아래에 (주소만 있던 상자는 비었으니 떠나면서 지운다) */
export function insertWeb(w: DocWord, url: string, v: WebView): void {
  const cur = w.editor, e = w.engine, b = cur && e.getBlock(cur.blockId);
  if (!cur || !b) return;
  const size = webBlockSize(url, v);
  e.transact(() => { // 한 번에 되돌리게 (DQ-025). 주소를 붙인 빈 줄은 없앤다 (DQ-028)
    const line = w.takeBlankLine();
    const r = makeRoomBelow(e, b.id, size.h, line.curH);
    const made = r.ok ? createWebBlock(e, { x: r.value.x, y: r.value.y }, url, v) : null;
    if (made?.ok) joinBelow(e, b.id, [made.value.blockId]);
    afterInsert(w, null, line.took);
  }, { origin: 'user', label: '웹 블록' });
}

/** 슬래시 메뉴의 블록 색 · 복제 · 삭제 (노션 /red · /duplicate · /delete) */
function blockAction(w: DocWord, blockId: Id, kind: string): void {
  if (slashBlockStyle(w.engine, blockId, kind)) { w.editor?.ed.focus(); w.emit(); return; }
  if (kind === 'action:delete') { w.close(); deleteDocBlocks(w.engine, [blockId]); return; }
  if (kind === 'action:duplicate') { w.close(); w.dv.select?.selectBlock(blockId); w.dv.select?.duplicate(); }
  if (kind === 'action:copy-link') { void copyBlockLink(w.engine, blockId).then((ok) => w.host?.onNotice?.(ok ? 'link-copied' : 'link-copy-failed')); w.editor?.ed.focus(); }
  if (kind === 'action:move') { w.close(); w.host?.onMoveBlocks?.([blockId]); }
  if (kind === 'action:select' || kind === 'action:select-block') { w.close(); w.dv.select?.selectBlock(blockId); } // 문서 뷰는 이 상자 고르기
  if (kind === 'action:comment') {
    const r = w.dv.items.get(blockId)?.el.getBoundingClientRect();
    w.close();
    w.host?.onComments?.({ blockId, x: r ? r.right + 12 : 40, y: r ? r.top : 40 });
  }
}

/** 빈 줄에서 넣었으면(노션처럼 /목차) 빈 줄은 남기지 않는다 — 빈 상자는 떠나면서 지우고, 글 있는 상자의 빈 줄은 이미 없앴다(took).
 *  글 끝에서 넣었으면 그 자리에서 계속 쓴다 */
function afterInsert(w: DocWord, made?: string | null, took = false): void {
  const cur = w.editor;
  if (!cur) return;
  if (!took && !isBlankDoc(cur.ed.doc)) { cur.ed.focus(); return; }
  w.close();
  // 빈 줄을 대신한 새 블록은 문서에서 고른 채로 — 초점이 뒤에 깔린 캔버스 · BODY로 빠지지 않게 (DQ-017)
  if (made) requestAnimationFrame(() => requestAnimationFrame(() => w.dv.select?.selectBlock(made)));
}
