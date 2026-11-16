# DamianNote 개발 가이드

| 항목 | 내용 |
|---|---|
| 문서 버전 | v0.2 (2026-10-02 — 실제 저장소 구조 · 스크립트 · CI · 로컬 개발 반영) |
| 작성일 | 2026-10-01 |
| 대상 | 개발자 본인 + AI 코딩 에이전트 |
| 관련 문서 | [ARCHITECTURE.md](ARCHITECTURE.md) · [ENGINE.md](ENGINE.md) 2.3 · 16장 · [TEST-PLAN.md](TEST-PLAN.md) |

저장소 구조, 코드 규칙, 브랜치 · 커밋 · 리뷰, CI/CD, 완료 기준(DoD), 그리고 한 달 일정의 전제인 "AI 에이전트 병렬 개발" 운영 규칙을 정한다.

---

## 1. 저장소 구조

```
damiannote/
├─ apps/
│  └─ web/                    # 앱 셸 (React 19 · Vite · PWA)
├─ packages/
│  ├─ contracts/              # 패키지 간 인터페이스 타입만 (구현 없음) — API.md 7절
│  ├─ engine-core/            # 헤드리스 엔진 (DOM 타입 금지)
│  ├─ engine-dom/             # renderer · input
│  ├─ text-pm/                # ProseMirror 코덱 · 바인딩
│  ├─ storage-idb/            # NoteStore IndexedDB 구현
│  ├─ app-meta/               # 폴더 · 태그 · 노트 메타 · 휴지통 · 설정
│  ├─ ai-pipeline/            # 청킹 · 프롬프트 · 스키마 · 매핑 · 배치 계획
│  │  ├─ prompts/             #   structure.v1.md …
│  │  └─ schemas/             #   structure.v1.json …
│  ├─ search/                 # 검색 워커
│  ├─ attachments/            # OPFS
│  ├─ io/                     # 가져오기 · 내보내기
│  ├─ sync-yjs/               # 동기화 워커 (P5)
│  └─ api-client/             # Edge API 클라이언트
├─ services/
│  └─ edge/                   # Cloudflare Worker + SyncRoom DO (wrangler)
├─ supabase/
│  ├─ migrations/             # NNNN_*.sql (전진 전용)
│  └─ seed.sql                # 로컬 · e2e 테스트 사용자
├─ bench/                     # FR-008 하네스 · synth 생성기
├─ eval/                      # AI 평가 세트 · 결과
├─ fixtures/                  # 노트 · AI 응답 · XSS 픽스처
├─ e2e/                       # Playwright
├─ docs/                      # 설계 문서 (이 폴더)
└─ scripts/                   # 트래커 검증 · 문서 생성 (tracker-data 공용 로더 · validate-tracker · build-docs)
```

위는 한 달 계획의 **목표 구조**다. **현재(2026-10-02) 실제 구조:**

```
damiannote/
├─ apps/web/                  # React 19 · Vite 6 (PWA 설정 전). App · workspace(노트 목록 · 휴지통 · 설정 · AI 흐름) · TrashPage · BlockMenu · SettingsDialog · AiPanels · ConfirmDialog
├─ packages/
│  ├─ engine-core/            # 모델 · Op/Tx · undo · 커맨드 · dock(도킹) · 직렬화(스키마 v3) · 공간 인덱스 · viewport
│  ├─ engine-dom/             # canvas-view.ts (렌더러 · 입력 · 도구 · 붙여넣기 · 스냅 안내선)
│  ├─ text-pm/                # ProseMirror 스키마 pm-v1 · 코덱 · 에디터(제목 · 내용 상자 모드) · markdown · paste 정화
│  ├─ storage-idb/            # dn-notes(note-store · session) · dn-app(meta-store: 노트 메타 · 폴더 · 태그 · 검색 문서 · 설정 · 비밀값)
│  ├─ search/                 # 검색 문서 추출(블록 글자 · 표 · 그래프 글자) · 메모리 색인 · 문맥 자르기 (FR-121). 아직 워커가 아니라 메인 스레드
│  └─ ai-pipeline/            # 프롬프트(prompts/*.md → gen:prompts → prompts.gen.ts) · 스키마 · 청킹 · 재시도 · transport(Edge SSE) · direct(BYOK, @anthropic-ai/sdk) · layout · apply
├─ bench/                     # run.ts · synth.ts · baseline.json · results/ (Node 24 타입 제거로 실행)
├─ e2e/                       # smoke.mjs · p1.mjs · ai.mjs · docs-check.mjs (playwright-core + 설치된 Edge)
├─ eval/structure/            # AI 평가 세트 12건 (*.md + *.expected.json)
├─ scripts/                   # tracker-data.js(공용 로더) · build-docs.js(문서 + feature-ids.json) · validate-tracker.js
├─ docs/ · prd-tracker.html · feature-ids.json
├─ .github/workflows/ci.yml   # 준비됨 (원격 저장소 연결 전)
└─ vitest.config.ts · vitest.setup.ts · tsconfig.base.json · pnpm-workspace.yaml
```

