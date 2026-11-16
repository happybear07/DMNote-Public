// 녹음 받아쓰기 흐름 (FR-044 · FR-046): 녹음 블록 → (처음이면 모델 내려받기 확인) → 기기 안 Whisper(stt.ts) → 녹음 블록 바로 아래 받아쓴 글.
// 문단마다 재생 시각 칩 — 누르면 그 시점부터 재생(seekMedia). 끝나면 '구조화하기' · '요약하기'(FR-046: 기존 AI 경로에 받아쓴 글을 넣는다).
// 실패 · 취소해도 녹음 파일은 그대로다(받아쓴 글만 안 생김). 받아쓰는 동안 다른 노트로 가도 끝나면 그 노트로 돌아가 넣는다.
import { insertTextBelow, isTextContent, mediaKind, type Engine, type Id, type TextDoc } from '@dn/engine-core';
import type { AttachmentStore, MetaStore } from '@dn/storage-idb';
import { decodeAudio, segmentsToDoc, STT_MODEL, whisperEngine, type SttEngine, type SttLang } from './stt';

/** 받아쓰기 상태 — ask: 처음 한 번 모델 내려받기 확인 · download: 모델 받는 중 · decode: 녹음 풀기 · transcribe: 받아쓰는 중 */
export interface SttState { noteId: string; blockId: string; lang: SttLang; step: 'ask' | 'decode' | 'download' | 'transcribe'; pct: number; loaded?: number; total?: number }

interface Host {
  readonly engine: Engine | null;
  readonly noteId: string | null;
  readonly files: AttachmentStore;
  readonly meta: MetaStore;
  readonly stt: SttState | null;
  patch(p: { stt: SttState | null }): void;
  toast(t: string, action?: { label: string; run: () => void }, alt?: { label: string; run: () => void }): void;
  canWrite(): boolean;
  openNote(id: string): Promise<void>;
  measure(doc: TextDoc, w: number): number;
  /** 받아쓴 글로 이어서 (FR-046) — 그 블록 구조화 · 노트 요약(결정 · 할 일 체크박스) */
  structure(blockId: Id): void;
  summarize(): void;
}

const READY = 'sttModelReady';
/** 마지막으로 고른 받아쓰기 언어 (녹음을 마친 알림에서 바로 받아쓸 때 이 언어로) */
const LANG = 'sttLanguage';
const modelKey = `${STT_MODEL.id}@${STT_MODEL.revision}:${STT_MODEL.dtype}`;

/** 노트 안의 녹음 재생기를 찾아 t초부터 재생 — from(누른 칩)에서 가장 가까운 것부터(문서 뷰 뒤에도 캔버스 재생기가 남아 있다). 없으면 false */
export function seekMedia(ref: string, t: number, from?: Element | null): boolean {
  const sel = `[data-part="${CSS.escape(ref)}"] .dn-media-player`;
  let p: HTMLMediaElement | null = null;
  for (let el = from?.parentElement ?? null; el && !p; el = el.parentElement) p = el.querySelector<HTMLMediaElement>(sel);
  p ??= document.querySelector<HTMLMediaElement>(sel);
  if (!p) return false;
  const go = () => { p.currentTime = t; void p.play().catch(() => {}); };
  // 브라우저 녹음(webm)은 길이를 늦게 안다 — 길이를 안 뒤에 옮겨야 처음으로 되돌려지지 않는다 (rich-render.ts)
  if (p.readyState >= 1 && Number.isFinite(p.duration)) go();
  else p.addEventListener('durationchange', function wait() { if (!Number.isFinite(p.duration)) return; p.removeEventListener('durationchange', wait); setTimeout(go, 0); });
  return true;
}

export class SttCtl {
  /** 받아쓰기 엔진 — e2e는 가짜로 바꿔 끼운다 (모델 250MB를 받지 않게) */
  engine: SttEngine = whisperEngine();
  private abort: AbortController | null = null;
  constructor(private readonly h: Host) {}

  /** 이 녹음 블록을 글로 받아쓰기 — 처음이면 모델 내려받기부터 묻는다. lang을 주면 다음에도 그 언어로 */
  async start(blockId: Id, lang?: SttLang): Promise<void> {
    const e = this.h.engine, noteId = this.h.noteId;
    if (!e || !noteId || !this.h.canWrite()) return;
    if (this.h.stt && this.h.stt.step !== 'ask') { this.h.toast('이미 받아쓰는 중이에요.'); return; }
    if (!audioOf(e, blockId)) { this.h.toast('받아쓸 녹음을 찾지 못했어요.'); return; }
    if (lang) await this.h.meta.setSetting(LANG, lang);
    const l = lang ?? (await this.h.meta.getSetting<SttLang>(LANG)) ?? 'korean';
    const ready = (await this.h.meta.getSetting<string>(READY)) === modelKey;
    if (!ready) { this.h.patch({ stt: { noteId, blockId, lang: l, step: 'ask', pct: 0 } }); return; }
    await this.run(noteId, blockId, l);
  }

