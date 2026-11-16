# 아키텍처 결정 기록 (ADR)

DamianNote의 주요 아키텍처 결정. 형식은 Michael Nygard의 ADR 템플릿을 따른다. 승인된 ADR은 수정하지 않고, 결정이 바뀌면 새 ADR로 대체한다.

| ADR | 제목 | 상태 | 날짜 |
|---|---|---|---|
| [0001](0001-own-canvas-engine.md) | 캔버스 엔진을 직접 만든다 | 승인 | 2026-09-30 |
| [0002](0002-engine-model-is-source.md) | 엔진 자체 모델이 원본, Yjs는 복제 어댑터 | 승인 | 2026-10-01 |
| [0003](0003-hybrid-rendering.md) | 하이브리드 렌더링 (DOM 블록 + 캔버스 오버레이) | 승인 | 2026-10-01 |
| [0004](0004-indexeddb-snapshot-oplog.md) | 로컬 저장은 IndexedDB 스냅샷 + 연산 로그 | 승인 | 2026-10-01 |
| [0005](0005-app-shell-pwa.md) | 앱 셸은 설치형 PWA (D1) | 승인 | 2026-10-01 |
| [0006](0006-ui-shell-react.md) | UI 셸은 React, 캔버스는 엔진 바닐라 DOM | 승인 | 2026-10-01 |
| [0007](0007-ai-via-edge-proxy.md) | AI 호출은 Edge 프록시 경유, tool use로 출력 강제 | 승인 | 2026-10-01 |
| [0008](0008-backend-platform.md) | 서버는 Cloudflare + Supabase 관리형 구성 | 승인 | 2026-10-01 |
| [0009](0009-sync-document-granularity.md) | 동기화 단위는 노트당 Y.Doc 1개 + 워크스페이스 Y.Doc 1개 | 승인 | 2026-10-01 |
| [0010](0010-local-search-and-qa.md) | 검색 · Q&A 근거 검색은 클라이언트 인덱스 | 승인 | 2026-10-01 |
| [0011](0011-attachments-content-addressed.md) | 첨부는 OPFS + 내용 해시 키, R2 복제 | 승인 | 2026-10-01 |
| [0012](0012-no-e2ee-v1.md) | v1은 종단간 암호화 없이 전송 · 저장 암호화만 | 승인 | 2026-10-01 |
| [0013](0013-two-text-box-kinds.md) | 텍스트 상자 두 종류 (제목 상자 · 내용 상자) | 승인 | 2026-10-02 |
| [0014](0014-free-placement-docking.md) | 자유 배치 + 도킹, 자동 밀어내기 없음 (11/02 예외: 글이 늘면 아래 상자 레고 밀기) | 승인 · 고침 | 2026-10-02 · 11-02 |

상태: **승인** = 확정 · **대체됨** = 새 ADR로 교체 (2026-10-02 기준 14건 모두 승인)