- 아직 없는 것: `contracts` · `app-meta`(노트 메타 · 폴더 · 태그는 storage-idb `meta-store.ts`에 구현) · `attachments` · `io` · `sync-yjs` · `api-client` · `services/edge` · `supabase/` · `fixtures/`(테스트 픽스처는 각 패키지 `test/` 안).
- `exports/`는 `.gitignore` 대상(로컬 내보내기 결과).
- 패키지 관리: pnpm workspaces. TypeScript 프로젝트 레퍼런스(`tsc -b`)로 패키지 경계를 빌드 단위로 강제한다. (현재는 루트 `pnpm typecheck`가 패키지마다 `tsc -p`를 차례로 돌린다.)
- 의존 규칙은 `.dependency-cruiser.cjs`에 ARCHITECTURE 5.1 그래프를 그대로 옮긴다. 위반하면 CI가 실패한다. (아직 미도입 — 지금은 engine-core의 `lib: ES2022`(DOM 타입 없음)와 api-surface 테스트가 경계를 지킨다.)

---

## 2. 코드 규칙

| 영역 | 규칙 |
|---|---|
| 언어 | TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| 포맷 · 린트 | Biome (포맷 + 린트 하나로). 커밋 전 훅으로 실행 |
| 이름 | 파일 kebab-case, 타입 PascalCase, 함수 · 변수 camelCase. 브랜드 타입(`BlockId`, `WorldPoint`)으로 의미 구분 |
| 오류 | 엔진 · 저장 계층은 `Result<T, E>` 반환. 예외는 프로그래머 오류에만 |
| 부작용 경계 | 순수 함수(모델 · 마이그레이션 · 매핑)와 I/O(IDB · fetch · DOM)를 파일 단위로 분리 |
| 금지 | `innerHTML` 직접 대입, `any`(경계 파싱 제외), 엔진 상태 직접 변이, 시계 기반 순서 판단, `console.log` 커밋 |
| 주석 | "왜"만 쓴다. 설계 근거가 길면 ENGINE.md · ADR 절 번호를 참조 |
| UI 문자열 | `t('key')` 경유. 한국어 기본 |
| 접근성 | 버튼 · 아이콘에 `aria-label`, 포커스 표시 제거 금지 |

---

## 3. AI 에이전트 병렬 개발 운영

한 달 계획은 여러 AI 코딩 에이전트가 동시에 작업한다는 전제다(ROADMAP 리스크). 통합 충돌을 막는 규칙:

1. **계약 먼저.** 각 Phase 시작 시 `packages/contracts`에 인터페이스 · 타입 · 이벤트 형태를 먼저 커밋한다. 계약 변경은 사람(본인)이 승인한다.
2. **소유 단위 = 패키지.** 에이전트 하나는 패키지 하나(또는 `apps/web`의 화면 폴더 하나)만 수정한다. 다른 패키지 수정이 필요하면 작업을 멈추고 요청을 남긴다.
3. **작업 지시서 형식.** 지시서에 담을 것:
   - 목표 FR id와 수락 기준
   - 수정 가능한 경로
   - 참조 문서의 절 번호
   - 완료 확인 명령(`pnpm -F <pkg> test`)