  /** 모델 내려받기 확인 → 받아쓰기 */
  confirm(): void {
    const s = this.h.stt;
    if (s?.step === 'ask') void this.run(s.noteId, s.blockId, s.lang);
  }

  cancel(): void {
    const asked = this.h.stt?.step === 'ask';
    this.abort?.abort();
    this.abort = null;
    this.h.patch({ stt: null });
    if (!asked) this.h.toast('받아쓰기를 멈췄어요. 녹음은 그대로예요.');
  }

  private async run(noteId: string, blockId: Id, lang: SttLang): Promise<void> {
    const e = this.h.engine;
    const audio = e && audioOf(e, blockId);
    if (!audio) return;
    const ac = new AbortController();
    this.abort?.abort();
    this.abort = ac;
    const step = (s: Omit<SttState, 'noteId' | 'blockId' | 'lang'>) => { if (this.abort === ac) this.h.patch({ stt: { noteId, blockId, lang, ...s } }); };
    step({ step: 'decode', pct: 0 });
    try {
      const file = await this.h.files.get(audio.hash);
      if (!file) throw new Error('녹음 파일이 없어요');
      const samples = await decodeAudio(file.blob);
      if (ac.signal.aborted) return;
      const segs = await this.engine.transcribe(samples, {
        language: lang, signal: ac.signal,
        onProgress: (p) => step({ step: p.stage, pct: p.pct, ...(p.total ? { loaded: p.loaded ?? 0, total: p.total } : {}) }),
      });
      if (ac.signal.aborted) return;
      await this.h.meta.setSetting(READY, modelKey);
      this.abort = null;
      this.h.patch({ stt: null });
      await this.place(noteId, blockId, segmentsToDoc(segs, audio.contentId, `받아쓴 글 — ${audio.name}`));
    } catch (err) {
      if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      this.abort = null;
      this.h.patch({ stt: null });
      this.h.toast(`받아쓰지 못했어요 — 녹음은 그대로예요. (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  /** 녹음 블록 바로 아래에 받아쓴 글 — 다른 노트로 갔으면 그 노트로 돌아가서 */
  private async place(noteId: string, blockId: Id, doc: TextDoc): Promise<void> {
    if (this.h.noteId !== noteId) await this.h.openNote(noteId);
    const e = this.h.engine;
    if (!e || this.h.noteId !== noteId || !e.getBlock(blockId) || !this.h.canWrite()) { this.h.toast('받아쓴 글을 넣을 녹음 블록이 없어요 (지워졌거나 보기 전용).'); return; }
    const r = insertTextBelow(e, blockId, doc, (w) => this.h.measure(doc, w), { label: '받아쓴 글 넣기' });
    if (!r.ok) { this.h.toast('받아쓴 글을 넣지 못했어요.'); return; }
    const n = doc.content.length - 1;
    this.h.toast(`받아썼어요 — 문단 ${n}개. 시각을 누르면 그 시점부터 들을 수 있어요.`,
      { label: '구조화하기', run: () => this.h.structure(r.value.blockId) }, { label: '요약하기', run: () => this.h.summarize() });
  }
}

/** 이 블록의 녹음(소리 파일) — 첨부 해시 · 콘텐츠 id · 이름(확장자 뺌) */
function audioOf(e: Engine, blockId: Id): { hash: string; contentId: Id; name: string } | null {
  for (const c of e.contentsOf(blockId)) {
    if (isTextContent(c) || c.type !== 'file') continue;
    const f = c as unknown as { id: Id; attachment: string; mime?: string; name?: string };
    if (mediaKind(f.mime ?? '') === 'audio') return { hash: f.attachment, contentId: f.id, name: (f.name ?? '녹음').replace(/\.[a-z0-9]+$/i, '') };
  }
  return null;
}

/** 이 블록에 받아쓸 녹음이 있나 (블록 메뉴) */
export const hasAudio = (e: Engine, blockId: Id): boolean => !!audioOf(e, blockId);
