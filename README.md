# DamianNote
Solo Project of Damian Ko

자유 배치 캔버스 · 노션식 블록 편집 · 펜 필기 · AI 자동 구조화를 한 노트에 담은 **local-first 노트앱**입니다.
노트는 기기 안(IndexedDB)에 먼저 저장되고, 계정 없이도 모든 기능을 쓸 수 있습니다.

> 이 저장소는 포트폴리오용 공개본입니다. 코드와 설계 문서는 그대로이고, 내부 기획 · 조사 · QA 기록은 뺐습니다.

## 주요 기능

| 영역 | 내용 |
|---|---|
| 캔버스 | 무한 캔버스 위 글 상자 · 표 · 그래프 · 이미지 · 데이터베이스를 자유 배치, 상자 묶음(블록) · 화살표 · 도킹 · 정렬 안내선 |
| 문서 보기 | 같은 노트를 워드처럼 쪽으로 보기 · 서식 막대 · 표지 쪽, 워드(.docx) 가져오기 · 내보내기 왕복 |
| 노트앱 기본기 | 폴더 · 태그 · 검색 · 노트 링크 · 휴지통 · 버전 · 댓글 · 리마인더 · 노트 잠금(암호화) · 슬래시 명령 · 수식(KaTeX) · Markdown · 노션 · CSV 가져오기 |
| 펜 필기 | 압력 잉크 · 형광펜 · 지우개 · 올가미, 펜을 쓰면 손가락은 화면 이동만(펜 전용), 손글씨 → 글 |
| AI | 붙여넣은 글(AI 답변 등)을 개념 상자 · 관계 화살표 · 표 · 그래프로 자동 구조화, 노트에 묻기 · 고치기 · 요약 — 사용자 키(BYOK)로 브라우저에서 직접 호출 |
| 받아쓰기 | 녹음을 기기 안 Whisper(onnxruntime-web)로 글로 — 소리를 밖으로 보내지 않음 |
| 홈 | 모든 노트를 책장에 꽂힌 천 표지 책으로 보여 주는 서재 · 달력 · 할 일 · 빠른 메모가 있는 내 페이지 |
| 동기화 | 같은 기기 탭 사이 실시간 반영(Yjs), 동기화 파일로 기기 사이 옮기기 |

## 기술 스택

- **TypeScript** 모노레포 (pnpm workspace), 앱 셸은 **React + Vite**
- **자체 캔버스 엔진** — 화면과 분리된 헤드리스 모델 · 트랜잭션 · 실행 취소(`engine-core`) + DOM/SVG 렌더러(`engine-dom`), 공간 색인은 R-tree(rbush)
- 글 편집은 **ProseMirror**, 수식은 **KaTeX**, 잉크는 **perfect-freehand**
- 저장은 **IndexedDB**(스냅샷 + 작업 기록), 동기화는 **Yjs**(CRDT)
- AI는 **Anthropic Claude**(tool use · JSON 스키마 출력), 기기 안 음성 인식은 **Transformers.js + onnxruntime-web**
- 테스트는 **Vitest**(단위 · 속성) + **Playwright-core**(브라우저 e2e 160여 개 스크립트) + Node 벤치

## 구조

```
apps/web               React 앱 셸 — 화면 · 메뉴 · 설정 · 가져오기/내보내기 · 작업 공간 상태
packages/engine-core   헤드리스 캔버스 엔진 — 문서 모델 · 트랜잭션 · 배치 · 도킹 · 실행 취소
packages/engine-dom    렌더러와 입력 — 상자 · 화살표 · 잉크 · 선택 · 확대/이동
packages/text-pm       ProseMirror 글 편집 — 스키마 · 서식 · 슬래시 명령 · 수식
packages/storage-idb   IndexedDB 저장 — 스냅샷 · 작업 기록 · 첨부 · 잠금 암호화
packages/search        기기 안 검색 색인
packages/sync          엔진 ↔ Yjs 다리 · 탭 동기화 · 동기화 파일
packages/ai-pipeline   AI 프롬프트 · 출력 스키마 · 결과를 캔버스 배치로 바꾸기
e2e/  eval/  bench/    브라우저 시험 · AI 평가 세트 · 성능 벤치
docs/                  설계 문서 (아키텍처 · 엔진 · 데이터 · 동기화 · API · ADR)
```

자세한 구조는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)와 [docs/CODE-STRUCTURE.md](docs/CODE-STRUCTURE.md)에 있습니다.

## 실행

Node 24 이상이 필요합니다.

```bash
corepack enable
corepack pnpm install
corepack pnpm dev        # http://localhost:5173
```

AI 기능은 앱의 설정에서 자신의 Anthropic API 키를 넣으면 동작합니다(키는 기기 안에만 저장). 개발 서버 프록시로 쓰려면 `.env.example`을 `.env.local`로 복사해 키를 넣습니다.

## 검사

| 명령 | 내용 |
|---|---|
| `corepack pnpm check` | 구조 검사 — 파일 400줄 이하 · 패키지 경계 · 금지 코드 · 비밀값 |
| `corepack pnpm typecheck` | 패키지별 타입 검사 |
| `corepack pnpm test` | 단위 · 속성 테스트 (Vitest) |
| `corepack pnpm e2e` | 브라우저 시험 (dev 서버를 먼저 띄움, `DN_URL` · `DN_CHANNEL`) |
| `corepack pnpm bench` | 성능 벤치 — 1만 상자 노트 열기 · 편집 예산 |

## 문서

설계 문서 목록은 [docs/README.md](docs/README.md)에 있습니다.

## 라이선스

Copyright © 2026 Damian Ko. All rights reserved.

포트폴리오 열람용으로 공개한 저장소입니다. 코드를 읽는 것은 자유지만, 허락 없이 복제 · 수정 · 재배포 · 상업적으로 이용할 수 없습니다.
포함된 제3자 글꼴 · 라이브러리(Pretendard 등)는 각자의 라이선스를 따릅니다.
