// 웹 북마크의 제목 · 설명 · 그림 모으기 (FR-050): 개발 · 미리보기 서버의 /api/unfurl (vite.config.ts · dev-unfurl.ts).
// 정적 배포에는 이 길이 없어(index.html이 돌아옴) null — 카드는 주소 · 사이트 이름만 보인다(FR-050 "수집 실패 시 일반 링크로").
import type { WebHost } from '@dn/engine-dom';
import type { WebMeta } from '@dn/engine-core';

export const webHost: WebHost = {
  async unfurl(url: string): Promise<WebMeta | null> {
    if (!import.meta.env.DEV && import.meta.env.VITE_E2E !== '1') return null; // 배포: 호출 안 함 (보안 5-2 · 법률 1.8 — 처리방침 미기재 전송)
    try {
      const r = await fetch(`/api/unfurl?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) return null;
      const m = (await r.json()) as Record<string, unknown>;
      const pick = (k: string) => (typeof m[k] === 'string' && m[k] ? (m[k] as string) : undefined);
      const out: WebMeta = { title: pick('title'), description: pick('description'), image: pick('image'), site: pick('site') };
      return out.title || out.description || out.image ? out : null;
    } catch {
      return null;
    }
  },
};
