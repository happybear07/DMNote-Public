// DamianNote 서비스 워커 (D1 설치형 PWA · ARCHITECTURE 9.3). 빌드 때 vite.config.ts가 버전 · 파일 목록 자리표시자를 채워 dist/sw.js로 낸다.
// 앱 셸(index.html + 해시 자산)을 버전별 캐시에 미리 받아 두고 캐시 먼저 응답한다 — 오프라인에서도 열리고,
// 열린 탭은 자기 버전의 파일만 받는다(옛 JS + 새 자산이 섞이지 않음). 새 버전은 받아 둔 채 기다리다가
// 앱의 "다시 열기"(skip-waiting 메시지)로 바뀐다. 노트 데이터는 IndexedDB 몫이라 여기서 다루지 않는다.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `dn-shell-${VERSION}`;
const FONT_CACHE = 'dn-fonts-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('dn-shell-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Claude API 등 외부 요청은 그대로
  if (/^\/(terms|privacy|ai)(\.html)?$/.test(url.pathname)) return; // 법적 문서 정적 페이지 — 앱 셸로 바꾸지 않는다 (legal-pages.ts)
  if (url.pathname.startsWith('/fonts/')) {
    // 글씨체(Pretendard 분할 92개 · 3.2MB)는 미리 다 받지 않고 쓰는 조각만 받아 둔다. 버전과 무관해 새 배포에도 지우지 않는다
    e.respondWith(caches.open(FONT_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (/\/(stt-worker|ort-wasm)[^/]*$/.test(url.pathname)) {
    // 받아쓰기 엔진 (FR-044): 미리 받지 않고 처음 쓸 때 받아 둔다 — 이름에 해시가 있어 버전이 바뀌면 새 파일 (vite.config.ts STT_ASSET)
    e.respondWith(caches.open('dn-stt-v1').then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (req.mode === 'navigate') {
    // 어느 경로 · 해시로 들어와도 앱 셸 하나 (해시 블록 링크 #n=…&b=…)
    e.respondWith(caches.open(CACHE).then((c) => c.match('./')).then((hit) => hit ?? fetch(req)));
    return;
  }
  e.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true })).then((hit) => hit ?? fetch(req)));
});
