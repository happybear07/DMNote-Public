// 법적 문서 목록 (LEGAL-RISK R1, 2026-10-26) — 앱 안 창(LegalDialog)과 빌드 때 정적 페이지(/terms · /privacy · /ai, legal-pages.ts)가 같이 쓴다.
export type LegalId = 'terms' | 'privacy' | 'ai';

export const LEGAL_DOCS: readonly { id: LegalId; title: string; path: string; file: string }[] = [
  { id: 'terms', title: '이용약관', path: '/terms', file: 'terms.md' },
  { id: 'privacy', title: '개인정보 처리방침', path: '/privacy', file: 'privacy.md' },
  { id: 'ai', title: 'AI 이용 안내', path: '/ai', file: 'ai.md' },
];

export const legalTitle = (id: LegalId): string => LEGAL_DOCS.find((d) => d.id === id)!.title;
/** 문서 속 링크 주소(/ai 등) → 문서 id (다른 주소면 undefined) */
export const legalIdOf = (path: string): LegalId | undefined => LEGAL_DOCS.find((d) => d.path === path)?.id;

/** 출시 전에 채워야 하는 자리표시자 — 빌드가 남은 것을 경고한다 */
export const LEGAL_PLACEHOLDER = /\[(?:운영자 이름|연락처 이메일)\]/g;
