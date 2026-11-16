// 워크스페이스 정리 층: 폴더 · 하위 노트 (FR-073) · 태그 (FR-074) · 휴지통 (FR-076) · 검색 · 빠른 전환 (FR-121 · FR-087)
// · 복제 (FR-077) · 백링크 (FR-081).
import { deserialize, Engine, newId, noteAttachments, serialize } from '@dn/engine-core';
import { readNote, tagKey } from '@dn/storage-idb';
import type { Backlink, SearchHit } from '@dn/search';
import { toB64 } from '@dn/sync';
import { download, extOf, noteToMarkdown, notePathParts, safeName, type Backup } from './export';
import { makeZip, type ZipEntry } from './zip';
import { folderSubtree, isFolderWithin, isNoteWithin, notesInFolders } from './tree';
import { NotesLayer } from './ws-notes';
import { DAY, displayTitle, type NotePlace, type Overlay, type SearchFilter } from './ws-model';
import { effectiveRole } from './note-scope';

export abstract class OrganizeLayer extends NotesLayer {
  // ───────── 폴더 · 중첩 노트 (FR-073) ─────────

  async createFolder(name: string, parentId?: string): Promise<string> {
    const now = Date.now();
    const id = newId();
    await this.meta.putFolder({ id, name: name.trim() || '새 폴더', ...(parentId ? { parentId } : {}), createdAt: now, updatedAt: now });
    if (parentId) this.setExpanded(`f:${parentId}`, true);
    await this.refreshList();
    return id;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const f = this.state.folders.find((x) => x.id === id);
    if (!f || !name.trim() || name.trim() === f.name) return;
    await this.meta.putFolder({ ...f, name: name.trim(), updatedAt: Date.now() });
    await this.refreshList();
  }

  /** 폴더 삭제 — lift: 안의 노트 · 폴더를 한 단계 위로 · trash: 안의 노트를 모두 휴지통으로 (하위 폴더도 지운다) */
  async deleteFolder(id: string, mode: 'lift' | 'trash'): Promise<void> {
    const f = this.state.folders.find((x) => x.id === id);
    if (!f) return;
    if (mode === 'lift') {
      for (const n of this.state.notes.filter((x) => x.folderId === id)) await this.meta.patch(n.id, { folderId: f.parentId });
      for (const c of this.state.folders.filter((x) => x.parentId === id)) await this.meta.putFolder({ ...c, parentId: f.parentId, updatedAt: Date.now() });
      await this.meta.removeFolder(id);
      await this.refreshList();
      this.toast(`'${f.name}' 폴더를 지웠어요. 안에 있던 항목은 한 단계 위로 옮겼어요.`);
      return;
    }
    const sub = folderSubtree(this.state.folders, id);
    const ids = notesInFolders(this.state.notes, sub);
    const now = Date.now();
    for (const nid of ids) await this.meta.patch(nid, { deletedAt: now });
    for (const fid of sub) await this.meta.removeFolder(fid);
    await this.refreshList();
    if (this.state.currentId && ids.includes(this.state.currentId)) await this.openFallback();
    this.toast(`'${f.name}' 폴더를 지우고 노트 ${ids.length}개를 휴지통으로 옮겼어요.`);
  }

  /** 노트를 폴더 안 · 다른 노트 아래 · 루트로. 자기 자신이나 자기 하위 노트 아래로는 못 간다. 옮겼으면 true */
  async moveNote(id: string, to: NotePlace): Promise<boolean> {
    if (to.parentNoteId && isNoteWithin(this.state.notes, to.parentNoteId, id)) return false;
    const n = this.state.notes.find((x) => x.id === id);
    if (!n || (n.folderId === to.folderId && n.parentNoteId === to.parentNoteId)) return false;
    await this.meta.patch(id, { folderId: to.folderId, parentNoteId: to.parentNoteId });
    const open = to.folderId ? `f:${to.folderId}` : to.parentNoteId ? `n:${to.parentNoteId}` : null;
    if (open) this.setExpanded(open, true);
    await this.refreshList();
    return true;
  }

