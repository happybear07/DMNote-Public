// 워크스페이스 가져오기 층 (FR-125 · FR-127): 계획(import.ts)을 받아 실제로 노트 · 폴더 · 태그를 만든다.
// 진행률 · 중단, 가져오기 한 건을 휴지통으로 한 번에 되돌리기. 층 순서: … → ws-organize → 여기 → workspace.ts
import { Engine, newId, replaceNoteContent, serialize, type Id } from '@dn/engine-core';
import { openNote, tagKey, type NoteMeta } from '@dn/storage-idb';
import { planImport, type AttachedImage, type ImportNote, type ImportPlan } from './import';
import { OrganizeLayer } from './ws-organize';
import { tryLockNote, type ImportOptions } from './ws-model';

export abstract class ImportLayer extends OrganizeLayer {
  /** 미리보기 중인 계획 (대화상자가 읽는다) */
  importPlan: ImportPlan | null = null;
  private importCancel = false;

  /** 파일 고른 뒤: 계획을 세우고 미리보기 대화상자를 연다 */
  async prepareImport(files: readonly File[]): Promise<void> {
    if (!files.length) return;
    try {
      this.importPlan = await planImport(files, { notes: this.state.notes, trash: this.state.trash, measure: (doc, w) => this.view?.measureText(doc, w) ?? null });
      this.set({ dialog: { kind: 'import' } });
    } catch (err) {
      this.toast(err instanceof Error ? err.message : '파일을 읽지 못했어요.');
    }
  }

  cancelImport(): void { this.importCancel = true; }

  async runImport(opts: ImportOptions): Promise<void> {
    const plan = this.importPlan;
    if (!plan || this.state.importRun) return;
    this.importCancel = false;
    const todo = plan.notes.filter((n) => !(n.conflictId && opts.conflict === 'skip'));
    this.set({ importRun: { done: 0, total: todo.length } });
    const created: Id[] = [];
    let merged = 0, replaced = 0, skipped = plan.notes.length - todo.length, failed = 0;
    try {
      const root = opts.target === '__new' ? await this.createFolder(`가져온 노트 ${new Date().toLocaleDateString('ko-KR')}`) : opts.target || undefined;
      const tagIds = await this.ensureTags([...new Set([...plan.notes.flatMap((n) => n.tags), ...(opts.tag ? [opts.tag] : [])])]);
      const folderOf = plan.kind === 'backup' ? await this.restoreFolders(plan, root) : await this.mdFolders(todo, root);
      const imported = new Set(todo.map((n) => n.id));
      const attached = await this.importFiles(plan);
      for (const [i, n] of todo.entries()) {
        if (this.importCancel) break;
        try {
          if (n.conflictId && opts.conflict === 'merge') { if (await this.mergeInto(n.conflictId, n, attached)) merged++; else failed++; }
          else if (n.conflictId && opts.conflict === 'replace') { if (await this.replaceWith(n.conflictId, n, attached)) replaced++; else failed++; }
          else {
            const engine = n.build(attached);
            const copy = !!n.conflictId; // 같은 노트가 있으면 새 id로 사본
            const id = copy ? newId() : n.id;
            const e = copy ? withId(engine, id, `${n.title} (가져옴)`) : engine;
            const tags = [...n.tags, ...(opts.tag ? [opts.tag] : [])].map((t) => tagIds.get(tagKey(t))).filter((x): x is string => !!x);
            const parent = n.parentNoteId && (imported.has(n.parentNoteId) || this.state.notes.some((x) => x.id === n.parentNoteId)) ? n.parentNoteId : undefined;
            const folderId = parent ? undefined : folderOf(n);
            await this.addEngine(e, { ...(folderId ? { folderId } : {}), ...(parent ? { parentNoteId: parent } : {}) },
              { createdAt: n.createdAt, ...(tags.length ? { tagIds: [...new Set(tags)] } : {}), ...(n.extra ?? {}) });
            created.push(id);
          }
        } catch (err) {
          console.warn('가져오기 실패', n.title, err);
          failed++;
        }
        this.set({ importRun: { done: i + 1, total: todo.length } });
        if (i % 20 === 19) await new Promise((r) => setTimeout(r)); // 화면이 멈추지 않게
      }
      if (plan.templates.length) {
        const have = new Set(this.state.templates.map((t) => t.id));
        const templates = [...this.state.templates, ...plan.templates.filter((t) => !have.has(t.id))];
        await this.meta.setSetting('templates', templates);
        this.set({ templates });
      }
    } finally {
      this.set({ importRun: null, dialog: null });
      this.importPlan = null;
      await this.refreshList();
    }
    if (created.length) {
      await this.meta.setSetting('lastImport', { at: Date.now(), ids: created });
      await this.openById(created[0]!);
    }
    const parts = [`노트 ${created.length}개를 가져왔어요`, merged && `${merged}개는 기존 노트에 합쳤어요`, replaced && `${replaced}개는 백업 내용으로 바꿨어요`, skipped && `${skipped}개는 건너뛰었어요`,
      failed && `${failed}개는 실패했어요`, this.importCancel && '중간에 멈췄어요'].filter(Boolean).join(' · ');
    this.toast(`${parts}.`, created.length ? { label: '되돌리기', run: () => void this.undoImport(created) } : undefined);
  }

