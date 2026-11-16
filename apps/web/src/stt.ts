// 녹음 받아쓰기 엔진 (FR-044, 10/29 사용자 결정: 기기 안 Whisper) — 소리는 이 기기 밖으로 나가지 않는다.
// 녹음 파일 → 16kHz 모노로 풀기(decodeAudio) → 조용한 곳에서 30초 안쪽 구간으로 자르기(cutWindows, 거의 조용한 구간은 건너뜀 —
// Whisper가 무음에 "감사합니다"를 지어내지 않게) → 워커(stt-worker.ts)의 transformers.js Whisper가 구간마다 받아쓴다(진행률 · 취소).
// 모델은 처음 한 번 Hugging Face에서 내려받아 브라우저 캐시에 둔다(약 250MB, 그 뒤로는 오프라인). 받은 구간 → 문단(segmentsToDoc).
import type { TextDoc, TextNode } from '@dn/engine-core';

export const STT_RATE = 16000;
/** 받아쓰기 모델 — 버전(커밋)을 고정한다: 같은 결과 · 바뀐 파일이 끼어들지 않게 */
export const STT_MODEL = { id: 'onnx-community/whisper-small', revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732', dtype: 'q8', approxMB: 250 } as const;

/** 받아쓰기 언어 — 자동 감지는 Whisper가 30초 구간마다 언어를 고른다(한국어에 영어 낱말이 섞인 강의는 '한국어'가 낫다) */
export type SttLang = 'korean' | 'english' | 'auto';
export const STT_LANGS: readonly { readonly id: SttLang; readonly label: string }[] = [{ id: 'korean', label: '한국어' }, { id: 'english', label: '영어' }, { id: 'auto', label: '자동 감지' }];

export interface SttSegment { readonly start: number; readonly end: number; readonly text: string }
export interface SttProgress {
  /** download: 모델 내려받는 중(처음 한 번) · transcribe: 받아쓰는 중 */
  readonly stage: 'download' | 'transcribe';
  /** 0 ~ 1 */
  readonly pct: number;
  readonly loaded?: number;
  readonly total?: number;
}
export interface SttEngine {
  transcribe(audio: Float32Array, opts: { language: SttLang; onProgress?: (p: SttProgress) => void; signal?: AbortSignal }): Promise<SttSegment[]>;
}

/** 녹음 파일 → 16kHz 모노 (브라우저가 읽을 수 있는 소리면 무엇이든 — webm · m4a · ogg · mp3 · wav) */
export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const data = await blob.arrayBuffer();
  let buf: AudioBuffer;
  try {
    const ctx = new AudioContext({ sampleRate: STT_RATE });
    try { buf = await ctx.decodeAudioData(data); } finally { void ctx.close(); }
  } catch {
    // 16kHz 문맥을 못 여는 브라우저 — 원래 빠르기로 풀고 다시 표본
    const ctx = new AudioContext();
    let raw: AudioBuffer;
    try { raw = await ctx.decodeAudioData(data); } finally { void ctx.close(); }
    const off = new OfflineAudioContext(1, Math.ceil(raw.duration * STT_RATE), STT_RATE);
    const src = off.createBufferSource();
    src.buffer = raw;
    src.connect(off.destination);
    src.start();
    buf = await off.startRendering();
  }
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < out.length; i++) out[i]! += ch[i]! / buf.numberOfChannels; }
  return out;
}

const rms = (a: Float32Array, s: number, e: number) => { let x = 0; for (let i = s; i < e; i++) x += a[i]! * a[i]!; return Math.sqrt(x / Math.max(1, e - s)); };

/**
 * 받아쓸 구간 [시작, 끝) 표본 위치. 먼저 말이 있는 곳만 고른다 — 0.1초마다 소리 크기를 재(전체의 5% · 0.003 미만은 쉼),
 * 1.5초 넘게 쉬면 끊고 앞뒤로 0.2초씩 둔다(긴 쉼을 Whisper에 넣지 않게). 그 안을 maxSec 안쪽으로 — 끝은 마지막 3초 안에서
 * 가장 조용한 0.1초에 맞춰 낱말이 잘리지 않게. 0.25초보다 짧은 조각은 뺀다
 */
