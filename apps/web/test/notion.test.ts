// 노션 가져오기 (FR-124): 내보내기 ZIP → 계획 — 페이지 계층 · CSV 데이터베이스(타입 추정) · 항목 페이지 · 링크 · 표 · 콜아웃 · 토글 · 보고
import { describe, expect, it } from 'vitest';
import { inferType, isDatabaseContent, isTableContent, isTextContent, parseCsv, type TextNode } from '@dn/engine-core';
import { planImport } from '../src/import';
import { makeZip } from '../src/zip';

const A = 'a'.repeat(32), B = 'b'.repeat(32), D = 'd'.repeat(32), R1 = '1'.repeat(32), R2 = '2'.repeat(32);

function notionZip(): File {
  const z = makeZip([
    { path: `Export/프로젝트 ${A}.md`, data: `# 프로젝트\n\n개요는 [회의록](%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%20${A}/%ED%9A%8C%EC%9D%98%EB%A1%9D%20${B}.md) 참고.\n\n[과제](%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%20${A}/%EA%B3%BC%EC%A0%9C%20${D}.csv)\n\n<aside>\n💡 중요한 메모\n</aside>\n\n<details>\n<summary>접힌 내용</summary>\n안쪽 글\n</details>\n\n| 이름 | 값 |\n| --- | --- |\n| 가 | 1 |\n| 나 | 2 |\n` },
    { path: `Export/프로젝트 ${A}/회의록 ${B}.md`, data: `# 회의록\n\n안건 정리. [첨부](file.pdf)\n` },
    { path: `Export/프로젝트 ${A}/과제 ${D}.csv`, data: '﻿이름,상태,마감,점수,완료,태그\n보고서,진행 중,"October 4, 2026",80,Yes,"수학, 영어"\n발표,완료,2026/10/10,95,No,영어\n복습,진행 중,,60,No,"수학, 과학"\n' },
    { path: `Export/프로젝트 ${A}/과제 ${D}_all.csv`, data: '﻿이름,상태,마감,점수,완료,태그\n보고서,진행 중,"October 4, 2026",80,Yes,"수학, 영어"\n발표,완료,2026/10/10,95,No,영어\n복습,진행 중,,60,No,"수학, 과학"\n' },
    { path: `Export/프로젝트 ${A}/과제 ${D}/보고서 ${R1}.md`, data: `# 보고서\n\n상태: 진행 중\n마감: October 4, 2026\n\n보고서 본문\n` },
    { path: `Export/프로젝트 ${A}/과제 ${D}/발표 ${R2}.md`, data: `# 발표\n\n상태: 완료\n\n발표 본문\n` },
  ]);
  return new File([z], 'Export.zip', { type: 'application/zip' });
}
const allText = (n: TextNode): string => (n.text ?? '') + (n.content ?? []).map(allText).join('');

describe('노션 가져오기', () => {
  it('CSV 읽기 · 타입 추정', () => {
    expect(parseCsv('a,"b,c","d ""e"""\n1,2,3\n')).toEqual([['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
    expect(inferType(['1,200', '30', ''])).toBe('number');
    expect(inferType(['Yes', 'No'])).toBe('checkbox');
    expect(inferType(['October 4, 2026', '2026/10/10'])).toBe('date');
    expect(inferType(['진행 중', '완료', '진행 중'])).toBe('select');
    expect(inferType(['수학, 영어', '영어', '수학, 과학'])).toBe('multiSelect');
    expect(inferType(['https://a.com', 'http://b.org/x'])).toBe('url');
    expect(inferType(['긴 설명 하나', '또 다른 설명'])).toBe('text');
  });

  it('페이지 계층 · 데이터베이스 · 항목 페이지 · 링크 · 블록 매핑 · 보고', async () => {
    const plan = await planImport([notionZip()], { notes: [], trash: [] });
    expect(plan.source).toContain('노션');
    const byTitle = new Map(plan.notes.map((n) => [n.title, n]));
    expect([...byTitle.keys()].sort()).toEqual(['발표', '보고서', '프로젝트', '회의록']);
    const root = byTitle.get('프로젝트')!, meeting = byTitle.get('회의록')!, report = byTitle.get('보고서')!;
    expect(root.parentNoteId).toBeUndefined();
    expect(meeting.parentNoteId).toBe(root.id); // 하위 페이지 → 하위 노트
    expect(report.parentNoteId).toBe(root.id); // 항목 페이지 → 데이터베이스가 있는 노트 아래
    // 프로젝트 노트: 글 상자 + 데이터베이스 + 표
    const e = root.build(new Map());
    const contents = [...e.contents()];
    const db = contents.find(isDatabaseContent)!;
    expect(db.title).toBe('과제');
    expect(db.properties.map((p) => p.type)).toEqual(['text', 'select', 'date', 'number', 'checkbox', 'multiSelect']);
    expect(db.rows).toHaveLength(3);
    const r0 = db.rows.find((r) => r.values[db.properties[0]!.id] === '보고서')!;
    expect(r0.values[db.properties[2]!.id]).toBe('2026-10-04');
    expect(r0.values[db.properties[4]!.id]).toBe(true);
    expect((r0.values[db.properties[5]!.id] as string[]).length).toBe(2);
    expect(r0.page).toBe(report.id);
    expect(report.extra?.dbRef).toEqual({ noteId: root.id, contentId: db.id, rowId: r0.id });
    expect(contents.some(isTableContent)).toBe(true);
    const text = contents.find(isTextContent)!.doc;
    const kinds = text.content.map((n) => n.type);
    expect(kinds).toContain('callout');
    expect(kinds).toContain('toggle');
    const link = JSON.stringify(text).includes(`"id":"${meeting.id}"`);
    expect(link).toBe(true); // 페이지 링크 → 노트 링크
    expect(allText(text)).not.toContain('.csv');
    // 항목 페이지 본문에서 속성 줄은 뺀다
    const rb = [...report.build(new Map()).contents()].find(isTextContent)!.doc;
    expect(allText(rb)).toBe('보고서 본문');
    // 보고: 변환 못 한 첨부 파일
    expect(plan.warnings.join(' ')).toContain('첨부 파일 (.pdf) 1개');
    expect(plan.warnings.join(' ')).toContain('데이터베이스 1개');
  });
});
