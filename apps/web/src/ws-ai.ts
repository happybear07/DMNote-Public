// AI 자동 구조화 (FR-105~109) · 동의 · 모델 · 키 (FR-139): 블록 하나를 구조화하고, 동의 · 키가 없으면 그 단계를 먼저 거친 뒤 이어서 실행한다.
import { AiError, aiErrorMessage, type Effort, type StructureKind, type StructureMode } from '@dn/ai-pipeline';
import { appliedMessage, blockText, keyInfo, KEY_SECRET, restructureSource, runStructure, saveApiKey, getAiUsage, type AiUsageTotal, type ConsentRecord, type RestructureSource } from './ai';
import { CONSENT_VERSION } from './legal/consent';
import { CHIP_MIN_CHARS } from './ws-model';
import { RemindLayer } from './ws-remind';
import { seekMedia, SttCtl } from './stt-flow';
import type { SttLang } from './stt';
import { MEDIA_SEEK } from '@dn/text-pm';
import { createTextBlock, ocrLinesDoc } from '@dn/engine-core';

type PendingAi = { id: string; mode?: StructureMode; again?: RestructureSource };
/** 블록이 없는 글을 구조화할 때의 자리 표시 id (진행 카드는 화면 왼쪽 위에) */
const FREE_TEXT = 'free-text';

export abstract class AiLayer extends RemindLayer {
  /** 동의 · 키 등록을 기다리는 구조화 요청 (끝나면 이어서 실행, MSG-AI-011) */
  private pendingAi: PendingAi | null = null;

  /** 녹음 받아쓰기 (FR-044 · 046, stt-flow.ts) — 기기 안 Whisper, 끝나면 받아쓴 글로 구조화 · 요약 */
  readonly stt: SttCtl = (() => {
    const ws = this; // eslint-disable-line @typescript-eslint/no-this-alias
    return new SttCtl({
      get engine() { return ws.open?.engine ?? null; }, get noteId() { return ws.state.currentId; }, get files() { return ws.files; }, get meta() { return ws.meta; },
      get stt() { return ws.state.stt; }, patch: (p) => ws.set(p), toast: (t, a, alt) => ws.toast(t, a, alt), canWrite: () => !!ws.open && ws.canWrite(ws.open),
      openNote: (id) => ws.openById(id), measure: (doc, w) => ws.view?.measureText(doc, w) ?? 120,
      structure: (id) => void ws.structure(id), summarize: () => ws.summarizeNote(),
    });
  })();

  transcribe(blockId: string, lang?: SttLang): void { void this.stt.start(blockId, lang); }

  abstract summarizeNote(): void;

  /** 받아쓴 글의 재생 시각을 누르면 그 녹음을 그 시점부터 — 녹음 블록이 화면 밖이라 안 그려졌으면 그리로 옮긴 뒤 */
  protected onMediaSeek = (ev: Event): void => {
    const { ref, t } = (ev as CustomEvent<{ ref: string; t: number }>).detail;
    if (seekMedia(ref, t, ev.target as Element)) return;
    const c = this.open?.engine.getContent(ref);
    if (!c) { this.toast('이 시각의 녹음을 찾지 못했어요 — 지워졌을 수 있어요.'); return; }
    this.focusBlock(c.blockId);
    setTimeout(() => { if (!seekMedia(ref, t)) this.toast('녹음 재생기를 열지 못했어요.'); }, 300);
  };

  protected listenMediaSeek(on: boolean): void {
    if (on) document.addEventListener(MEDIA_SEEK, this.onMediaSeek); else document.removeEventListener(MEDIA_SEEK, this.onMediaSeek);
  }

  /** 고른 AI 상자만 다시 구조화 (FR-110): 그 상자들이 나온 원문 구간을 다시 보내고, 결과로 그 상자들을 바꾼다(실행 취소 한 번) */
  async restructure(ids?: readonly string[]): Promise<void> {
    const o = this.open;
    if (!o) return;
    const s = restructureSource(o.engine, ids ?? o.view.selectedBlocks);
    if ('error' in s) { this.toast(s.error); return; }
    await this.structure(s.replace[0], undefined, s);
  }

