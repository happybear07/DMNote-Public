// 수렴 속성 시험이 찾은 반례 (SYNC.md 19.2) — 줄인 명령 열을 고정해 커밋마다 다시 돌린다. 새 반례는 json을 더하고 여기에 한 줄
import type { Action } from '../harness';
import s401 from './s4-01-dup-ungroup-undo.json';
import s402 from './s4-02-convert-delete.json';
import s403 from './s4-03-partial-rewire.json';

export interface Regression { name: string; n: number; found: string; why: string; actions: Action[] }

export const REGRESSIONS: Regression[] = [
  { name: 's4-01', ...(s401 as Omit<Regression, 'name' | 'why'>), why: '블록 지우기가 엔진의 옛 연결을 보고 화살표까지 지움 — Y에서는 다른 블록으로 다시 이어져 살아 있었다 (reconcile 고침)' },
  { name: 's4-02', ...(s402 as Omit<Regression, 'name' | 'why'>), why: '하네스 판정 오류 — 같은 필드 동시 쓰기에서 진 고침을 모르는 고침으로 셈 (P-S3를 최종 Y 기준으로 고침)' },
  { name: 's4-03', ...(s403 as Omit<Regression, 'name' | 'why'>), why: '프레임 일부만 먼저 받으면 Yjs가 새 값은 보류하고 옛 값 삭제만 적용해 화살표의 to가 잠깐 비었다 — 양 끝이 없는 화살표 · 부모 없는 획은 숨김 (normalize 고침)' },
];