  /** 가져오기 한 건 되돌리기 — 만든 노트를 휴지통으로 (FR-127 · FR-076) */
  async undoImport(ids?: readonly Id[]): Promise<void> {
    const list = ids ?? (await this.meta.getSetting<{ ids: Id[] }>('lastImport'))?.ids ?? [];
    const live = list.filter((id) => this.state.notes.some((n) => n.id === id));
    if (!live.length) { this.toast('되돌릴 가져오기가 없어요.'); return; }
    await this.trashMany(live);
    await this.meta.setSetting('lastImport', null);
  }

  /** 첨부 파일 먼저: 백업은 원래 해시로 되살리고, Markdown 이미지는 저장해 이름 → 첨부 표를 만든다 */
  private async importFiles(plan: ImportPlan): Promise<Map<string, AttachedImage>> {
    const out = new Map<string, AttachedImage>();
    let changed = 0;
    for (const f of plan.files) {
      try {
        let w = 0, h = 0;
        try { const bmp = await createImageBitmap(f.blob); w = bmp.width; h = bmp.height; bmp.close(); } catch { w = h = 400; } // SVG 등
        // 해시는 내용으로 다시 계산 — 백업에 적힌 해시로 다른 내용을 덮어쓰지 못하게 (보안 2-7, 동기화 파일 가져오기와 같게)
        const hash = await this.files.put(f.blob, { w, h });
        if (f.hash && hash !== f.hash) changed++;
        out.set(f.name, { hash, w, h });
      } catch (err) { console.warn('첨부를 가져오지 못했어요', f.name, err); }
    }
    if (changed) this.toast(`첨부 ${changed}개는 백업에 적힌 내용과 달라 빈 자리로 보여요 (파일이 바뀌었을 수 있어요).`);
    return out;
  }

  /** 태그 이름 → id (없으면 만든다) */
  private async ensureTags(names: string[]): Promise<Map<string, string>> {
    const out = new Map(this.state.tags.map((t) => [t.nameKey, t.id]));
    for (const name of names) {
      const key = tagKey(name);
      if (!key || out.has(key)) continue;
      const tag = { id: newId(), name: name.normalize('NFC').trim(), nameKey: key, createdAt: Date.now() };
      if (await this.meta.putTag(tag)) out.set(key, tag.id);
    }
    return out;
  }

  /** 같은 상위에 같은 이름의 폴더가 있으면 그걸 쓰고, 없으면 만든다 */
  private async folderNamed(name: string, parentId?: string): Promise<string> {
    const folders = await this.meta.listFolders();
    const hit = folders.find((f) => f.name === name && (f.parentId ?? undefined) === parentId);
    if (hit) return hit.id;
    const now = Date.now();
    const id = newId();
    await this.meta.putFolder({ id, name, ...(parentId ? { parentId } : {}), createdAt: now, updatedAt: now });
    return id;
  }

