# DamianNote API 명세서

| 항목 | 내용 |
|---|---|
| 문서 버전 | v0.2 (2026-10-02 — 로컬 전용(BYOK) 경로 구현 · 매핑을 스키마 v3 상자로 · 타임아웃 90초) |
| 작성일 | 2026-10-01 |
| 상태 | 검토 대기 — 엔드포인트 · 스키마는 P2(AI) · P5(동기화) 착수 전에 확정 |
| 관련 문서 | [ARCHITECTURE.md](ARCHITECTURE.md) 6·7절 · [DATABASE.md](DATABASE.md) · SECURITY.md |

Edge API(Cloudflare Worker)가 제공하는 외부 API와, 병렬 개발을 위해 먼저 고정해야 하는 클라이언트 내부 모듈 계약을 정의한다. 엔진 공개 API(`Engine`, `transact`, `ChangeEvent`)는 ENGINE.md 5.3이 원본이다.

---

## 목차

1. 공통 규약
2. 엔드포인트 목록
3. AI API
4. AI 구조화 출력 스키마
5. 동기화 프로토콜 (WebSocket)
6. 문서 · 첨부 · 기기 · 계정 API
7. 클라이언트 내부 모듈 계약
8. 변경 이력

---

## 1. 공통 규약

### 1.1 기본

| 항목 | 규칙 |
|---|---|
| Base URL | `https://api.<도메인>/v1` (preview: `https://api-preview.<도메인>/v1`) |
| 버전 | 경로 접두어 `/v1`. 하위 호환이 깨지면 `/v2`를 새로 연다 |
| 형식 | 요청 · 응답 `application/json; charset=utf-8`. 스트리밍은 `text/event-stream` |
| 시간 | ISO 8601 UTC 문자열 (`2026-10-01T09:00:00Z`) |
| id | 클라이언트 생성 22자 base62 (`docId`, `runId`), 서버 생성 UUID (`deviceId`) |
| 문자 | UTF-8, 한글 정규화 NFC |

### 1.2 인증

- `Authorization: Bearer <Supabase access token>` — 모든 `/v1/*`(단, `/v1/config`, `/v1/share/*` 제외).
- Worker는 Supabase JWKS로 서명 · 만료 · `aud`를 검증하고 `sub`를 `userId`로 쓴다. JWKS는 10분 캐시.
- 토큰 만료 시 `401 token-expired` → 클라이언트가 refresh 후 1회 재시도.
- 로컬 전용 모드는 Edge API를 쓰지 않는다(AI는 브라우저에서 Anthropic API 직접 호출, SECURITY 4절).

### 1.3 공통 헤더

| 헤더 | 방향 | 필수 | 설명 |
|---|---|---|---|
| `X-DN-Client` | 요청 | ✅ | 클라이언트 semver. 최소 지원 버전 미만이면 `426` |
| `X-DN-Device` | 요청 | ✅ (로그인 후) | 기기 id (`devices.id`) |
| `Idempotency-Key` | 요청 | AI · 업로드 POST에 권장 | 22자 id. 같은 키 재요청은 24시간 동안 같은 결과(진행 중이면 `409 in-progress`) |
| `X-Request-Id` | 응답 | ✅ | 추적용. 오류 신고 시 사용자에게 보여줌 |
| `RateLimit-Limit` · `RateLimit-Remaining` · `RateLimit-Reset` | 응답 | AI 경로 | IETF RateLimit 헤더 |

### 1.4 오류 형식 (RFC 9457 Problem Details)

```json
{
  "type": "https://docs.damiannote.app/errors/rate-limited",
  "title": "요청이 너무 많습니다",
  "status": 429,
  "code": "rate-limited",
  "detail": "오늘 AI 토큰 한도(2,000,000)를 모두 사용했습니다.",
  "retryAfter": 3600,
  "requestId": "01J9Z..."
}
```

