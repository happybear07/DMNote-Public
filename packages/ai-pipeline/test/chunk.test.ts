// 정규화 (AI-PROMPTS 5절) · 청킹 (6절).
import { describe, expect, it } from 'vitest';
import { CHUNK_HARD, CHUNK_SINGLE, CHUNK_TARGET, chunkText, normalizeSource, visibleLength } from '../src';

describe('normalizeSource', () => {
  it('NFC · CRLF · NBSP · 폭 없는 문자 · 채팅 UI 잔여물 · 줄 끝 공백 · 빈 줄 3개 이상', () => {
    const decomposed = '가'; // ㄱ + ㅏ (자모 분리)
    const src = `${decomposed}나다\r\nChatGPT said:\r\n본문 입니다​.   \r\n\r\n\r\n\r\n\r\n다음\nCopy code\n`;
    expect(normalizeSource(src)).toBe('가나다\n본문 입니다.\n\n\n다음');
  });

  it('글자는 바꾸지 않는다 — 숫자 쉼표 · 단위 · 표 · 오탈자', () => {
    const s = '| 항목 | 값 |\n|---|---|\n| 매출 | 1,240억 원 |\n오타있는문장';
    expect(normalizeSource(s)).toBe(s);
  });

  it('잔여물은 한 줄 전체가 정확히 같을 때만, 코드 블록 안은 그대로', () => {
    expect(normalizeSource('Edit this file\nEdit\n```\nEdit\n```')).toBe('Edit this file\n```\nEdit\n```');
  });

  it('visibleLength는 공백을 세지 않는다', () => expect(visibleLength(' a b\n c ')).toBe(3));
});

describe('chunkText', () => {
  const sentence = (i: number) => `문장 ${i}번은 청킹 경계를 시험하기 위한 내용입니다. `;
  const section = (h: string, n: number) => `## ${h}\n\n` + Array.from({ length: n }, (_, i) => sentence(i)).join('') + '\n';

  it('7,000자 이하면 나누지 않는다', () => {
    const s = 'a'.repeat(CHUNK_SINGLE);
    expect(chunkText(s)).toEqual([{ index: 0, count: 1, text: s, start: 0, end: CHUNK_SINGLE }]);
  });

  it('긴 붙여넣기 정확도(10/13 요청): 1만 자 글은 두 번에 나눠 보낸다 — 요청마다 상자 60개 안에 담기게', () => {
    const src = section('하나', 110) + '\n' + section('둘', 110) + '\n' + section('셋', 110);
    expect(src.length).toBeGreaterThan(CHUNK_SINGLE);
    expect(src.length).toBeLessThan(14_000); // 예전 기준(14,000자)이면 한 번에 보냈다
    expect(chunkText(src).length).toBeGreaterThanOrEqual(2);
  });

  it('H2 경계에서 자르고, 원문 범위가 빈틈없이 이어진다', () => {
    const src = section('하나', 120) + '\n' + section('둘', 120) + '\n' + section('셋', 120);
    const cs = chunkText(src);
    expect(cs.length).toBeGreaterThan(1);
    expect(cs[0]!.start).toBe(0);
    for (let i = 1; i < cs.length; i++) expect(cs[i]!.start).toBe(cs[i - 1]!.end);
    expect(cs.at(-1)!.end).toBe(src.length);
    for (const c of cs) {
      expect(c.text.length).toBeLessThanOrEqual(CHUNK_TARGET);
      expect(c.count).toBe(cs.length);
    }
    expect(cs[1]!.text.startsWith('## ')).toBe(true);
  });

  it('겹침 문맥: 이전 청크의 마지막 문단 ≤ 600자 + 제목 경로', () => {
    const src = '# 문서\n\n' + section('하나', 280) + '\n' + section('둘', 280);
    const cs = chunkText(src);
    const ctx = cs[1]!.precedingContext!;
    const [head, ...rest] = ctx.split('\n');
    expect(head).toBe('(section: # 문서 > ## 하나)');
    expect(rest.join('\n').length).toBeLessThanOrEqual(600);
    expect(cs[0]!.text.trimEnd().endsWith(rest.join('\n'))).toBe(true);
  });

  it('코드 펜스 · 표는 쪼개지 않는다', () => {
    const prose = Array.from({ length: 200 }, (_, i) => sentence(i)).join('');
    const code = '```ts\n' + Array.from({ length: 400 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n```';
    const src = prose + '\n\n' + code + '\n\n' + prose;
    const cs = chunkText(src);
    const holder = cs.filter((c) => c.text.includes('const v0 ='));
    expect(holder).toHaveLength(1);
    expect(holder[0]!.text).toContain('const v399 = 399;');
  });

  it('하드 상한을 넘는 표는 행 단위로 나누고 조각마다 머리 행을 반복한다', () => {
    const header = '| 이름 | 설명 |\n|---|---|';
    const rows = Array.from({ length: 900 }, (_, i) => `| 항목${i} | ${'설명'.repeat(10)} ${i} |`).join('\n');
    const cs = chunkText(header + '\n' + rows);
    expect(cs.length).toBeGreaterThan(1);
    for (const c of cs) {
      expect(c.text.startsWith(header)).toBe(true);
      expect(c.text.length).toBeLessThanOrEqual(CHUNK_HARD);
    }
  });
});
