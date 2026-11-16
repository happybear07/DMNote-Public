// 받아쓰기 워커 (FR-044) — transformers.js Whisper를 화면과 떨어진 곳에서. stt.ts가 구간을 잘라 보낸다.
// ONNX 실행 파일(wasm)은 앱과 함께 배포한 것을 쓴다(CDN · blob 주소 없이 — CSP script-src 'self' 'wasm-unsafe-eval').
// CPU(wasm) 판만 쓴다: WebGPU 판 실행 파일은 27MB로 배포처 파일 상한(25MiB)을 넘는다 (vite.config.ts가 onnxruntime-web/webgpu → /wasm).
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

env.allowLocalModels = false;
env.useWasmCache = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };

interface Run {
  type: 'run';
  audio: Float32Array;
  windows: [number, number][];
  /** null이면 자동 감지 */
  language: string | null;
  model: { id: string; revision: string; dtype: string };
}

const RATE = 16000;
let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function load(m: Run['model']): Promise<AutomaticSpeechRecognitionPipeline> {
  // 파일마다 받은 양을 모아 한 진행률로 (config · tokenizer · encoder · decoder …)
  const files = new Map<string, { loaded: number; total: number }>();
  asr ??= pipeline('automatic-speech-recognition', m.id, {
    revision: m.revision, device: 'wasm', dtype: m.dtype as 'q8',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0, total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      postMessage({ type: 'load', loaded, total });
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  asr.catch(() => { asr = null; });
  return asr;
}

self.onmessage = async (e: MessageEvent<Run>) => {
  const r = e.data;
  if (r.type !== 'run') return;
  try {
    const run = await load(r.model);
    for (let i = 0; i < r.windows.length; i++) {
      const [s, end] = r.windows[i]!;
      const out = await run(r.audio.subarray(s, end), { ...(r.language ? { language: r.language } : {}), task: 'transcribe', return_timestamps: true });
      const one = Array.isArray(out) ? out[0]! : out;
      const t0 = s / RATE, t1 = end / RATE;
      const chunks: { timestamp: [number, number | null]; text: string }[] = one.chunks?.length ? one.chunks : [{ timestamp: [0, t1 - t0], text: one.text }];
      postMessage({ type: 'segments', segs: chunks.map((c) => ({ start: t0 + (c.timestamp[0] ?? 0), end: Math.min(t1, t0 + (c.timestamp[1] ?? t1 - t0)), text: c.text })) });
      postMessage({ type: 'progress', done: i + 1, total: r.windows.length });
    }
    postMessage({ type: 'done' });
  } catch (err) {
    postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
