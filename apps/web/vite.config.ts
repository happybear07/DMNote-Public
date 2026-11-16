import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import { deployHeaders } from './deploy-headers';
import { devUnfurl } from './dev-unfurl';
import { legalPages } from './legal-pages';

/** 받아쓰기 엔진 파일 (stt-worker 묶음 · onnxruntime wasm) — sw.template.js의 같은 규칙과 맞춘다 */
const STT_ASSET = /(^|\/)(stt-worker|ort-wasm)[^/]*$/;

/** 손으로 쓴 서비스 워커에 이번 빌드의 파일 목록 · 버전을 채워 dist/sw.js로 낸다 (의존성 추가 없이, 배포 QA F) */
function serviceWorker(): Plugin {
  const PUBLIC = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];
  return {
    name: 'dn-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      // index.html은 './'로 받는다. 법적 문서 페이지(terms.html 등, legal-pages.ts)는 앱 셸이 아니라 넣지 않는다.
      // 받아쓰기 엔진(워커 · ONNX 실행 파일 약 15MB)은 쓰는 사람만 — 미리 받지 않고 처음 쓸 때 받아 둔다(sw.template.js dn-stt)
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && !f.endsWith('.html') && !STT_ASSET.test(f)).sort();
      const precache = ['./', ...files, ...PUBLIC];
      const hash = createHash('sha256');
      for (const f of files) { const b = bundle[f]!; hash.update(f).update(b.type === 'chunk' ? b.code : b.source); }
      const src = readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

/** 저장소 루트 — `.env.local`을 여기에 둔다 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * 개발용 Claude 키 프록시: `.env.local`의 ANTHROPIC_API_KEY를 개발 서버(Node)만 읽고, 앱이 보낸 `/anthropic/*` 요청에 붙여
 * api.anthropic.com으로 넘긴다. 키는 브라우저 · 번들에 들어가지 않는다(앱은 가짜 키로 요청하고 여기서 바꿔 끼운다).
 * `vite build`(배포)에는 프록시가 없으므로 이 경로는 개발 · 미리보기에서만 쓰인다 — 배포에서는 설정 화면의 키(BYOK) 또는 Edge 프록시(FR-104).
 */
function anthropicProxy(key: string): Record<string, ProxyOptions> {
  return {
    '/anthropic': {
      target: 'https://api.anthropic.com',
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/anthropic/, ''),
      configure: (proxy) => {
        proxy.on('proxyReq', (req) => {
          req.setHeader('x-api-key', key);
          // 서버에서 보내는 요청이라 브라우저 직접 호출 표시는 떼어 낸다
          req.removeHeader('anthropic-dangerous-direct-browser-access');
          req.removeHeader('origin');
          req.removeHeader('referer');
        });
      },
    },
  };
}

export default defineConfig(({ command, isPreview }) => {
  const env = loadEnv('', ROOT, '');
  const key = env.ANTHROPIC_API_KEY?.trim() ?? '';
  const useEnvKey = command === 'serve' && !isPreview && key.startsWith('sk-ant-'); // 미리보기 서버에는 키를 걸지 않는다 (보안 3-8)
  const proxy = useEnvKey ? anthropicProxy(key) : undefined;
  return {
    envDir: ROOT,
    plugins: [react(), serviceWorker(), deployHeaders(env), devUnfurl(), legalPages()],
    // 받아쓰기(stt-worker.ts)는 CPU(wasm) 판 ONNX만 — WebGPU 판 실행 파일(27MB)은 배포처 파일 상한(25MiB)을 넘는다
    // 묶음판(ort.wasm.bundle)은 개발 서버가 변환하다 깨뜨려 워커가 안 뜬다 — 실행 파일(mjs)을 wasmPaths로 따로 읽는 판으로
    resolve: { alias: [{ find: /^onnxruntime-web\/webgpu$/, replacement: fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', import.meta.url)) }] },
    worker: { format: 'es' },
    // 미리 묶으면 개발 서버가 /@vite/client를 끼워 넣어 워커에서 안 돈다 (transformers.js 안내)
    optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web'] },
    // 앱에는 "env 키가 있다 · 끝 4자리"만 알린다 (키 자체는 절대 넣지 않는다)
    define: { __DN_ENV_KEY__: JSON.stringify(useEnvKey ? { last4: key.slice(-4) } : null) },
    server: { port: 5173, strictPort: true, ...(proxy ? { proxy } : {}) },
    preview: {},
  };
});