  /** 백업의 폴더 나무를 대상 아래에 다시 만든다 → 노트의 원래 폴더 id → 새 폴더 id */
  private async restoreFolders(plan: ImportPlan, root?: string): Promise<(n: ImportNote) => string | undefined> {
    const map = new Map<string, string>();
    const byId = new Map(plan.folders.map((f) => [f.id, f]));
    const make = async (id: string, depth = 0): Promise<string | undefined> => {
      if (map.has(id)) return map.get(id);
      const f = byId.get(id);
      if (!f || depth > 50) return root;
      const parent = f.parentId ? await make(f.parentId, depth + 1) : root;
      const nid = await this.folderNamed(f.name, parent);
      map.set(id, nid);
      return nid;
    };
    for (const n of plan.notes) if (n.folderId) await make(n.folderId);
    return (n) => (n.folderId ? map.get(n.folderId) ?? root : root);
  }

  /** Markdown 파일의 폴더 경로 → 폴더 */
  private async mdFolders(notes: ImportNote[], root?: string): Promise<(n: ImportNote) => string | undefined> {
    const map = new Map<string, string | undefined>([['', root]]);
    for (const n of notes) {
      let parent = root, key = '';
      for (const part of n.dir) {
        key += `/${part}`;
        if (!map.has(key)) map.set(key, await this.folderNamed(part, parent));
        parent = map.get(key);
      }
    }
    return (n) => map.get(n.dir.map((d) => `/${d}`).join(''));
  }

  /** 기존 노트를 백업 내용으로 바꾼다 (FR-092) — 한 번의 실행 취소 단위, 노트 위치 · 태그는 그대로 */
  private async replaceWith(targetId: Id, n: ImportNote, attached: ReadonlyMap<string, AttachedImage>): Promise<boolean> {
    const src = n.build(attached);
    const swap = async (e: Engine) => {
      // 바꾸기 전 상태를 버전으로 남긴다 (FR-093)
      await this.store.saveVersion({ noteId: targetId, reason: 'before-replace', title: e.note.title, blocks: e.blockCount }, serialize(e)).catch(() => null);
      replaceNoteContent(e, src, '백업 내용으로 바꾸기');
    };
    return (await this.editNote(targetId, async (e) => { await swap(e); return true; })) === true;
  }

  /** 같은 제목의 기존 노트 아래쪽에 가져온 내용을 상자로 붙인다 (병합) */
  private async mergeInto(targetId: Id, n: ImportNote, attached: ReadonlyMap<string, AttachedImage>): Promise<boolean> {
    const src = n.build(attached);
    const add = (e: Engine) => {
      const bottom = Math.max(0, ...[...e.blocks()].map((b) => b.y + b.h));
      e.transact((tx) => {
        for (const b of src.blocks()) {
          const nb = tx.createBlock({ x: b.x, y: bottom + 60 + b.y, w: b.w, h: b.h });
          for (const c of src.contentsOf(b.id)) {
            const { id: _id, blockId: _b, order: _o, ...rest } = c as typeof c & Record<string, unknown>;
            tx.createContent({ ...rest, blockId: nb } as never);
          }
        }
      }, { origin: 'user', label: '가져온 내용 합치기' });
    };
    return (await this.editNote(targetId, (e) => { add(e); return true; })) === true;
  }

  /** 노트 하나 고치기 — 열린 노트면 바로, 아니면 잠금을 잡고 열어 고친 뒤 저장 · 색인 (다른 탭이 잡고 있으면 'busy', 못 열면 null) */
  protected async editNote<T>(id: Id, fn: (e: Engine) => T | Promise<T>, patch?: (e: Engine) => Partial<NoteMeta>): Promise<T | 'busy' | null> {
    if (this.open?.engine.note.id === id) return fn(this.open.engine);
    const release = await tryLockNote(id);
    if (!release) return 'busy';
    try {
      const r = await openNote(this.store, id);
      if (!r.ok) return null;
      const v = await fn(r.engine);
      await r.session.dispose();
      if (v) {
        if (patch) await this.meta.patch(id, patch(r.engine));
        await this.putSearchDoc(r.engine);
      }
      return v;
    } finally { release(); }
  }
}

/** 같은 내용, 다른 노트 id · 제목 (블록 id는 노트 안에서만 유일하면 되므로 그대로) */
function withId(e: Engine, id: string, title: string): Engine {
  return new Engine({ note: { ...e.note, id, title }, blocks: [...e.blocks()], contents: [...e.contents()], arrows: [...e.arrows()], strokes: [...e.strokes()] });
}