4. **브랜치 = 작업.** `agent/<pkg>/<FR-###>-<요약>` 브랜치에서 작업하고 PR로만 합친다.
5. **통합 주기.** 하루 1회(저녁) 통합 브랜치에서 전체 테스트 · e2e를 돌리고, 통과한 PR만 `main`에 머지한다.
6. **리뷰.** 에이전트 PR은 본인이 리뷰한다. 계약 · 저장 포맷 · 보안 관련 변경은 줄 단위로 읽는다. UI 세부는 스크린샷으로 확인한다.
7. **금지.** 에이전트가 할 수 없는 것:
   - 저장 포맷(`schemaVersion`) 변경
   - 마이그레이션 SQL
   - 비밀값 · CI 설정 · 의존성 추가

   이런 작업은 본인이 하거나 별도 승인한다.

---

## 4. 브랜치 · 커밋 · PR

| 항목 | 규칙 |
|---|---|
| 브랜치 모델 | 트렁크 기반. `main`은 항상 배포 가능. 작업 브랜치는 짧게(1~2일) |
| 브랜치 이름 | `feat/<FR-###>-<요약>`, `fix/<요약>`, `agent/<pkg>/<FR-###>-<요약>`, `docs/<요약>` |
| 커밋 메시지 | Conventional Commits + FR id: `feat(engine-core): block.delete 연쇄 삭제 (FR-015)` |
| PR 템플릿 | 관련 FR · 변경 요약 · 테스트 방법 · 스크린샷(UI) · 저장 포맷 영향 여부 · 체크리스트(DoD) |
| 머지 | Squash merge. CI 녹색 + 본인 승인 |
| 태그 | `v0.<주차>.<패치>` (예: `v0.2.0` = W2 말). 출시 판정 후 `v1.0.0` |

### 4.1 커밋 전 안전장치 (2026-10-03)

커밋할 때마다 `.githooks/pre-commit`이 자동으로 돈다. 하나라도 실패하면 **커밋이 만들어지지 않는다.** 새 의존성 없이 만들었다.

| 순서 | 검사 | 실패하는 경우 |
|---|---|---|
| 1 | `node scripts/check-arch.mjs --staged` — 구조 검사 | ① 소스 파일 하나가 **400줄 초과** (한 파일에 기능이 몰림) ② 패키지 경계 위반 — 예: engine-core가 다른 @dn 패키지를 import (허용 목록은 스크립트 맨 위 `ALLOWED`) ③ `console.log` · `innerHTML =` ④ `.env` 파일이나 Claude 키처럼 보이는 문자열(`sk-ant-…`)을 커밋하려 함 |
| 2 | `corepack pnpm typecheck` | 타입 오류 |
| 3 | `corepack pnpm test` | 단위 · 속성 테스트 실패 |
| + | `prd-tracker.html`을 바꿨으면 `validate:tracker` | 트래커 데이터 오류 |

- 켜기(저장소를 새로 받았을 때 한 번): `corepack pnpm hooks:install` (= `git config core.hooksPath .githooks`)
- 손으로 한 번에 돌리기: `corepack pnpm verify` (구조 + 타입 + 단위). 구조만: `corepack pnpm check`
- 브라우저 e2e는 1분 넘게 걸려 훅에 넣지 않았다. 화면을 바꿨으면 커밋 전에 직접 돌린다(6절).
- 새 패키지를 만들면 `scripts/check-arch.mjs`의 `ALLOWED`에 경계를 먼저 적어야 검사가 통과한다.
- 훅을 건너뛰는 `git commit --no-verify`는 쓰지 않는다.

---

## 5. CI/CD (GitHub Actions)

| 워크플로 | 트리거 | 단계 |
|---|---|---|
| `ci.yml` | PR · push | 설치(캐시) → 타입체크 → Biome → dependency-cruiser → 단위 · 속성(짧게) · 계약 · 통합 → Node 벤치(회귀 10% 초과 시 실패) → `pnpm audit` |
| `e2e.yml` | PR (main 대상) | Playwright Chromium · WebKit (E1~E11, 녹화 AI 응답) · 시각 회귀 |
| `nightly.yml` | 매일 03:00 KST | 속성 테스트 장시간 · 2-복제본 퍼징 · 브라우저 벤치 · 결과 아티팩트 저장 |
| `eval.yml` | `ai-pipeline/prompts/**` · `schemas/**` 변경, 수동 | AI 평가 세트 실행 (실제 API, 비용 상한) |
| `deploy-preview.yml` | PR | Cloudflare Pages 미리보기 · `dn-edge-preview` 배포 · Supabase preview 마이그레이션 |
| `deploy-prod.yml` | `main` 태그 `v*` | Supabase 마이그레이션 → Edge 배포 → Pages 배포 (순서 고정, 뒤로 호환되는 변경만) |