| HTTP | code | 의미 | 클라이언트 동작 |
|---|---|---|---|
| 400 | `invalid-request` | 스키마 위반 | 재시도 안 함, 버그 보고 |
| 401 | `token-expired` · `unauthenticated` | 인증 | refresh 후 1회 재시도 / 로그인 화면 |
| 403 | `forbidden` · `device-revoked` | 소유권 · 원격 로그아웃 | 로그아웃 처리 (로컬 데이터 유지) |
| 404 | `not-found` | 문서 · 첨부 없음 | |
| 409 | `in-progress` · `conflict` | 멱등 키 진행 중 · 상태 충돌 | 잠시 후 재조회 |
| 413 | `payload-too-large` · `doc-too-large` | 크기 상한 | FR-091 안내 |
| 422 | `no-api-key` · `invalid-api-key` | AI 키 없음 · 무효 | 설정 화면 안내 (FR-139) |
| 422 | `ai-refused` | 모델이 요청을 거절함 (정책 · 안전) | 원문은 그대로 두고 안내, 재시도 안 함 |
| 426 | `client-outdated` | 클라이언트 구버전 | 업데이트 배너 |
| 429 | `rate-limited` | 빈도 · 일일 한도 | `retryAfter` 후 |
| 502 | `upstream-error` | Claude · STT 오류 | 백오프 재시도 (최대 3회) |
| 503 | `upstream-overloaded` | Claude 529 등 | 백오프 재시도 |
| 504 | `upstream-timeout` | 청크당 90초 초과 (3.2) | 재시도 또는 입력 축소 안내 |

### 1.5 레이트 리밋 (기본값, 제안)

| 대상 | 한도 |
|---|---|
| AI 요청 빈도 | 사용자당 분당 20회, 동시 4개 |
| AI 일일 토큰 | `profiles.ai_daily_token_limit` (기본 2,000,000, 서비스 키 사용 시에만 적용) |
| 첨부 업로드 | 사용자당 시간당 2GB |
| 동기화 WS | 사용자당 동시 연결 64개(문서 수), 메시지 1MB 이하 |

---

## 2. 엔드포인트 목록

| 메서드 | 경로 | 설명 | FR | Phase |
|---|---|---|---|---|
| GET | `/v1/config` | 최소 클라이언트 버전 · 기능 활성 여부 (인증 불필요) | — | P2 |
| POST | `/v1/ai/structure` | 붙여넣은 텍스트 구조화 (SSE) | FR-105~109 | P2 |
| POST | `/v1/ai/ocr` | 필기 이미지 → 텍스트 | FR-038 | P4 |
| POST | `/v1/ai/edit` | 선택 텍스트 편집 (요약 · 확장 · 톤) (SSE) | FR-112 | P7 |
| POST | `/v1/ai/summary` | 노트 요약 · 핵심 추출 (SSE) | FR-115 | P7 |
| POST | `/v1/ai/qa` | 내 노트 질문 (근거 조각 포함) (SSE) | FR-116~119 | P7 |
| POST | `/v1/ai/transcribe` | 녹음 전사 (비동기 작업) | FR-044 | P7 |
| GET | `/v1/ai/jobs/:jobId` | 비동기 작업 상태 | FR-044 | P7 |
| PUT | `/v1/ai/key` | 사용자 Claude 키 등록 · 교체 (BYOK) | FR-139 | P2 |
| POST | `/v1/ai/key/test` | 키 유효성 검사 | FR-139 | P2 |
| DELETE | `/v1/ai/key` | 키 삭제 | FR-139 | P2 |
| GET | `/v1/ai/key` | 키 메타 (`last4`, `validatedAt`) | FR-139 | P2 |
| GET | `/v1/ai/usage` | 사용량 (요청별 · 일별) | FR-141 | P2 |
| GET | `/v1/documents` | 내 문서 목록 (`?since=` 커서) | FR-095 | P5 |
| PUT | `/v1/documents/:docId` | 문서 등록 (멱등) | FR-095 | P5 |
| DELETE | `/v1/documents/:docId` | 영구 삭제 표시 | FR-076 | P5 |
| GET (WS) | `/v1/sync/:docId` | 동기화 WebSocket | FR-095~097 | P5 |
| PUT | `/v1/documents/:docId/state` | 첫 업로드: 전체 Y 상태 한 번에 올리기 (SYNC 12.2 — v1에서는 두지 않음, SYNC 10.6) | FR-094 · 095 | P5 |
| POST | `/v1/documents/:docId/diff` | 상태 벡터를 보내 빠진 업데이트만 받기 (닫힌 노트 백그라운드 반영) | FR-095 | P5 |
| PUT | `/v1/attachments/:hash` | 첨부 업로드 (본문 = 바이너리) | FR-052 · FR-095 | P5 |
| HEAD | `/v1/attachments/:hash` | 존재 확인 (중복 제거) | | P5 |
| GET | `/v1/attachments/:hash` | 다운로드 | | P5 |
| POST | `/v1/devices` | 기기 등록 (로그인 직후) | FR-098 | P5 |
| GET | `/v1/devices` | 기기 목록 | FR-098 | P5 |
| DELETE | `/v1/devices/:deviceId` | 원격 로그아웃 | FR-098 | P9 |
| POST | `/v1/account/export` | 계정 전체 내보내기 작업 | FR-092 | P5 |
| DELETE | `/v1/account` | 계정 삭제 요청 (7일 유예) | FR-094 | P5 |
| POST | `/v1/shares` | 읽기 전용 공유 링크 생성 | FR-134 | P9 |
| GET | `/v1/share/:token` | 공유 페이지 (인증 불필요) | FR-134 | P9 |

