# Claude 세션 대역 평가 (API 키 없이)

실제 Anthropic API 키가 없을 때 AI 자동 구조화를 실제 모델 동작으로 확인하는 방법이다. Claude Code 세션(워크플로 에이전트)이 앱이 보낼 요청을 그대로 받아 모델 역할을 하고, 그 답을 실제 파이프라인 · 앱에 다시 흘려 채점한다.

| 단계 | 명령 | 결과 |
|---|---|---|
| 1. 요청 뽑기 | `DN_SESSION_CAPTURE=1 pnpm exec vitest run packages/ai-pipeline/test/session-capture.test.ts` | `requests/<id>.json` — 시스템 프롬프트 · 사용자 메시지(nonce로 감싼 원문) · `emit_structure` 도구 |
| 2. 모델 역할 | 워크플로 `claude-session-structure-eval` (케이스 12건 × 3회, 에이전트마다 요청 파일 하나만 읽음 — `eval/structure`의 기대 결과는 열지 않음) | `runs/<id>.json` — `[{ run, called_tool, tool_input }]` |
| 3. 채점 | `DN_SESSION_SCORE=1 DN_EVAL_DATE=YYYY-MM-DD pnpm exec vitest run packages/ai-pipeline/test/session-score.test.ts` | `../results/<날짜>-claude-session.json` — eval/README 3절 지표 |
| 4. 앱 전체 흐름 | dev 서버 실행 후 `node e2e/ai-session.mjs [폴더]` (`DN_RUN=1·2·3`) | 가짜 API가 세션 답을 SSE로 돌려주고, 만든 블록 · 화살표 · 그래프 · 표 수가 채점과 같은지 · 겹침 · 실행 취소 |

## 한계 (실제 API 평가로 대신할 수 없는 것)

- 모델 호출 조건이 다르다: adaptive thinking · `effort` · `tool_choice`(auto + 병렬 금지) · `max_tokens` 잘림은 재현되지 않는다. 세션은 도구 입력을 JSON 문자열로 돌려준다.
- 교정 재요청(모드 A · B)은 일어나지 않는다 — 첫 응답이 전체 위반이면 그 실행은 스키마 부적합으로 센다.
- 지연(p50 · p95) · 토큰 · 비용은 잴 수 없다(`null`).
- 청크가 하나인 케이스만 있다(12건 모두 단일 청크). 긴 원문의 청크 간 병합은 실제 API 평가에서 본다.

키가 생기면 같은 케이스로 실제 API 평가를 돌려 `results/`에 나란히 두고 비교한다.
