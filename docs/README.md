# DamianNote 설계 문서

자유 배치 캔버스 · AI 자동 구조화 · 펜 필기를 얹은 local-first 노트앱 DamianNote의 설계 문서입니다.
포트폴리오 공개본이라 제품 기획(PRD · 기능 명세 · 로드맵) · 조사 · QA 기록은 빠져 있고, 본문에서 그 문서를 가리키는 곳은 링크 없이 이름만 남아 있습니다.

| 문서 | 내용 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 시스템 아키텍처(코드 기준): 컨텍스트 · 컨테이너 · 컴포넌트 · 핵심 모델과 불변식 · 런타임 · 저장소 · 품질 게이트 |
| [CODE-STRUCTURE.md](CODE-STRUCTURE.md) | 코드 지도: 저장소 트리 · 패키지 의존 · 모듈 · 편집 한 번의 길 · 무엇을 고치려면 어디를 |
| [ENTITY-DIAGRAM.md](ENTITY-DIAGRAM.md) | 엔티티 다이어그램: 저장 계층 · 노트 문서 · 콘텐츠 종류 · 데이터베이스 · Y.Doc |
| [ENGINE.md](ENGINE.md) | 캔버스 엔진 상세: 문서 모델 · 트랜잭션 · 렌더러 · 입력 · 배치 · 도킹 · 잉크 · 저장 |
| [DATABASE.md](DATABASE.md) | 데이터 설계: 스냅샷 필드 · IndexedDB · 잠금 암호화 · 파일 형식 · 마이그레이션 |
| [SYNC.md](SYNC.md) | 동기화: 지금 구현된 것(Yjs 다리 · 탭 · 동기화 파일)과 서버 동기화 설계 |
| [API.md](API.md) | AI 출력 스키마 · 동기화 프로토콜 · 내부 모듈 계약 |
| [AI-PROMPTS.md](AI-PROMPTS.md) | AI 프롬프트 설계: 단계별 프롬프트 · 청킹 · 교정 · 인젝션 방어 · 평가 |
| [UX-FLOW.md](UX-FLOW.md) | 정보 구조 · 화면 내비게이션 · 핵심 사용자 흐름 · 상호작용 규칙 · 단축키 · 접근성 |
| [MESSAGES.md](MESSAGES.md) | 사용자에게 보이는 문구 · 오류 코드 → 문구 매핑 |
| [PEN-SPEC.md](PEN-SPEC.md) | 펜 필기 명세 |
| [SLASH-COMMANDS.md](SLASH-COMMANDS.md) | 슬래시 명령 목록 (앱이 이 파일을 직접 읽는다) |
| [STRUCTURE-GUIDE.md](STRUCTURE-GUIDE.md) | AI 구조화가 쓰는 논리 구조 도식 가이드 |
| [TEST-PLAN.md](TEST-PLAN.md) | 테스트 수준 · 게이트 · e2e · AI 평가 |
| [DEV-GUIDE.md](DEV-GUIDE.md) | 저장소 구조 · 코드 규칙 · CI · 완료 기준 |
| [adr/](adr/README.md) | 아키텍처 결정 기록 14건 |

AI 평가 세트는 [eval/README.md](../eval/README.md), 프롬프트 · 스키마 원본은 `packages/ai-pipeline/prompts/` · `packages/ai-pipeline/schemas/`에 있습니다.
문서 속 mermaid 그림 검사: `corepack pnpm docs:check`.