---

## 3. AI API

> **구현 현황 (2026-10-02):** Edge 프록시(3.2~3.6)는 아직 없다(FR-104 — Cloudflare · Supabase 계정 준비 후). 지금 동작하는 것은 **로컬 전용 모드**다: 앱이 `@dn/ai-pipeline/direct`로 Claude Messages API를 브라우저에서 직접 부른다(SDK `@anthropic-ai/sdk`, `dangerouslyAllowBrowser`, SECURITY 4절). 요청 조립 · 교정 재요청 · 검증은 Worker가 할 일과 **같은 코드**(`request.ts` `runStructureChunk`)를 쓰므로, 아래 "Worker → Claude 요청 형태"가 그대로 직접 호출에도 적용된다. SSE 응답 형태(3.2)는 Edge transport(`transport.ts`)에 구현돼 있고 가짜 서버로만 테스트했다. 키 확인은 Models API `models.retrieve` 한 번이다.

### 3.1 키 해석 규칙

| 순서 | 조건 | 사용 키 | `key_source` |
|---|---|---|---|
| 1 | 사용자가 등록한 키(Vault)가 있음 | 사용자 키 | `user` |
| 2 | 사용자 `plan = 'tester'` | 서비스 키 (일일 한도 적용) | `service` |
| 3 | 그 외 | 없음 → `422 no-api-key` | — |

Worker는 키를 요청마다 Vault에서 복호화해 메모리에서만 쓰고, 로그 · 응답 어디에도 남기지 않는다.

### 3.2 `POST /v1/ai/structure`

**요청**

```json
{
  "runId": "4Qk2t8xP0aZmN3bV7cR1sY",
  "chunk": { "index": 0, "count": 3 },
  "text": "## 결론\nA 방식은 B보다 ...",
  "locale": "ko",
  "options": {
    "kinds": ["relation", "chart", "table"],
    "model": "claude-sonnet-5-5",
    "promptVersion": "structure.v1"
  },
  "context": { "previousNodeTitles": ["A 방식", "B 방식"] }
}
```

| 필드 | 제약 |
|---|---|
| `text` | 1자 이상, 청크당 최대 24,000자 (클라이언트가 청킹, FR-101) |
| `options.kinds` | FR-142 설정. 빈 배열이면 400 |
| `options.model` | 허용 목록만 (`claude-sonnet-5-5`, `claude-haiku-4-5-20251001`, `claude-opus-5-5`). 기본 `claude-sonnet-5-5` |
| `context.previousNodeTitles` | 앞 청크의 노드 제목 (청크 간 같은 개념 연결용), 최대 200개 |

