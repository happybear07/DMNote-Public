# ADR-0008: 서버는 Cloudflare + Supabase 관리형 구성

| 항목 | 내용 |
|---|---|
| 상태 | 승인 (2026-10-01, 설계 마무리 위임에 따라 추천안 채택) |
| 날짜 | 2026-10-01 |
| 결정자 | 곰탱이 (제안: 설계 문서 작성 시) |

## 맥락

서버가 할 일은 인증, AI 프록시, 동기화 중계 · 영속, 첨부 저장, 계정 메타 관리뿐이다. 한 달 일정의 1인 개발이라 서버 운영(패치 · 스케일 · 모니터링)을 할 여유가 없다.

## 결정

Cloudflare Workers(Edge API) · Durable Objects(문서별 SyncRoom, 내장 SQLite) · R2(첨부 · 체크포인트) + Supabase Auth · Postgres(RLS) · Vault. 직접 운영하는 서버는 두지 않는다.

## 결과

- 두 벤더에 의존하지만 서버는 불투명 중계뿐이라 교체 비용이 낮다.
- 사용자 1명 규모에서는 비용이 거의 0이다.
- Worker · DO 로컬 개발은 wrangler/Miniflare, DB는 supabase CLI로 재현한다.

## 검토한 대안

- Hocuspocus + Postgres on Fly.io — 상시 컨테이너 운영
- Supabase Realtime으로 Yjs 중계 — 어댑터 성숙도
- Firebase — 문서 크기 · 과금 구조 불일치

## 참조

- ARCHITECTURE.md 4·6장
