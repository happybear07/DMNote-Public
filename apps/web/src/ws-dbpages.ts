// 워크스페이스 데이터베이스 항목 페이지 층 (FR-063): 항목의 "열기" → 그 항목의 하위 노트(처음이면 만들고, 템플릿이 있으면 그 내용으로).
// 페이지 노트는 노트 메타에 어느 데이터베이스의 어느 항목인지(dbRef)를 갖고, 열면 위에 데이터베이스 이름 · 항목 속성을 보여 준다.
// 층 순서: … → ws-replace → 여기 → workspace.ts
import { dbCellTextIn, Engine, isDatabaseContent, newId, setDbRowPage, type Id } from '@dn/engine-core';
import { setDbHost } from '@dn/engine-dom';
import { readNote } from '@dn/storage-idb';
import { download } from './export';
import { pickFiles } from './pick-files';
import { BUILTIN_TEMPLATES, instantiate, userEntry, type TemplateEntry } from './templates';
import { ReplaceLayer } from './ws-replace';
import { displayTitle } from './ws-model';
import { MAX_FILE } from './ws-notes';

export interface DbRowInfo {
  parentId: Id;
  parentTitle: string;
  dbTitle: string;
  props: { name: string; text: string }[];
}

/** 새 탭으로 열어도 되는 첨부 형식 — 스크립트를 돌릴 수 없는 것만 */
const SAFE_OPEN = /^(image\/(png|jpeg|gif|webp|avif|bmp)|application\/pdf|audio\/|video\/|text\/plain($|;))/;

export abstract class DbPageLayer extends ReplaceLayer {
  /** 캔버스의 데이터베이스가 부르는 동작 — 부팅 때 한 번 */
  protected installDbHost(): void {
    setDbHost({
      openRow: (cid, rowId) => void this.openDbRow(cid, rowId),
      templates: () => this.templateEntries().map((t) => ({ id: t.id, name: t.name })),
      pickFiles: () => this.pickDbFiles(),
      // 새 탭은 누른 그 순간에 연다 — 주소를 기다린 뒤 열면 팝업 차단에 막힌다
      // 이미지 · PDF · 소리 · 영상 · 일반 글만 새 탭에 — HTML · SVG 같은 나머지는 내려받기 (같은 출처 blob 문서가 되지 않게, 보안 2-1)
      openFile: (f) => {
        const w = window.open('about:blank', '_blank');
        void this.fileBlob(f.hash).then(async (blob) => {
          if (!blob) { w?.close(); this.toast(`'${f.name}' 파일을 찾지 못했어요.`); return; }
          if (!SAFE_OPEN.test(blob.type)) { w?.close(); download(f.name, blob, 'application/octet-stream'); return; }
          const url = await this.fileUrl(f.hash);
          if (url && w) { w.opener = null; w.location.href = url; } else w?.close();
        });
      },
    });
  }

  /** 데이터베이스 파일 속성 (GAP #19): 파일을 골라 첨부 저장소에 — 해시 · 이름 */
  private async pickDbFiles(): Promise<{ hash: string; name: string }[]> {
    const out: { hash: string; name: string }[] = [];
    for (const f of (await pickFiles('', { multiple: true })) ?? []) {
      if (f.size > MAX_FILE) { this.toast(`${f.name}: 50MB가 넘는 파일은 첨부할 수 없어요.`); continue; }
      try { out.push({ hash: await this.files.put(f), name: f.name || '파일' }); } catch { this.toast(`${f.name}: 저장 공간이 부족해 첨부하지 못했어요.`); }
    }
    return out;
  }

  private templateEntries(): TemplateEntry[] {
    return [...BUILTIN_TEMPLATES, ...this.state.templates.map(userEntry)];
  }

  /** 항목 페이지 열기 — 없으면 만들고(데이터베이스가 있는 노트의 하위 노트, 제목 = 항목 이름) 연다 */
  async openDbRow(contentId: Id, rowId: Id): Promise<void> {
    const o = this.open;
    if (!o) return;
    const c = o.engine.getContent(contentId);
    if (!isDatabaseContent(c)) return;
    const row = c.rows.find((r) => r.id === rowId);
    if (!row) return;
    if (row.page && this.state.notes.some((n) => n.id === row.page)) { await this.openById(row.page); return; }
    if (o.session.readonly) { this.toast('읽기 전용으로 연 노트라 항목 페이지를 만들 수 없어요.'); return; }
    const name = String(row.values[c.properties[0]?.id ?? ''] ?? '').trim();
    const tpl = c.pageTemplate ? this.templateEntries().find((t) => t.id === c.pageTemplate) : undefined;
    let engine: Engine;
    try { engine = tpl ? instantiate(tpl) : new Engine({ note: { id: newId(), title: '', createdAt: Date.now(), updatedAt: Date.now() } }); }
    catch { this.toast('템플릿을 열지 못해 빈 페이지로 만들어요.'); engine = new Engine({ note: { id: newId(), title: '', createdAt: Date.now(), updatedAt: Date.now() } }); }
    if (name) engine.transact((tx) => tx.setNote({ title: name }), { origin: 'user', label: '제목' });
    const parentId = o.engine.note.id;
    const id = await this.addEngine(engine, { parentNoteId: parentId }, { dbRef: { noteId: parentId, contentId, rowId } });
    setDbRowPage(o.engine, contentId, rowId, id);
    this.setExpanded(`n:${parentId}`, true);
    await this.refreshList();
    await this.openById(id);
  }

  /** 이 노트가 항목 페이지면 데이터베이스 · 속성 (데이터베이스가 있는 노트를 읽어서). 아니면 null */
  async dbRowInfo(noteId: Id): Promise<DbRowInfo | null> {
    const m = this.state.notes.find((n) => n.id === noteId);
    const ref = m?.dbRef;
    if (!ref) return null;
    const parentMeta = this.state.notes.find((n) => n.id === ref.noteId);
    if (!parentMeta) return null;
    const parent = await readNote(this.store, ref.noteId).catch(() => null);
    const c = parent?.getContent(ref.contentId);
    if (!isDatabaseContent(c)) return null;
    const row = c.rows.find((r) => r.id === ref.rowId);
    if (!row) return null;
    return {
      parentId: ref.noteId,
      parentTitle: displayTitle(parentMeta),
      dbTitle: c.title || '데이터베이스',
      props: c.properties.slice(1).filter((p) => !p.hidden).map((p) => ({ name: p.name, text: dbCellTextIn(parent!, c, row, p) })),
    };
  }
}