**응답 (SSE)**

```
event: progress
data: {"stage":"thinking","pct":10}

event: progress
data: {"stage":"emitting","pct":60}

event: result
data: {"runId":"...","chunk":0,"structure":{...4절 스키마...},"usage":{"input":5321,"output":1840,"cacheRead":4100},"model":"claude-sonnet-5-5","promptVersion":"structure.v1"}

event: done
data: {}
```

오류 시 `event: error` + Problem Details 본문 후 종료. 클라이언트 연결 끊김은 업스트림 취소로 전파한다(FR-103).

**Worker → Claude 요청 형태** (상세 · 프롬프트 원문은 [AI-PROMPTS.md](AI-PROMPTS.md)가 원본)

- `system`: 버전 고정 프롬프트(`packages/ai-pipeline/prompts/structure.v1.md`). 원문은 요청마다 새로 뽑은 nonce 태그로 감싸고, 그 안의 지시를 따르지 않도록 명시(SECURITY 5.2, AI-PROMPTS 인젝션 방어).
- `tools`: `emit_structure` 하나, `strict: true`. strict 모드가 지원하지 않는 제약(`maxLength` · `maxItems` · `pattern`)을 뺀 **wire 스키마**를 보내고, 원본 4절 스키마로는 클라이언트가 다시 검증한다.
- `tool_choice`: 기본 모델에서 강제 호출(`type: "tool"`)이 거부된다는 조사 결과에 따라 `auto` + 병렬 호출 비활성 + "정확히 한 번 호출" 지시로 바꿨다. 호출이 없으면 교정 재요청(AI-PROMPTS 교정 모드 B). 2026-10-02 확인: Claude API 문서 기준으로 Sonnet 5.5 · Opus 5.5는 강제 호출(`any` · `tool`)이 400이고 Haiku 4.5만 허용한다 — 모델별로 갈리지 않게 `auto`로 통일한다. 실제 호출 검증은 M2(10/20) 실샘플 20건에서 한다.
- temperature는 보내지 않는다. 추론 강도는 effort로 조절한다(FR-140).
- 시스템 블록 끝에 `cache_control` 하나 — 도구 정의와 시스템이 함께 캐시된다. 요청마다 바뀌는 값은 사용자 메시지에 둔다.
- `max_tokens` 16,000(추론 토큰 포함, 노드 60 · 엣지 120 상한에서 잘리지 않도록), 타임아웃 청크당 90초(`CHUNK_TIMEOUT_MS`). Sonnet · Opus는 `thinking: {type:'adaptive'}` + `output_config.effort`, Haiku 4.5는 둘 다 보내지 않는다.
- 교정 재요청은 같은 SSE 안에서 Worker가 수행한다(추론 블록을 그대로 이어 보내야 하므로 클라이언트 왕복 없음). 클라이언트는 `event: progress {stage:"repairing"}`만 받는다.
- 서버 측 대체 모델(fallback)은 **끈다** — BYOK에서 사용자가 고르지 않은 모델 비용이 청구되지 않게. 사용량 기록에는 응답에 찍힌 실제 모델을 남긴다.
- 프롬프트를 같은 스키마 버전 안에서 고치면 `promptRevision`(정수)을 올리고 결과 · 사용량 레코드에 남긴다.

### 3.3 `POST /v1/ai/ocr`

```json
// 요청
{ "runId": "...", "image": { "mime": "image/png", "base64": "iVBOR..." }, "locale": "ko", "hint": "lines" }
// 응답 200
{ "runId": "...", "lines": [ { "text": "회의 결론: 다음 주 배포", "confidence": 0.92, "bbox": [12, 8, 410, 40] } ],
  "overallConfidence": 0.88, "usage": { "input": 1650, "output": 120 } }
```