  /** 블록이 아닌 글(손글씨에서 읽은 글, FR-039)을 붙여넣기와 같은 파이프라인으로 구조화 — 결과는 at에, 실행 취소 한 번 */
  async structureText(text: string, at: { x: number; y: number }): Promise<void> {
    await this.structure(FREE_TEXT, undefined, { text, replace: [], at });
  }

  /** 블록 하나를 구조화. 동의 · 키가 없으면 그 단계를 먼저 거친 뒤 이어서 실행한다.
   *  mode: 결과 알림의 '노트로 · 도식으로 다시'에서 고른 모양 (없으면 AI가 고른다, NOTE-SHEET-PLAN U-1). again: 고른 AI 상자만 다시(restructure) */
  async structure(blockId?: string, mode?: StructureMode, again?: RestructureSource): Promise<void> {
    const o = this.open;
    const id = blockId ?? (o?.view.selectedBlocks.length === 1 ? o.view.selectedBlocks[0] : undefined);
    if (!o || !id) { this.toast('구조화할 블록을 하나 선택해 주세요.'); return; }
    // 잠긴 노트는 AI로 보내지 않는다 (FR-144)
    if (this.store.isLocked(o.engine.note.id)) { this.toast('잠긴 노트는 AI로 보내지 않아요 — 잠금을 풀고 다시 해 주세요.'); return; }
    if (this.state.aiRun) { this.toast('이미 구조화하는 중이에요.'); return; }
    if (o.session.readonly) return;
    if ((again?.text ?? blockText(o.engine, id)).replace(/\s/g, '').length < CHIP_MIN_CHARS) { this.toast('구조화할 내용이 너무 적어요. 조금 더 긴 글을 골라 주세요.'); return; }
    const pending: PendingAi = { id, ...(mode ? { mode } : {}), ...(again ? { again } : {}) };
    if (!this.state.ai.consent) { this.pendingAi = pending; this.set({ dialog: { kind: 'consent' }, chip: null }); return; }
    if (!this.state.ai.keyLast4) {
      this.pendingAi = pending;
      this.set({ dialog: { kind: 'settings', reason: 'Claude API 키가 있어야 구조화할 수 있어요. 키를 등록하면 지금 요청을 바로 이어서 할게요. 원문은 그대로 있어요.' }, chip: null });
      return;
    }
    // 손글씨에서 읽은 글(FREE_TEXT)은 노트에 원문이 없다 — 구조화하지 못하면 그 글을 글 상자로 넣을 수 있게 (교차 검토 B5)
    const keep = id === FREE_TEXT && again ? { label: '글 상자로 넣기', run: () => this.freeTextBox(again.text, again.at) } : undefined;
    const ac = new AbortController();
    this.aiAbort = ac;
    this.set({ chip: null, aiRun: { blockId: id, progress: null, startedAt: Date.now() } });
    // 큰 변경 전 안전망 (FR-093)
    await this.saveVersion('before-ai', true);
    try {
      const r = await runStructure(id, {
        engine: o.engine, view: o.view, meta: this.meta, settings: this.state.ai, signal: ac.signal,
        onProgress: (p) => { if (this.state.aiRun) this.set({ aiRun: { ...this.state.aiRun, progress: p } }); },
      }, mode, again);
      if (r.kind === 'no-key') {
        this.pendingAi = pending;
        this.set({ ai: { ...this.state.ai, ...keyInfo(null) }, dialog: { kind: 'settings', reason: '저장된 키를 읽지 못했어요. 키를 다시 입력해 주세요. 원문은 그대로 있어요.' } });
      } else if (r.kind === 'empty') {
        this.toast(keep ? '관계 · 수치 · 비교로 정리할 만한 내용을 찾지 못했어요. 읽은 글은 글 상자로 넣을 수 있어요.' : '관계 · 수치 · 비교로 정리할 만한 내용을 찾지 못했어요. 원문은 그대로 있어요.', keep);
      } else if (again?.replace.length) {
        // 다시 구조화: 태그는 붙이지 않고, 실행 취소 한 번이면 이전 결과로
        this.toast(`고른 상자 ${again.replace.length}개를 다시 정리했어요 — ${appliedMessage(r.counts)}`, { label: '실행 취소', run: () => this.view?.undo() });
      } else {
        const p = r.plan;
        const n = r.counts.blocks + r.counts.charts + r.counts.tables;
        // AI 자동 태그: 원문 키워드를 노트 태그로 (실행 취소하면 이번에 붙인 태그도 뗀다)
        const added = this.state.ai.autoTag ? await this.tagFromAi(o.engine.note.id, p.keywords ?? []) : [];
        const undo = { label: '실행 취소', run: () => { this.view?.undo(); for (const t of added) void this.untag(o.engine.note.id, t); } };
        // 다른 모양으로 다시: 이번 결과를 되돌리고(한 번에) 고른 모양으로 다시 요청
        const other: StructureMode = p.mode === 'sheet' ? 'diagram' : 'sheet';
        const alt = { label: other === 'sheet' ? '노트로 다시' : '도식으로 다시', run: () => { this.view?.undo(); void (async () => { for (const t of added) await this.untag(o.engine.note.id, t); await this.structure(id, other, again); })(); } };
        const done0 = p.mode === 'sheet' && p.sheet ? `노트로 정리했어요 — 문단 ${p.sheet.sections.length}개를 블록에 맞췄어요.` : appliedMessage(r.counts);
        const done = added.length ? `${done0} 태그 ${added.length}개를 붙였어요.` : done0;
        if (p.dropped.length) this.toast(`일부 항목은 형식이 맞지 않아 빼고 ${n}개만 만들었어요. 원문은 그대로 있어요.`, undo, alt);
        else if (p.failedChunks > 0) this.toast(`${done} ${p.failedChunks}개 구간은 구조화하지 못했어요.`, undo, alt);
        else this.toast(done, undo, alt);
      }
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError('upstream-error', { detail: String(e) });
      if (err.code === 'invalid-api-key' || err.code === 'no-api-key') {
        this.pendingAi = pending;
        this.set({ dialog: { kind: 'settings', reason: aiErrorMessage(err).text } });
      } else if (err.code === 'invalid-response') {
        this.toast(aiErrorMessage(err).text, { label: '다시 시도', run: () => void this.structure(id, mode, again) }, keep);
      } else {
        const m = aiErrorMessage(err).text.replace('{time}', err.retryAfter ? `${Math.ceil(err.retryAfter / 60)}분` : '잠시');
        this.toast(m, keep);
      }
    } finally {
      if (this.aiAbort === ac) this.aiAbort = null;
      this.set({ aiRun: null });
    }
  }