  async moveFolder(id: string, parentId?: string): Promise<boolean> {
    const f = this.state.folders.find((x) => x.id === id);
    if (!f || f.parentId === parentId || (parentId && isFolderWithin(this.state.folders, parentId, id))) return false;
    await this.meta.putFolder({ ...f, parentId, updatedAt: Date.now() });
    if (parentId) this.setExpanded(`f:${parentId}`, true);
    await this.refreshList();
    return true;
  }

  // ───────── 태그 (FR-074) ─────────

  /** 이름으로 태그 달기 — 없는 이름이면 새로 만든다 */
  async addTag(noteId: string, name: string): Promise<void> {
    const key = tagKey(name);
    if (!key) return;
    let tag = this.state.tags.find((t) => t.nameKey === key);
    if (!tag) {
      tag = { id: newId(), name: name.normalize('NFC').trim(), nameKey: key, createdAt: Date.now() };
      if (!(await this.meta.putTag(tag))) { await this.refreshList(); tag = this.state.tags.find((t) => t.nameKey === key); }
    }
    const n = await this.meta.get(noteId);
    if (!n || !tag || n.tagIds?.includes(tag.id)) { await this.refreshList(); return; }
    await this.meta.patch(noteId, { tagIds: [...(n.tagIds ?? []), tag.id] });
    await this.refreshList();
  }

  async untag(noteId: string, tagId: string): Promise<void> {
    const n = await this.meta.get(noteId);
    if (!n?.tagIds?.includes(tagId)) return;
    const rest = n.tagIds.filter((x) => x !== tagId);
    await this.meta.patch(noteId, { tagIds: rest.length ? rest : undefined });
    await this.refreshList();
  }

  /** 태그 이름 바꾸기 — 노트는 id로 가리키므로 모든 노트에 바로 반영된다. 실패하면 사용자 문구 */
  async renameTag(id: string, name: string): Promise<string | null> {
    const t = this.state.tags.find((x) => x.id === id);
    const key = tagKey(name);
    if (!t || !key || name.trim() === t.name) return null;
    if (!(await this.meta.putTag({ ...t, name: name.normalize('NFC').trim(), nameKey: key }))) return `'${name.trim()}' 태그가 이미 있어요.`;
    await this.refreshList();
    return null;
  }

  async deleteTag(id: string): Promise<void> {
    const t = this.state.tags.find((x) => x.id === id);
    await this.meta.removeTag(id);
    await this.refreshList();
    if (t) this.toast(`'#${t.name}' 태그를 지웠어요. 노트는 그대로예요.`);
  }

  setTagFilter(id: string | null): void {
    if (this.state.page !== 'note') this.set({ page: 'note' });
    this.set({ tagFilter: id });
  }

  // ───────── 검색 · 빠른 전환 (FR-121 · FR-087) ─────────

  openOverlay(mode: Overlay): void { this.set({ overlay: mode }); }
  closeOverlay(): void { if (this.state.overlay) this.set({ overlay: null }); }