- 이미지는 긴 변 1568px 이하 PNG/WebP, 5MB 이하. 클라이언트가 래스터화한다(ARCHITECTURE 7.5).
- `bbox`는 보낸 이미지 픽셀 기준 `[x, y, w, h]`. 클라이언트가 래스터화 배율로 월드 좌표에 되돌린다.
- `hint`: `"lines"`(기본, 줄 단위) · `"block"`(한 덩어리 문단). 응답 스키마는 `packages/ai-pipeline/schemas/ocr.v1.json`.
- `confidence`는 모델 자기 평가값이다. 정확한 확률이 아니므로 UI는 "높음 · 보통 · 낮음" 3단계로만 표시한다(0.8 / 0.6 경계).

### 3.4 `POST /v1/ai/qa` (P7)

```json
{
  "runId": "...",
  "question": "지난달 회의에서 배포 일정 뭐로 정했지?",
  "scope": { "kind": "folder", "id": "..." },
  "passages": [
    { "ref": "n:7f..#c:2a..", "noteTitle": "10월 회의", "text": "배포는 10/28 동결 후 ...", "updatedAt": "2026-10-12T03:00:00Z" }
  ],
  "history": [ { "role": "user", "text": "..." }, { "role": "assistant", "text": "..." } ]
}
```

- 근거 검색은 클라이언트가 한다(ADR-0010). 서버는 받은 `passages`만 Claude에 전달하며 저장하지 않는다.
- 응답 SSE의 `result`: `{ "answer": "...", "citations": [ { "ref": "...", "quote": "..." } ], "grounded": true }`. 근거가 없으면 `grounded:false`와 "노트에 없음" 답변(FR-116).

### 3.5 `PUT /v1/ai/key`

```json
// 요청
{ "apiKey": "sk-ant-..." }
// 응답 200
{ "last4": "x9Qa", "validatedAt": "2026-10-10T02:11:00Z" }
```

- 저장 전에 최소 호출(모델 목록 조회 또는 1토큰 메시지)로 유효성을 확인한다. 실패하면 `422 invalid-api-key`, 저장하지 않는다.
- 응답 · 로그에 키 원문을 절대 포함하지 않는다.

### 3.6 `GET /v1/ai/usage?from=2026-10-01&to=2026-10-31`

```json
{ "days": [ { "day": "2026-10-10", "requests": 42, "tokens": 318200, "costMicroUsd": 1840000 } ],
  "recent": [ { "runId": "...", "feature": "structure", "model": "claude-sonnet-5-5", "input": 5321, "output": 1840, "status": "ok", "at": "..." } ],
  "limit": { "dailyTokens": 2000000, "appliesTo": "service-key" } }
```

---

## 4. AI 구조화 출력 스키마 (`structure.v1`)