  /** 구조화하지 못한 읽은 글을 그 자리에 글 상자로 (줄 머리 '- ' · '[ ]'는 목록 · 할 일 — 손글씨를 글로와 같게) */
  private freeTextBox(text: string, at: { x: number; y: number }): void {
    const o = this.open;
    if (!o || !this.canWrite(o)) return;
    const r = createTextBlock(o.engine, at, { doc: ocrLinesDoc(text.split('\n')), w: 360, label: '읽은 글 넣기' });
    if (!r.ok) { this.toast('글 상자를 만들지 못했어요.'); return; }
    o.view.select([r.value.blockId]);
    this.toast('읽은 글을 글 상자로 넣었어요.', { label: '실행 취소', run: () => this.view?.undo() });
  }

  /** AI 키워드 → 노트 태그 (이미 붙은 것은 건너뜀). 결과: 새로 붙인 태그 id */
  private async tagFromAi(noteId: string, keywords: readonly string[]): Promise<string[]> {
    const before = new Set(this.state.notes.find((n) => n.id === noteId)?.tagIds ?? []);
    for (const k of keywords) await this.addTag(noteId, k);
    return (this.state.notes.find((n) => n.id === noteId)?.tagIds ?? []).filter((t) => !before.has(t));
  }

  async setAiAutoTag(on: boolean): Promise<void> {
    await this.meta.setSetting('aiAutoTag', on);
    this.set({ ai: { ...this.state.ai, autoTag: on } });
  }