export function cutWindows(a: Float32Array, rate = STT_RATE, maxSec = 28): [number, number][] {
  const max = Math.floor(maxSec * rate), look = 3 * rate, step = Math.floor(rate / 10), pad = Math.floor(rate / 5);
  const quiet = Math.max(0.003, rms(a, 0, a.length) * 0.05);
  const regions: [number, number][] = [];
  for (let p = 0; p < a.length; p += step) {
    if (rms(a, p, Math.min(a.length, p + step)) < quiet) continue;
    const s = Math.max(0, p - pad), e = Math.min(a.length, p + step + pad), last = regions[regions.length - 1];
    if (last && s - last[1] < 1.5 * rate) last[1] = e; else regions.push([s, e]);
  }
  const out: [number, number][] = [];
  for (const [rs, re] of regions) {
    for (let s = rs; s < re;) {
      let e = Math.min(re, s + max);
      if (e < re) {
        let best = e, low = Infinity;
        for (let p = e - look; p + step <= e; p += step) { const v = rms(a, p, p + step); if (v < low) { low = v; best = p + Math.floor(step / 2); } }
        e = Math.max(s + rate, best);
      }
      if (e - s >= rate / 4) out.push([s, e]);
      s = e;
    }
  }
  return out;
}

/** 받은 구간 → 받아쓴 글: 맨 위 제목3, 문단마다 앞에 재생 시각 칩(누르면 그 시점부터). 쉼 1.5초 이상 · 220자가 넘으면 새 문단, 바로 앞과 같은 말은 버린다 */
export function segmentsToDoc(segs: readonly SttSegment[], ref: string, title: string): TextDoc {
  const paras: { t: number; text: string }[] = [];
  let prevEnd = -Infinity, prevText = '';
  for (const s of segs) {
    const text = s.text.trim();
    if (!text || text === prevText) continue;
    const cur = paras[paras.length - 1];
    if (!cur || s.start - prevEnd >= 1.5 || cur.text.length >= 220) paras.push({ t: s.start, text });
    else cur.text += ` ${text}`;
    prevEnd = s.end; prevText = text;
  }
  const head: TextNode = { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: title }] } as TextNode;
  const body = paras.map((p): TextNode => ({ type: 'paragraph', content: [{ type: 'media_time', attrs: { t: Math.floor(p.t), ref } }, { type: 'text', text: ` ${p.text}` }] }) as TextNode);
  return { type: 'doc', content: [head, ...(body.length ? body : [{ type: 'paragraph', content: [{ type: 'text', text: '(알아들을 말이 없었어요)' }] } as TextNode])] } as TextDoc;
}


type FromWorker =
  | { type: 'load'; loaded: number; total: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'segments'; segs: SttSegment[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** 기기 안 Whisper — 워커 하나를 띄워 두고 다시 쓴다(모델을 한 번만 읽는다). 취소하면 워커를 끝낸다(다음엔 캐시에서 다시 읽음) */
export function whisperEngine(): SttEngine {
  let worker: Worker | null = null;
  return {
    transcribe(audio, opts) {
      const windows = cutWindows(audio);
      if (!windows.length) return Promise.resolve([]);
      worker ??= new Worker(new URL('./stt-worker.ts', import.meta.url), { type: 'module', name: 'dn-stt' });
      const w = worker;
      return new Promise<SttSegment[]>((resolve, reject) => {
        const segs: SttSegment[] = [];
        const stop = () => { w.removeEventListener('message', on); w.removeEventListener('error', fail); opts.signal?.removeEventListener('abort', abort); };
        const abort = () => { stop(); w.terminate(); if (worker === w) worker = null; reject(new DOMException('취소', 'AbortError')); };
        const fail = (e: ErrorEvent) => { stop(); w.terminate(); if (worker === w) worker = null; reject(new Error(e.message || '받아쓰기 엔진 오류')); };
        const on = (e: MessageEvent<FromWorker>) => {
          const m = e.data;
          if (m.type === 'load') opts.onProgress?.({ stage: 'download', pct: m.total ? m.loaded / m.total : 0, loaded: m.loaded, total: m.total });
          else if (m.type === 'progress') opts.onProgress?.({ stage: 'transcribe', pct: m.done / m.total });
          else if (m.type === 'segments') segs.push(...m.segs);
          else if (m.type === 'done') { stop(); resolve(segs); }
          else if (m.type === 'error') { stop(); reject(new Error(m.message)); }
        };
        w.addEventListener('message', on);
        w.addEventListener('error', fail);
        if (opts.signal?.aborted) { abort(); return; }
        opts.signal?.addEventListener('abort', abort, { once: true });
        w.postMessage({ type: 'run', audio, windows, language: opts.language === 'auto' ? null : opts.language, model: STT_MODEL }, [audio.buffer]);
      });
    },
  };
}