`emit_structure` 도구의 `input_schema`이며, 클라이언트 검증기(FR-100)도 같은 파일(`ai-pipeline/schemas/structure.v1.json`)을 쓴다.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "structure.v1",
  "type": "object",
  "required": ["nodes", "edges", "charts", "tables"],
  "additionalProperties": false,
  "properties": {
    "title": { "type": "string", "maxLength": 120 },
    "nodes": {
      "type": "array", "maxItems": 60,
      "items": {
        "type": "object",
        "required": ["key", "title", "kind"],
        "additionalProperties": false,
        "properties": {
          "key":   { "type": "string", "pattern": "^[a-z0-9_-]{1,32}$" },
          "title": { "type": "string", "minLength": 1, "maxLength": 80 },
          "kind":  { "enum": ["concept", "step", "option", "claim", "evidence", "question", "conclusion"] },
          "body":  { "type": "string", "maxLength": 2000, "description": "Markdown 부분집합: 목록 · 굵게 · 기울임 · 인라인 코드" },
          "group": { "type": "string", "maxLength": 40 },
          "source": { "$ref": "#/$defs/span" }
        }
      }
    },
    "edges": {
      "type": "array", "maxItems": 120,
      "items": {
        "type": "object",
        "required": ["from", "to", "relation"],
        "additionalProperties": false,
        "properties": {
          "from": { "type": "string" },
          "to":   { "type": "string" },
          "relation": { "enum": ["causes", "leads-to", "part-of", "example-of", "contrasts", "supports", "depends-on", "next"] },
          "label": { "type": "string", "maxLength": 24 }
        }
      }
    },
    "charts": {
      "type": "array", "maxItems": 10,
      "items": {
        "type": "object",
        "required": ["key", "kind", "series"],
        "additionalProperties": false,
        "properties": {
          "key":   { "type": "string", "pattern": "^[a-z0-9_-]{1,32}$" },
          "kind":  { "enum": ["bar", "line", "pie"] },
          "title": { "type": "string", "maxLength": 80 },
          "unit":  { "type": "string", "maxLength": 16 },
          "series": {
            "type": "array", "minItems": 1, "maxItems": 8,
            "items": {
              "type": "object",
              "required": ["name", "points"],
              "additionalProperties": false,
              "properties": {
                "name": { "type": "string", "maxLength": 40 },
                "points": {
                  "type": "array", "minItems": 1, "maxItems": 100,
                  "items": {
                    "type": "object", "required": ["x", "y"], "additionalProperties": false,
                    "properties": { "x": { "type": ["string", "number"] }, "y": { "type": "number" } }
                  }
                }
              }
            }
          },
          "attachTo": { "type": "string", "description": "관련 노드 key — 차트 블록을 이 노드 옆에 배치" },
          "source": { "$ref": "#/$defs/span" }
        }
      }
    },
    "tables": {
      "type": "array", "maxItems": 10,
      "items": {
        "type": "object",
        "required": ["key", "columns", "rows"],
        "additionalProperties": false,
        "properties": {
          "key":     { "type": "string", "pattern": "^[a-z0-9_-]{1,32}$" },
          "title":   { "type": "string", "maxLength": 80 },
          "columns": { "type": "array", "minItems": 2, "maxItems": 12, "items": { "type": "string", "maxLength": 40 } },
          "rows":    { "type": "array", "minItems": 1, "maxItems": 50,
                       "items": { "type": "array", "items": { "type": "string", "maxLength": 300 } } },
          "attachTo": { "type": "string" },
          "source": { "$ref": "#/$defs/span" }
        }
      }
    }
  },
  "$defs": {
    "span": {
      "type": "object", "required": ["quote"], "additionalProperties": false,
      "properties": { "quote": { "type": "string", "maxLength": 200, "description": "원문에서 그대로 복사한 근거 구절" } }
    }
  }
}
```

### 4.1 클라이언트 검증 · 매핑 규칙

| 규칙 | 처리 |
|---|---|
| 스키마 위반 (전체) | 교정 재요청 1회 (위반 경로 목록을 프롬프트에 포함). 또 실패하면 오류 (FR-100) |
| 항목 단위 위반 | 그 항목만 버리고 나머지 반영 ("부분 유효 결과는 유효 항목만 반영") |
| `edges.from/to`가 없는 노드 key | 그 엣지만 버림 |
| `tables.rows[i]` 길이 ≠ `columns` 길이 | 빈 칸으로 채우거나 자름 |
| `source.quote` | 원문에서 정확히 찾으면 `AiProvenance.source{from,to}`로 변환, 못 찾으면 `excerpt`만 저장 (FR-111) |
| 청크 간 같은 제목 노드 | 정규화(NFC · 공백 · 대소문자) 후 같으면 하나로 병합 |
| 매핑 | node → flow 블록 하나: `body`가 없으면 **제목 상자**(`role:'title'`, 제목 한 줄), 있으면 **내용 상자**(`role:'body'`, 맨 앞 제목3 줄 + 본문) — 엔진 스키마 v3, ADR-0013 / edge → 화살표(라벨 = `label` 또는 relation 기본 한국어) / chart → `type:'chart', schema:'chart-v0'` 콘텐츠 블록 / table → `type:'table', schema:'table-v0'` 콘텐츠 블록 (둘 다 렌더러(FR-018) 전까지 자리표시자로 보존). 전부 `applyStructure` 트랜잭션 하나(origin `ai`, 실행 취소 한 번). 배치는 계층형 + 빈 자리(ENGINE 10.4) |

---

## 5. 동기화 프로토콜 (WebSocket)

### 5.1 연결

```
GET /v1/sync/{docId}?kind=note
Upgrade: websocket
Sec-WebSocket-Protocol: dn-sync.v1, bearer.<access token>, device.<deviceId>
X-DN-Client: 0.5.0
```

- 브라우저 WebSocket은 임의 헤더를 못 넣으므로 토큰과 기기 id를 서브프로토콜로 전달한다(`X-DN-Device` 대신 `device.<id>`). Worker는 토큰 · 소유권 · 기기 해지 여부를 검증한 뒤 `dn-sync.v1`만 응답한다.
- 문서가 레지스트리에 없으면 `PUT /v1/documents/:docId`를 먼저 호출해야 한다(없으면 `4404`로 닫음).

### 5.2 메시지 (바이너리 프레임)

y-protocols의 sync 메시지 인코딩을 그대로 쓴다. 첫 바이트가 메시지 종류다.

| 종류 | 값 | 방향 | 내용 |
|---|---|---|---|
| sync step 1 | `0,0` | 양방향 | 상태 벡터 |
| sync step 2 | `0,1` | 양방향 | 상대에게 없는 업데이트 |
| update | `0,2` | 양방향 | 새 업데이트 |
| ack | `100` | 서버→클라 | `varuint seq` — 서버 SQLite에 저장 완료 (클라이언트 `pending` 삭제 기준) |
| error | `101` | 서버→클라 | `varstring code` (`doc-too-large` 등) |

Awareness(커서 공유)는 쓰지 않는다 — 실시간 공동 편집은 범위 밖.

### 5.3 종료 코드

| 코드 | 의미 | 클라이언트 동작 |
|---|---|---|
| 1000 | 정상 | — |
| 4401 | 토큰 만료 · 무효 | refresh 후 재연결 |
| 4403 | 소유자 아님 · 기기 해지 | 동기화 중단, 로그아웃 처리 |
| 4404 | 레지스트리에 없음 | 등록 후 재연결 |
| 4413 | 문서 크기 상한 | 동기화 일시 중단, 사용자 안내 |
| 4426 | 클라이언트 구버전 | 업데이트 안내 |
| 4410 | 문서가 영구 삭제됨 | 로컬 사본을 휴지통 정리 규칙대로 처리 (SYNC 13.6) |
| 4429 | 연결 과다 | 지수 백오프 |

재연결 백오프: 1s → 2s → 4s … 최대 60s, ±20% 지터. 온라인 이벤트 · 앱 포커스 시 즉시 재시도.

---

## 6. 문서 · 첨부 · 기기 · 계정 API

### 6.1 `GET /v1/documents?since=<cursor>&limit=200`

```json
{ "items": [ { "id": "...", "kind": "note", "schemaVersion": 3, "sizeBytes": 182233,
               "updatedAt": "2026-10-20T01:02:03Z", "deletedAt": null } ],
  "nextCursor": "MjAyNi0xMC0yMFQwMTowMjowM1o..." }
