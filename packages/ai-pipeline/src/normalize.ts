// 입력 정규화 (AI-PROMPTS 5절). 원문 글자는 바꾸지 않는다 — 인용(source.quote)과 수치 검사가 이 텍스트를 기준으로 원문을 대조한다.
// text/html → Markdown 변환(1단계)은 붙여넣기 쪽(TextCodec, FR-031)이 하고 여기에는 Markdown/평문만 들어온다.

/** 채팅 UI 잔여물: 한 줄 전체가 정확히 이것일 때만 지운다 (부분 일치로 지우면 본문이 다친다). */
const RESIDUE = new Set([
  'Copy code', '코드 복사', 'ChatGPT said:', 'ChatGPT의 말:', 'You said:', '나의 말:', 'Edit', 'Retry', 'Share',
]);

export const MIN_CHARS = 20;
export const MAX_CHARS = 120_000;

export function normalizeSource(text: string): string {
  let s = text.normalize('NFC');
  s = s.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[​-‍﻿]/g, '');
  let fence = false; // 코드 블록 안의 줄은 잔여물처럼 보여도 코드다
  const lines = s.split('\n').filter((l) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    return fence || !RESIDUE.has(l.trim());
  }).map((l) => l.replace(/[ \t]+$/, ''));
  s = lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
  return s.replace(/^\n+/, '').replace(/\n+$/, '');
}

/** 공백이 아닌 글자 수 — 20자 미만이면 호출하지 않는다 */
export function visibleLength(s: string): number {
  return s.replace(/\s+/g, '').length;
}