**현재 상태 (2026-10-02):** `.github/workflows/ci.yml` 하나만 준비돼 있다(원격 저장소가 아직 없어 실행 전). 잡 두 개:

| 잡 | 단계 |
|---|---|
| `check` | Node 24 · `corepack enable` · `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test` → `pnpm bench`(러너는 기준 기기가 아니라 10% 비교는 건너뛰고 절대 예산만 판정) → `pnpm validate:tracker` |
| `e2e` | `check` 통과 후 `pnpm dev`를 띄우고 `DN_CHANNEL=chrome` · `DN_URL=http://localhost:5173`로 `e2e/smoke.mjs` · `p1.mjs` · `ai.mjs` 실행, 스크린샷을 아티팩트로 올림 |

Biome · dependency-cruiser · `pnpm audit` · 커버리지 게이트 · `e2e.yml` 이하 워크플로는 아직 없다.

**배포 순서 원칙:** DB(추가만) → 서버(구 클라이언트 호환) → 클라이언트. 하위 호환이 깨지는 변경은 2단계로 나눠 배포한다.

---

## 6. 로컬 개발

pnpm은 전역 설치 대신 **corepack**으로 쓴다(`packageManager: pnpm@9.15.4`). Windows PowerShell에서도 같다.

```bash
corepack pnpm install
```

```bash
corepack pnpm dev
```

현재 `pnpm dev`는 `apps/web`(Vite, `http://localhost:5173`, `strictPort`)만 띄운다. Claude Code 미리보기는 `.claude/launch.json`의 `web` 구성이 같은 명령을 쓴다. 계획: `services/edge`(wrangler dev)를 함께 띄우고, 로그인 · 동기화를 개발할 때는 로컬 Supabase도 띄운다.

```bash
pnpm supabase start
```

| 스크립트 | 내용 |
|---|---|
| `pnpm test` | vitest — 전 패키지 단위 · 속성 테스트 (10/02 기준 173건). `vitest.setup.ts`가 개발 검사(`setDevChecks`)를 켠다 |
| `pnpm test:coverage` | engine-core 라인 커버리지 (v8, 목표 90% — 10/02 90.1%) |
| `pnpm typecheck` | engine-core(+test) · text-pm · engine-dom · storage-idb · ai-pipeline(+test) · apps/web 순서로 `tsc -p` |
| `pnpm e2e` · `e2e:p1` · `e2e:ai` · `e2e:p3` | 브라우저 스위트 `e2e/smoke.mjs`(27) · `p1.mjs`(43) · `ai.mjs`(14, api.anthropic.com을 `page.route`로 가짜 응답) · `p3.mjs`(27) · `release.mjs`(개발 서버 18 / 배포용 빌드 26, 배포 QA). dev 서버를 먼저 띄운다. 환경변수 `DN_URL`(기본 `http://localhost:5173`) · `DN_CHANNEL`(기본 `msedge`, CI는 `chrome`). 인자로 스크린샷 폴더 |
| `pnpm bench` | Node 벤치(`bench/run.ts`, `--expose-gc`). 기준선 `bench/baseline.json`과 같은 CPU · Node 메이저면 10% 회귀 판정(드리프트 보정), 아니면 절대 예산만. `--update-baseline`으로 갱신. 결과는 `bench/results/` |
| `pnpm -F @dn/ai-pipeline gen:prompts` | `prompts/*.md` → `src/prompts.gen.ts` 재생성 (프롬프트를 고친 뒤 필수) |
| `pnpm eval` | (계획) AI 평가 — 실제 API 키 필요. 지금은 `ai-pipeline/test/eval.test.ts`가 기대 결과 형식만 검사 |
| `pnpm docs` | `node scripts/build-docs.js` — PRD · FR · ROADMAP · `feature-ids.json` 재생성 |
| `pnpm docs:check` | `node e2e/docs-check.mjs` — 설계 문서의 mermaid 파싱 검사 |
| `pnpm validate:tracker` | `node scripts/validate-tracker.js` — 트래커 데이터 정합성 검사 |

환경변수는 `.env.example`을 복사해 **저장소 루트**에 `.env.local`로 쓴다(`.gitignore` 대상). 실제 키는 절대 커밋하지 않는다 — 커밋 전 검사가 막는다.