```

새 기기는 이 목록으로 받아야 할 문서를 알고, 문서마다 WS 연결로 내용을 받는다. 노트 목록 화면은 워크스페이스 문서로 먼저 그려지고 내용은 열 때 받는다(지연 동기화).

### 6.2 `PUT /v1/documents/:docId`

```json
{ "kind": "note", "schemaVersion": 3 }
```
→ `201` 생성 / `200` 이미 있음(멱등). 다른 사용자의 같은 id면 `409 conflict`(128비트 난수라 사실상 발생하지 않음).

### 6.3 첨부

- `HEAD /v1/attachments/{hash}` → `200`(있음) / `404`.
- `PUT /v1/attachments/{hash}` 본문 = 바이너리, `Content-Type` 필수, 100MB 이하. Worker가 스트리밍으로 SHA-256을 다시 계산해 `hash`와 다르면 `400`.
- `GET /v1/attachments/{hash}` → 바이너리 (`Cache-Control: private, max-age=31536000, immutable`).

### 6.4 기기

- 로그인 직후 `POST /v1/devices { "name": "iPad 10", "platform": "ipados" }` → `{ "deviceId": "..." }`를 `settings`(device scope)에 저장.
- `DELETE /v1/devices/:id` → `revoked_at` 설정, 그 기기의 이후 요청은 `403 device-revoked`.

### 6.5 계정

- `DELETE /v1/account` → `202 { "scheduledAt": "...+7d" }`. 유예 기간 중 로그인하면 취소 여부를 묻는다.
- `POST /v1/account/export` → `202 { "jobId" }`, 완료 시 다운로드 URL(7일 유효).

---

## 7. 클라이언트 내부 모듈 계약

병렬 개발(DEV-GUIDE 3절)을 위해 P1 시작 전에 아래 인터페이스를 `packages/contracts`에 타입으로 고정한다. 구현은 각 패키지 담당이 한다.

```ts
// app-meta
export interface MetaStore {
  listNotes(q: { folderId?: Id | null; tagId?: Id; includeDeleted?: boolean; sort: 'updated' | 'title' | 'manual' }): Promise<NoteMeta[]>;
  getNote(id: NoteId): Promise<NoteMeta | null>;
  transact(fn: (tx: MetaTx) => void, opts?: { origin: 'user' | 'import' | 'remote' | 'system' }): Promise<MetaChange>;
  subscribe(fn: (c: MetaChange) => void): () => void;
}
export interface MetaTx {
  createNote(init: Partial<NoteMeta> & { id: NoteId }): void;
  set<K extends 'note' | 'folder' | 'tag'>(kind: K, id: Id, patch: Record<string, unknown>): void;  // 필드별 Op로 분해
  trash(noteId: NoteId): void; restore(noteId: NoteId): void; purge(noteId: NoteId): void;
  createFolder(init: { id: Id; name: string; parentId?: Id }): void;
  createTag(init: { id: Id; name: string; color: string }): void;
}

