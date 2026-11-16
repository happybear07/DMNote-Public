// 손글씨 → 글 흐름 (FR-038 · 화면 11): 고른 필기 → 그림 → Claude(ocr.v1) → 미리보기에서 고치고 → 글 상자로 바꾸기 · 추가.
// 신뢰도가 낮으면(0.6 미만) 필기를 그대로 블록으로 묶어 두기를 권한다(AI-PROMPTS 10절). AI 전송 동의 · 키 확인은 구조화와 같다.
// 필기 → AI 구조화 (FR-039): 필기 막대 'AI로 구조화'는 읽은 글을 붙여넣기와 같은 구조화 파이프라인에 그대로 태운다 —
// 잘 읽혔으면(0.6 이상) 미리보기 없이 바로, 아니면 미리보기에서 고친 뒤 '구조화하기'. 결과는 필기 옆(A4면 아래), 필기는 남는다.
import { aiErrorMessage, AiError, OCR_MODEL, OCR_PRECISE_MODEL } from '@dn/ai-pipeline';
import { inkToText, ocrLinesDoc, SHEET_PAD, type Vec2 } from '@dn/engine-core';
import { bindSelectedInk, inkImage, type CanvasView, type InkImage } from '@dn/engine-dom';
import type { MetaStore } from '@dn/storage-idb';
import { addAiUsage, directOpts } from './ai';
import { CHIP_MIN_CHARS } from './ws-model';

export interface OcrState {
  step: 'running' | 'done' | 'error';
  /** 미리보기 그림 (data URL) */
  image: string;
  /** 인식한 글 — 줄마다 (미리보기에서 고칠 수 있다) */
  text: string;
  /** 0 ~ 1 — 0.8 / 0.6 경계로 높음 · 보통 · 낮음 */
  confidence: number;
  precise: boolean;
  error?: string;
  /** 'AI로 구조화'로 시작했으면 — 미리보기의 주 단추가 '구조화하기' */
  then?: 'structure';
}

/** 읽고 바로 구조화하는 신뢰도 (이보다 낮으면 미리보기에서 고친 뒤) */
const STRUCTURE_MIN_CONFIDENCE = 0.6;
/** 구조화할 만큼 긴 글인가 — 붙여넣기 구조화와 같은 최소 길이(공백 제외 20자) */
export const longEnough = (text: string): boolean => text.replace(/\s/g, '').length >= CHIP_MIN_CHARS;

interface Host {
  readonly view: CanvasView | null;
  readonly meta: MetaStore;
  readonly consent: boolean;
  readonly hasKey: boolean;
  /** 지금 노트가 잠겼나 (FR-144 — 잠긴 노트의 필기는 AI로 보내지 않는다) */
  readonly locked: boolean;
  readonly ocr: OcrState | null;
  patch(p: { ocr: OcrState | null }): void;
  toast(t: string): void;
  askConsent(): void;
  askKey(reason: string): void;
  /** 읽은 글을 붙여넣기와 같은 구조화 파이프라인으로 (FR-039) — 결과를 at에 */
  structure(text: string, at: Vec2): void;
  /** 읽은 글을 그 획들의 검색 글로 (FR-120 — 색인에만) */
  inkRead(strokes: readonly string[], text: string): void;
}

export class OcrCtl {
  private img: InkImage | null = null;
  private abort: AbortController | null = null;
  private then: 'structure' | undefined;
  /** 동의 · 키 창을 기다리는 읽기 — 동의 · 저장하면 이어서 (AT-029: 동의해도 아무 일 없어 한 번 더 눌러야 했다) */
  private pending: { precise: boolean; then?: 'structure' } | null = null;
  constructor(private readonly h: Host) {}

