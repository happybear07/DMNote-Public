// 슬래시 메뉴 원본 docs/SLASH-COMMANDS.md: 모든 줄이 메뉴에 들어가고(모르는 실행 없음), 묶음 · 노션 이름이 붙고, 계획 절은 빠진다
import { describe, expect, it } from 'vitest';
import md from '../../../docs/SLASH-COMMANDS.md?raw';
import { fillSlashText, isoDay, parseSlashMd } from '../src/slash-md';
import { findEmoji } from '../src/symbols';

describe('슬래시 명령 원본 (docs/SLASH-COMMANDS.md)', () => {
  const { items, bad } = parseSlashMd(md);
  it('모든 줄을 읽음 · id가 겹치지 않음', () => {
    expect(bad).toEqual([]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.length).toBeGreaterThanOrEqual(55);
  });
  it('묶음(## 제목)이 붙고, 계획 절은 메뉴에 없음', () => {
    expect(new Set(items.map((i) => i.section))).toEqual(new Set(['기본 블록', '글 속', '미디어', '데이터베이스', '블록 동작', 'AI', '내가 만든 명령']));
    expect(items.some((i) => i.label === '사람 언급')).toBe(false);
  });
  it('노션 명령이 이름으로 이어짐', () => {
    const notion = items.map((i) => i.notion).join(' · ');
    for (const n of ['Text', 'Heading 1', 'To-do list', 'Toggle list', 'Callout', 'Table of contents', 'Board view', 'Duplicate', 'Red background', 'Inline equation', 'Video', 'Page']) expect(notion).toContain(n);
  });
  it('실행 칸 → 동작', () => {
    const by = (id: string) => items.find((i) => i.id === id)!.action;
    expect(by('h1')).toEqual({ kind: 'format', cmd: 'h1' });
    expect(by('code')).toEqual({ kind: 'format', cmd: 'code_block' });
    expect(by('db-board')).toEqual({ kind: 'insert', what: 'db-board' });
    expect(by('bg-red')).toEqual({ kind: 'insert', what: 'bg:red' });
    expect(by('duplicate')).toEqual({ kind: 'insert', what: 'action:duplicate' });
    expect(by('select')).toEqual({ kind: 'insert', what: 'action:select' }); // /선택 (10/28)
    expect(by('select-block')).toEqual({ kind: 'insert', what: 'action:select-block' });
    expect(by('date-내일')).toEqual({ kind: 'date', offset: 1 });
    expect(by('text:회의록 틀')).toMatchObject({ kind: 'text' });
  });
  it('사용자가 더한 줄 · 잘못된 줄', () => {
    const r = parseSlashMd('## 내 것\n| 이름 | 검색어 | 설명 | 실행 | 노션 |\n|---|---|---|---|---|\n| 인사 | hi, 안녕 | 인사말 | 글 안녕하세요\\n반갑습니다 \\| 끝 | - |\n| 이상한 | x | y | 넣기 없는것 | - |\n');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ label: '인사', keywords: ['hi', '안녕'], section: '내 것', action: { kind: 'text', md: '안녕하세요\n반갑습니다 | 끝' } });
    expect(r.bad).toHaveLength(1);
  });
  it('자리 표시 · 날짜', () => {
    const now = new Date(2026, 9, 8, 15, 5);
    expect(fillSlashText('{오늘} ({요일}) · {내일} · {지금}', now)).toBe('2026년 10월 8일 (목요일) · 2026년 10월 9일 · 2026년 10월 8일 오후 3:05');
    expect(isoDay(-1, now)).toBe('2026-10-07');
  });
});

describe('기호 · 이모지', () => {
  it('/기호 · /이모지 줄을 읽는다', () => {
    const { items } = parseSlashMd('## 글 속\n| 이름 | 검색어 | 설명 | 실행 | 노션 |\n|---|---|---|---|---|\n| 기호 | symbol | 기호 | 동작 symbol | - |\n| 이모지 | emoji | 이모지 | 동작 emoji | Emoji |\n');
    expect(items.map((x) => x.action)).toEqual([{ kind: 'symbols', which: 'symbol' }, { kind: 'symbols', which: 'emoji' }]);
  });
  it('이모지 찾기: 한글 · 영어 검색어, 앞부분이 맞는 것 먼저', () => {
    expect(findEmoji('하트')[0]!.e).toBe('❤️');
    expect(findEmoji('done')[0]!.e).toBe('✅');
    expect(findEmoji('없는말xyz')).toEqual([]);
  });
});