  /** 휴지통 빼고 (MSG-TRASH-016). 필터(FR-122): 태그 · 기간 · 폴더 · 역할 = 노트 범위, 종류 · AI = 블록 조건. 검색어 속 #태그는 그 태그 노트로 좁힌다 (10/26) */
  search(q0: string, f: SearchFilter = {}): SearchHit[] {
    let notes = this.state.notes;
    const hashTags: string[] = [];
    const q = q0.replace(/(^|\s)#(\S+)/g, (m, sp: string, name: string) => { const t = this.state.tags.find((x) => x.nameKey === tagKey(name)); if (!t) return m; hashTags.push(t.id); return sp; });
    for (const id of hashTags) notes = notes.filter((n) => n.tagIds?.includes(id));
    if (f.tagId) notes = notes.filter((n) => n.tagIds?.includes(f.tagId!));
    if (f.roleId) notes = notes.filter((n) => effectiveRole(n) === f.roleId);
    if (f.days) { const since = Date.now() - f.days * DAY; notes = notes.filter((n) => n.updatedAt >= since); }
    if (f.folderId) { const ids = new Set(notesInFolders(this.state.notes, folderSubtree(this.state.folders, f.folderId))); notes = notes.filter((n) => ids.has(n.id)); }
    const all = !!(f.tagId || f.days || f.folderId || f.roleId || hashTags.length);
    return this.index.query(q, notes.map((n) => ({ id: n.id, title: displayTitle(n), updatedAt: n.updatedAt })), 50, { kind: f.kind, ai: f.ai, all });
  }

  /** 결과 열기: 노트로 가서 블록 위치로 (FR-012) */
  async openHit(noteId: string, blockId?: string): Promise<void> {
    this.closeOverlay();
    await this.openById(noteId);
    if (blockId && this.hasTarget(blockId)) this.focusBlock(blockId);
  }

  /** 지금 노트를 링크한 노트들 (휴지통 제외) — 노트 패널 (FR-081) */
  backlinks(): Backlink[] {
    const id = this.state.currentId;
    if (!id) return [];
    return this.index.backlinks(id, this.state.notes.map((n) => ({ id: n.id, title: displayTitle(n), updatedAt: n.updatedAt })));
  }

  // ───────── 복제 (FR-077) ─────────

  /** 노트를 통째로(블록 · 화살표 · 필기 · 태그) 같은 자리에 복제하고 연다. 블록 id는 노트 안에서만 유일하면 되므로 그대로 둔다. */
  async duplicateNote(id: string): Promise<void> {
    const src = this.state.notes.find((n) => n.id === id);
    if (!src) return;
    if (src.locked) { this.toast('잠긴 노트는 복제할 수 없어요 — 잠금을 풀고 복제해 주세요 (사본이 암호화되지 않은 채 남지 않게).'); return; }
    // 열려 있는 노트면 아직 저장 전인 편집까지 포함되게 화면의 엔진에서
    const engine = this.open?.engine.note.id === id ? this.open.engine : await readNote(this.store, id);
    const r = engine ? deserialize(serialize(engine)) : null;
    if (!r?.ok) { this.toast('노트를 복제하지 못했어요. 원본은 그대로예요.'); return; }
    const now = Date.now();
    const title = `${displayTitle(src)} (사본)`;
    const copy = new Engine({ ...r.data, note: { ...r.data.note, id: newId(), title, createdAt: now, updatedAt: now } });
    const place = { ...(src.folderId ? { folderId: src.folderId } : {}), ...(src.parentNoteId ? { parentNoteId: src.parentNoteId } : {}) };
    const nid = await this.addEngine(copy, place);
    if (src.tagIds?.length) await this.meta.patch(nid, { tagIds: [...src.tagIds] });
    await this.refreshList();
    await this.openById(nid);
    this.toast(`'${title}' 노트를 만들었어요.`);
  }

  // ───────── 즐겨찾기 (FR-075) ─────────

  async toggleFavorite(id: string): Promise<void> {
    const n = this.state.notes.find((x) => x.id === id);
    if (!n) return;
    await this.meta.patch(id, { favoriteAt: n.favoriteAt ? undefined : Date.now() });
    await this.refreshList();
    this.toast(n.favoriteAt ? `'${displayTitle(n)}'을(를) 즐겨찾기에서 뺐어요.` : `'${displayTitle(n)}'을(를) 즐겨찾기에 넣었어요.`);
  }

  /** 즐겨찾기 — 넣은 순서대로 */
  get favorites() { return this.state.notes.filter((n) => n.favoriteAt).sort((a, b) => a.favoriteAt! - b.favoriteAt!); }

  // ───────── 여러 노트 한 번에 (FR-079) ─────────

  /** 폴더로 · 루트로 옮기기 (하위 노트였으면 부모에서 떼어 낸다). 옮긴 수 */
  async moveNotes(ids: readonly string[], folderId?: string): Promise<number> {
    let n = 0;
    for (const id of ids) {
      const m = this.state.notes.find((x) => x.id === id);
      if (!m || (m.folderId === folderId && !m.parentNoteId)) continue;
      await this.meta.patch(id, { folderId, parentNoteId: undefined });
      n++;
    }
    if (folderId) this.setExpanded(`f:${folderId}`, true);
    await this.refreshList();
    const where = folderId ? `'${this.state.folders.find((f) => f.id === folderId)?.name ?? '폴더'}'` : '맨 위';
    this.toast(`노트 ${n}개를 ${where}(으)로 옮겼어요.`);
    return n;
  }

  /** 같은 태그 달기 (없는 이름이면 만든다) */
  async tagNotes(ids: readonly string[], name: string): Promise<void> {
    for (const id of ids) await this.addTag(id, name);
    if (tagKey(name)) this.toast(`노트 ${ids.length}개에 #${name.trim()} 태그를 달았어요.`);
  }

  /** 한 번에 휴지통으로 — 토스트의 [실행 취소]로 모두 되돌린다 */
  async trashMany(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    const now = Date.now();
    for (const id of ids) await this.meta.patch(id, { deletedAt: now });
    await this.refreshList();
    if (this.state.currentId && ids.includes(this.state.currentId)) await this.openFallback();
    this.toast(`노트 ${ids.length}개를 휴지통으로 옮겼어요.`, { label: '실행 취소', run: () => void this.restore(ids) });
  }

  // ───────── 내보내기 (FR-130) ─────────

  /** 열린 노트면 화면의 엔진(저장 전 편집 포함), 아니면 저장소에서 읽기만 */
  private async engineOf(id: string): Promise<Engine | null> {
    return this.open?.engine.note.id === id ? this.open.engine : readNote(this.store, id).catch(() => null);
  }

  /** 잠긴 노트는 내보내지 않는다 (FR-144 — 평문 파일이 기기 밖으로 나가지 않게) */
  private refuseLocked(id: string): boolean {
    if (!this.state.notes.find((n) => n.id === id)?.locked) return false;
    this.toast('잠긴 노트는 내보낼 수 없어요 — 잠금을 풀고 내보내 주세요.');
    return true;
  }

  protected exportCtx() {
    const titles = new Map(this.state.notes.map((n) => [n.id, displayTitle(n)]));
    return { noteTitle: (id: string) => titles.get(id) ?? null, tags: this.state.tags };
  }

  async noteMarkdown(id: string): Promise<string | null> {
    const meta = this.state.notes.find((n) => n.id === id);
    const engine = meta ? await this.engineOf(id) : null;
    return meta && engine ? noteToMarkdown(engine, meta, this.exportCtx()) : null;
  }

  /** 노트 하나 → .md 파일 내려받기 */
  async exportNote(id: string): Promise<void> {
    if (this.refuseLocked(id)) return;
    const md = await this.noteMarkdown(id);
    const meta = this.state.notes.find((n) => n.id === id);
    if (!md || !meta) { this.toast('노트를 내보내지 못했어요.'); return; }
    download(`${safeName(displayTitle(meta))}.md`, md, 'text/markdown;charset=utf-8');
    this.toast(`'${displayTitle(meta)}'을(를) Markdown 파일로 내보냈어요.`);
  }

  /**
   * 노트 하나 → 백업 JSON (FR-092): 하위 노트까지 · 들어 있는 폴더 · 쓰는 태그 · 이미지(base64)를 한 파일에.
   * 가져오기(FR-125)로 되살리면 상자 위치 · 화살표 · 필기 · 데이터베이스까지 그대로, 같은 노트가 있으면 건너뛰기 · 사본 · 바꾸기 중 고른다.
   */
  async exportNoteBackup(id: string): Promise<void> {
    if (this.refuseLocked(id)) return;
    const s = this.state;
    const root = s.notes.find((n) => n.id === id);
    if (!root) return;
    const ids = [id, ...s.notes.filter((n) => n.id !== id && !n.locked && isNoteWithin(s.notes, n.id, id)).map((n) => n.id)];
    const backup: Backup = { app: 'DamianNote', backupVersion: 1, exportedAt: new Date().toISOString(), notes: [], folders: [], tags: [], templates: [], attachments: [] };
    const hashes = new Set<string>();
    for (const nid of ids) {
      const meta = s.notes.find((n) => n.id === nid)!;
      const engine = await this.engineOf(nid);
      if (!engine) continue;
      backup.notes.push({ meta, snapshot: serialize(engine) });
      for (const a of noteAttachments(engine)) hashes.add(a.hash);
    }
    // 들어 있는 폴더 사슬 · 쓰는 태그
    const fids = new Set<string>();
    for (let f = s.folders.find((x) => x.id === root.folderId); f && !fids.has(f.id); f = s.folders.find((x) => x.id === f!.parentId)) fids.add(f.id);
    backup.folders = s.folders.filter((f) => fids.has(f.id));
    const tids = new Set(backup.notes.flatMap((n) => n.meta.tagIds ?? []));
    backup.tags = s.tags.filter((t) => tids.has(t.id));
    for (const h of hashes) {
      const a = await this.files.get(h);
      if (a) backup.attachments!.push({ hash: h, mime: a.mime, path: '', data: toB64(new Uint8Array(await a.blob.arrayBuffer())) });
    }
    download(`${safeName(displayTitle(root))}.damiannote.json`, JSON.stringify(backup), 'application/json');
    this.toast(`'${displayTitle(root)}'${ids.length > 1 ? ` · 하위 노트 ${ids.length - 1}개` : ''}를 백업 파일(.json)로 내보냈어요. 가져오기로 그대로 되살릴 수 있어요.`);
  }

  /** PNG로 내보내기 (FR-129): 고른 상자가 있으면 그것만, 없으면 캔버스 전체 */
  async exportPng(selectionOnly = true, paper = false): Promise<void> {
    const o = this.open;
    const meta = this.state.notes.find((n) => n.id === this.state.currentId);
    if (!o || !meta) return;
    const ids = selectionOnly && o.view.selectedBlocks.length ? [...o.view.selectedBlocks] : undefined;
    if (!o.engine.blockCount) { this.toast('그릴 상자가 없어요.'); return; }
    const blob = await o.view.exportPng({ ...(ids ? { ids } : {}), ...(paper ? { paper } : {}) });
    if (!blob) { this.toast('이미지를 만들지 못했어요.'); return; }
    download(`${safeName(displayTitle(meta))}${ids ? ` (상자 ${ids.length}개)` : ''}.png`, blob, 'image/png');
    this.toast(ids ? `고른 상자 ${ids.length}개를 PNG로 내보냈어요.` : '캔버스 전체를 PNG로 내보냈어요.');
  }

  /** 노트 하나 → 클립보드 (다른 앱에 바로 붙여넣기) */
  async copyMarkdown(id: string): Promise<void> {
    if (this.refuseLocked(id)) return;
    const md = await this.noteMarkdown(id);
    if (!md) return;
    try { await navigator.clipboard.writeText(md); this.toast('Markdown으로 복사했어요. 다른 앱에 붙여넣을 수 있어요.'); }
    catch { this.toast('클립보드에 쓰지 못했어요. 파일로 내보내기를 써 주세요.'); }
  }

  /** 모든 노트 → ZIP: 폴더 구조 그대로의 .md + 손실 없는 백업 JSON(휴지통 · 템플릿 포함) */
  async exportAll(): Promise<void> {
    const s = this.state;
    const entries: ZipEntry[] = [];
    const used = new Set<string>();
    const backup: Backup = { app: 'DamianNote', backupVersion: 1, exportedAt: new Date().toISOString(), notes: [], folders: s.folders, tags: s.tags, templates: s.templates };
    let failed = 0;
    // 1) 노트를 읽고 이미지 첨부를 모은다 → attachments/<해시>.<확장자>
    const loaded: { meta: (typeof s.notes)[number]; engine: Engine }[] = [];
    const hashes = new Set<string>();
    const fileNames = new Map<string, string>();
    let lockedSkipped = 0;
    for (const meta of [...s.notes, ...s.trash]) {
      if (meta.locked) { lockedSkipped++; continue; }
      const engine = await this.engineOf(meta.id);
      if (!engine) { failed++; continue; }
      loaded.push({ meta, engine });
      for (const a of noteAttachments(engine)) { hashes.add(a.hash); if (a.name) fileNames.set(a.hash, a.name); }
    }
    const files = new Map<string, string>();
    backup.attachments = [];
    for (const h of hashes) {
      const a = await this.files.get(h);
      if (!a) continue;
      const fname = fileNames.get(h);
      const path = fname ? `attachments/${h.slice(0, 12)}-${safeName(fname)}` : `attachments/${h}.${extOf(a.mime)}`;
      files.set(h, path);
      backup.attachments.push({ hash: h, mime: a.mime, path });
      entries.push({ path, data: new Uint8Array(await a.blob.arrayBuffer()) });
    }
    // 2) 노트마다 .md (이미지는 상대 경로)
    for (const { meta, engine } of loaded) {
      backup.notes.push({ meta, snapshot: serialize(engine) });
      if (meta.deletedAt) continue;
      const dir = notePathParts(meta, s.notes, s.folders).join('/');
      const up = '../'.repeat(dir ? dir.split('/').length : 0);
      const ctx = { ...this.exportCtx(), imagePath: (h: string) => (files.has(h) ? up + files.get(h)! : null) };
      const base = `${dir ? `${dir}/` : ''}${safeName(displayTitle(meta))}`;
      let path = `${base}.md`;
      for (let i = 2; used.has(path.toLowerCase()); i++) path = `${base} (${i}).md`;
      used.add(path.toLowerCase());
      entries.push({ path, data: noteToMarkdown(engine, meta, ctx) });
    }
    entries.push({ path: '_백업/damiannote-backup.json', data: JSON.stringify(backup) });
    const day = new Date().toISOString().slice(0, 10);
    download(`DamianNote-${day}.zip`, makeZip(entries), 'application/zip');
    const now = Date.now();
    void this.meta.setSetting('lastExportAt', now);
    this.set({ lastExportAt: now });
    const noteCount = entries.filter((e) => e.path.endsWith('.md')).length;
    this.toast(`노트 ${noteCount}개${files.size ? ` · 이미지 ${files.size}개` : ''}를 내보냈어요${failed ? ` (${failed}개는 읽지 못했어요)` : ''}${lockedSkipped ? ` · 잠긴 노트 ${lockedSkipped}개는 빠졌어요` : ''}. 백업 파일도 같이 들어 있어요.`);
  }

  // ───────── 휴지통 (FR-076) ─────────

  async trash(id: string): Promise<void> {
    const m = await this.meta.patch(id, { deletedAt: Date.now() });
    await this.refreshList();
    if (this.state.currentId === id) await this.openFallback();
    if (m) this.toast(`'${displayTitle(m)}' 노트를 휴지통으로 옮겼어요.`, {
      label: '실행 취소',
      run: () => void this.restore([id]).then(() => this.openById(id)),
    });
  }

  /** 휴지통 → 원래 목록 */
  async restore(ids: readonly string[]): Promise<void> {
    const folders = new Set(this.state.folders.map((f) => f.id));
    for (const id of ids) {
      const n = await this.meta.get(id);
      // 폴더가 그사이 지워졌으면 루트로 (상위 노트는 휴지통에 있을 수 있어 그대로 둔다 — 복원하면 제자리)
      await this.meta.patch(id, { deletedAt: undefined, ...(n?.folderId && !folders.has(n.folderId) ? { folderId: undefined } : {}) });
    }
    await this.refreshList();
  }

  /** 영구 삭제. 되돌릴 수 없으므로 호출 전 UI가 확인을 받는다. */
  async deleteForever(ids: readonly string[]): Promise<void> {
    await this.purge(ids);
    await this.refreshList();
    this.toast('영구 삭제했어요.');
  }

  emptyTrash(): Promise<void> { return this.deleteForever(this.state.trash.map((n) => n.id)); }
}