  cancelStructure(): void { this.aiAbort?.abort(); }
  dismissChip(): void { if (this.state.chip) this.set({ chip: null }); }
  closeDialog(): void { this.pendingAi = null; this.afterAiDialog(false); this.set({ dialog: null }); }
  /** 동의 · 키 창이 끝난 뒤 (ok: 동의했거나 키를 저장함) — 작성 도우미가 기다리던 할 일을 이어서 보냈나 (교차 검토 A8) */
  protected afterAiDialog(_ok: boolean): boolean { return false; }

  async acceptConsent(): Promise<void> {
    // 동의 기록: 어느 판 문구에 언제 (문구 판이 바뀌면 다시 묻는다 — legal/consent.ts)
    const at = Date.now();
    await this.meta.setSetting('aiConsent', true);
    await this.meta.setSetting('aiConsentRecord', { version: CONSENT_VERSION, at } satisfies ConsentRecord);
    this.set({ ai: { ...this.state.ai, consent: true, consentAt: at, consentOld: false }, dialog: null });
    const p = this.pendingAi;
    this.pendingAi = null;
    if (p) await this.structure(p.id, p.mode, p.again);
    else this.afterAiDialog(true);
  }

  async withdrawConsent(): Promise<void> {
    await this.meta.setSetting('aiConsent', false);
    this.set({ ai: { ...this.state.ai, consent: false, consentAt: null, consentOld: false } });
    this.toast('AI 전송 동의를 철회했어요. 다음에 AI를 쓸 때 다시 여쭤볼게요.');
  }

  async setAiModel(model: string): Promise<void> {
    await this.meta.setSetting('aiModel', model);
    this.set({ ai: { ...this.state.ai, model } });
  }

  async setAiEffort(effort: Effort): Promise<void> {
    await this.meta.setSetting('aiEffort', effort);
    this.set({ ai: { ...this.state.ai, effort } });
  }

  aiUsage(): Promise<AiUsageTotal> { return getAiUsage(this.meta); }
  async resetAiUsage(): Promise<void> { await this.meta.setSetting('aiUsage', null); }

  async setAiKinds(kinds: StructureKind[]): Promise<void> {
    if (!kinds.length) return; // 하나는 켜져 있어야 한다 (API 3.2: 빈 배열이면 400)
    await this.meta.setSetting('aiKinds', kinds);
    this.set({ ai: { ...this.state.ai, kinds } });
  }

  /** 키 확인 · 저장 (FR-139). 실패하면 사용자 문구, 성공이면 null. 기다리던 구조화가 있으면 이어서 실행. */
  async saveKey(apiKey: string): Promise<string | null> {
    // 암호화(crypto.subtle)는 보안 컨텍스트(https · localhost)에만 있다 — http LAN 주소(iPad로 접속 등)에서는 저장할 수 없다
    if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
      return '이 주소는 보안 연결(https)이 아니라서 키를 안전하게 저장할 수 없어요. https 주소로 열어 주세요. 노트는 그대로 쓸 수 있어요.';
    }
    const err = await saveApiKey(this.meta, apiKey);
    if (err) {
      return err.code === 'invalid-api-key' || err.code === 'invalid-request'
        ? '이 키로는 Claude에 연결하지 못했어요. 키를 다시 확인해 주세요.'
        : aiErrorMessage(err).text.replace('{time}', '잠시');
    }
    const key = apiKey.trim();
    this.set({ ai: { ...this.state.ai, ...keyInfo(key.slice(-4)) } });
    const p = this.pendingAi;
    if (p) {
      this.pendingAi = null;
      this.set({ dialog: null });
      this.toast('키를 저장했어요. 구조화를 이어서 할게요.');
      void this.structure(p.id, p.mode, p.again);
    } else if (this.afterAiDialog(true)) {
      this.set({ dialog: null });
      this.toast('키를 저장했어요. 이어서 할게요.');
    }
    return null;
  }

  async deleteKey(): Promise<void> {
    await this.meta.deleteSecret(KEY_SECRET);
    this.set({ ai: { ...this.state.ai, ...keyInfo(null) } });
  }
}