// ai-pipeline
export interface AiPipeline {
  structure(input: { noteId: NoteId; text: string; kinds: StructureKind[] },
            ev: { onProgress(p: { pct: number; stage: string }): void; signal: AbortSignal }): Promise<StructurePlan>;
  apply(engine: Engine, plan: StructurePlan, at: WorldPoint): Promise<{ runId: string; blockIds: BlockId[] }>;
}

// search (워커 경계 — 메시지로 호출)
export interface SearchIndex {
  upsertNote(noteId: NoteId, docs: SearchDoc[]): Promise<void>;
  removeNote(noteId: NoteId): Promise<void>;
  query(q: { text: string; filters?: SearchFilters; limit?: number }): Promise<SearchHit[]>;
  retrieve(q: { question: string; scope?: QaScope; k: number }): Promise<Passage[]>;   // Q&A 근거
  rebuild(onProgress: (pct: number) => void): Promise<void>;
}

// api-client
export interface EdgeClient {
  sse<T>(path: string, body: unknown, ev: { onEvent(name: string, data: unknown): void; signal: AbortSignal }): Promise<T>;
  json<T>(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T>;
}

// sync-yjs (P5)
export interface SyncManager {
  start(auth: () => Promise<string>): void;
  stop(): void;
  status(docId: Id): SyncStatus;                     // 'synced' | 'pending' | 'error' | 'conflict' | 'off'
  onStatus(fn: (docId: Id, s: SyncStatus) => void): () => void;
  listConflicts(): Promise<ConflictRecord[]>;
  resolve(conflictId: Id, choice: 'local' | 'remote' | 'both'): Promise<void>;
}
```

---

## 8. 변경 이력

| 버전 | 날짜 | 내용 |
|---|---|---|
| v0.2 | 2026-10-02 | 3절에 로컬 전용(직접 호출) 구현 현황, `tool_choice: auto` 확정 근거, 4.1 매핑을 스키마 v3(제목 상자 · 내용 상자)과 chart-v0 · table-v0로, 타임아웃 90초로 통일(504 행) |
| v0.1 | 2026-10-01 | 초안 — 엔드포인트 목록, AI 스키마 `structure.v1`, 동기화 프로토콜, 내부 계약 |