  /** 고른 필기 읽기 (precise면 정밀 인식 — 더 큰 모델). then 'structure'면 읽은 뒤 구조화까지 (FR-039). reuse: 앞서 만든 그림 그대로 (창을 지나 이어서) */
  async start(precise = false, then?: 'structure', reuse = false): Promise<void> {
    const view = this.h.view;
    if (!view) return;
    if (this.h.locked) { this.h.toast('잠긴 노트는 AI로 보내지 않아요 — 잠금을 풀고 다시 해 주세요.'); return; }
    if (!precise) this.then = then;
    if (!this.img || (!reuse && !precise)) {
      const ids = [...view.ink.selected];
      this.img = ids.length ? await inkImage(view, ids) : null;
    }
    const img = this.img;
    if (!img) { this.h.toast('글로 바꿀 손글씨를 먼저 골라 주세요.'); return; }
    const wait = () => { this.pending = { precise, ...(this.then ? { then: this.then } : {}) }; };
    if (!this.h.consent) { wait(); this.h.askConsent(); return; }
    const opts = await directOpts(this.h.meta);
    if (!opts || !this.h.hasKey) { wait(); this.h.askKey('Claude API 키가 있어야 손글씨를 읽을 수 있어요. 키를 저장하면 이어서 읽을게요.'); return; }
    this.pending = null;
    const image = `data:image/png;base64,${img.base64}`;
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;
    const mark = this.then ? { then: this.then } : {};
    this.h.patch({ ocr: { step: 'running', image, text: this.h.ocr?.text ?? '', confidence: 0, precise, ...mark } });
    try {
      const { createDirectOcr } = await import('@dn/ai-pipeline/direct');
      const r = await createDirectOcr(opts)({ image: img.base64, mime: 'image/png', w: img.w, h: img.h, locale: 'ko' }, { signal: ac.signal, model: precise ? OCR_PRECISE_MODEL : OCR_MODEL });
      await addAiUsage(this.h.meta, r.usage, r.model).catch(() => {});
      if (ac.signal.aborted) return;
      if (!r.lines.length) { this.h.patch({ ocr: { step: 'error', image, text: '', confidence: 0, precise, ...mark, error: '인식된 글자가 없어요. 필기를 그대로 블록으로 묶어 둘 수 있어요.' } }); return; }
      const text = r.lines.map((l) => l.text).join('\n');
      this.h.inkRead(img.ids, text); // 글 상자로 바꾸지 않고 닫아도 필기가 검색에 걸리게
      // 'AI로 구조화'이고 잘 읽혔으면 미리보기 없이 바로 구조화 (짧으면 미리보기 — 글 상자로 바꾸기를 권한다).
      // 정밀 인식은 미리보기에서 다시 읽어 달라고 누른 것 — 바로 구조화하지 않고 새 결과를 보여 준다 (교차 검토 B6)
      if (this.then === 'structure' && !precise && r.overallConfidence >= STRUCTURE_MIN_CONFIDENCE && longEnough(text)) { this.structure(text); return; }
      this.h.patch({ ocr: { step: 'done', image, text, confidence: r.overallConfidence, precise, ...mark } });
    } catch (e) {
      if (ac.signal.aborted || (e instanceof AiError && e.code === 'aborted')) return;
      this.h.patch({ ocr: { step: 'error', image, text: '', confidence: 0, precise, ...mark, error: e instanceof AiError ? aiErrorMessage(e).text : '손글씨를 읽지 못했어요. 다시 시도해 주세요.' } });
    }
  }

  /** 동의 · 키 창이 끝난 뒤: 동의 · 저장했으면(ok) 기다리던 읽기를 이어서, 닫았으면 잊는다 — 이어서 했나 */
  resume(ok: boolean): boolean {
    const p = this.pending;
    this.pending = null;
    if (!ok || !p) return false;
    void this.start(p.precise, p.then, true);
    return true;
  }

  /** 미리보기에서 고친 글을 그 획들의 검색 글로 — 읽은 직후 넣은 OCR 원문을 바꾼다 (교차 검토 B4) */
  private remember(text: string | undefined): void {
    const img = this.img, st = this.h.ocr;
    if (img && st?.step === 'done' && text?.trim() && text !== st.text) this.h.inkRead(img.ids, text);
  }

  /** 읽은 글을 구조화 (FR-039) — 결과는 필기 오른쪽(A4 용지면 필기 아래), 필기는 그대로 둔다 */
  structure(text: string): void {
    const view = this.h.view, img = this.img;
    if (!view || !img) return;
    // 짧으면 창을 닫지 않는다 — 읽은 글을 잃지 않게
    if (!longEnough(text)) { this.h.toast('구조화하기엔 글이 짧아요. 글 상자로 바꾸거나 필기를 더 골라 주세요.'); return; }
    this.remember(text);
    const b = img.bounds;
    const at = view.engine.note.sheet ? { x: SHEET_PAD, y: b.y + b.h + 40 } : { x: b.x + b.w + 120, y: b.y };
    view.ink.selected.clear();
    view.setTool(view.homeTool === 'lasso' ? 'select' : view.homeTool);
    this.close();
    this.h.structure(text, at);
  }

  /** 미리보기의 글로 상자 만들기 — removeInk면 필기를 지운다(바꾸기), 아니면 남긴다(추가) */
  apply(text: string, removeInk: boolean): void {
    const view = this.h.view, img = this.img;
    if (!view || !img) return;
    this.remember(text);
    const lines = text.split('\n');
    const w = Math.max(160, img.bounds.w);
    // 남기면 필기 아래에, 바꾸면 필기 자리에
    const at = removeInk ? img.bounds : { ...img.bounds, y: img.bounds.y + img.bounds.h + 12 };
    const r = inkToText(view.engine, img.ids, lines, at, { removeInk, h: view.measureText(ocrLinesDoc(lines), w) });
    if (!r.ok) { this.h.toast('글 상자를 만들지 못했어요.'); return; }
    view.ink.selected.clear();
    view.setTool(view.homeTool === 'lasso' ? 'select' : view.homeTool);
    view.select([r.value]);
    this.close();
    this.h.toast(removeInk ? '손글씨를 글로 바꿨어요. 되돌리려면 Ctrl+Z.' : '손글씨 아래에 글 상자를 넣었어요.');
  }

  /** 신뢰도가 낮을 때: 필기를 그대로 블록으로 묶기 (FR-037) — text: 미리보기에서 고친 글 */
  bindInstead(text?: string): void {
    const view = this.h.view;
    if (view) bindSelectedInk(view);
    this.close(text);
  }

  /** text: 미리보기에서 고친 글 — 글 상자로 바꾸지 않고 닫아도 고친 글로 찾히게 */
  close(text?: string): void {
    this.remember(text);
    this.abort?.abort();
    this.abort = null;
    this.pending = null;
    this.h.patch({ ocr: null });
  }
}