**Claude API 키 (`ANTHROPIC_API_KEY`)** — `.env.local`에 넣으면 개발 서버(`corepack pnpm dev`)가 시작할 때 읽어:
- 앱은 `/anthropic/...`으로 요청하고, Vite 개발 서버가 그 요청에 키를 붙여 `api.anthropic.com`으로 넘긴다(`apps/web/vite.config.ts`의 `anthropicProxy`). **키는 브라우저 · 번들에 들어가지 않는다** — 앱이 아는 건 "env 키 있음 · 끝 4자리"뿐.
- 설정 › AI에 ".env.local의 키를 쓰는 중"이 보이고, 설정 화면에 넣은 키보다 env 키가 먼저 쓰인다.
- 키를 바꾸면 개발 서버를 다시 시작한다. 배포 빌드(`vite build`)에는 프록시가 없다 — 배포에서는 설정 화면의 키(BYOK) 또는 Edge 프록시(FR-104).
- e2e는 브라우저 저장소에 `dn:no-env-key=1`을 넣어 env 키를 쓰지 않는다(가짜 응답만, 실제 호출 · 비용 없음).

---

## 7. 완료 기준 (Definition of Done)

FR을 트래커에서 `done`으로 바꾸려면:

- [ ] FR 수락 기준 체크박스 전부에 대응하는 자동 테스트(또는 TEST-PLAN에 적힌 수동 절차) 통과
- [ ] 타입체크 · 린트 · 의존 규칙 · 벤치 회귀 통과
- [ ] 저장 포맷을 바꿨다면 `schemaVersion` 증가 + 마이그레이션 + 픽스처 테스트
- [ ] 사용자에게 보이는 문자열은 i18n 키
- [ ] 오류 경로(오프라인 · 저장 실패 · AI 실패)에서 데이터 손실 없음 확인
- [ ] 관련 문서(ENGINE · DATABASE · API) 절을 수정했거나 수정 불필요 확인
- [ ] 트래커 수락 기준 체크 후 `node scripts/build-docs.js`로 문서 재생성 · `node scripts/validate-tracker.js` 통과 (트래커 데이터를 바꿨다면 `DATA_REVISION` 올림)
- [ ] UI 변경이면 `pnpm e2e` · `e2e:p1`(AI 흐름이면 `e2e:ai`) 통과, 설계 문서를 고쳤다면 `pnpm docs:check`

---

## 8. 문서 운영

| 문서 | 원본 | 수정 방법 |
|---|---|---|
| PRD.md · FR.md · ROADMAP.md | `prd-tracker.html` 데이터 | 트래커 수정 → `build-docs.js` 재생성. **직접 편집 금지** |
| ENGINE.md · ARCHITECTURE.md · DATABASE.md · API.md · SECURITY.md · TEST-PLAN.md · DEV-GUIDE.md | 각 파일 | 직접 편집. 문서 상단 버전 · 변경 이력 갱신 |
| adr/*.md | 각 파일 | 승인된 ADR은 내용 수정 금지. 바뀌면 새 ADR로 대체하고 이전 것을 "대체됨"으로 표시 |

---

## 9. 릴리스 체크리스트

- [ ] TEST-PLAN 3절 해당 게이트 통과
- [ ] SECURITY 9절 체크리스트
- [ ] 마이그레이션: 이전 버전 픽스처 → 새 버전 열기 · 저장 · 백업 키 확인
- [ ] Service Worker 업데이트 배너 동작 (이전 버전 설치 상태에서)
- [ ] `/v1/config` 최소 클라이언트 버전 갱신 여부 판단
- [ ] 변경 사항 요약(사용자용) 작성
- [ ] 태그 · 배포 · 배포 후 스모크(E1 · E4 · E5 수동 1회)

---

## 10. 변경 이력

| 버전 | 날짜 | 내용 |
|---|---|---|
| v0.2 | 2026-10-02 | 1절에 실제 구조(패키지 5개 · bench · e2e · eval · scripts) 추가, 5절 실제 `ci.yml`, 6절 corepack pnpm · 포트 · 실제 스크립트 표(e2e 3종 · bench · coverage · typecheck · gen:prompts), DoD에 트래커 검증 · e2e · docs:check |
| v0.1 | 2026-10-01 | 초안 |
