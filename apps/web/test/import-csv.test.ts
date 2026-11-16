// CSV 가져오기 (GAP #13): 노션 내보내기가 아닌 .csv 하나 = 데이터베이스 블록 하나인 노트 (빈 글 상자 없이)
import { describe, expect, it } from 'vitest';
import { isDatabaseContent, isTextContent } from '@dn/engine-core';
import { planImport } from '../src/import';

const ex = { notes: [], trash: [], folders: [], tags: [], templates: [] };

describe('CSV 가져오기', () => {
  it('파일 하나 → 같은 이름 노트 + 데이터베이스(타입 추정), 글 상자는 없다', async () => {
    const f = new File(['\uFEFF이름,상태,점수\r\n보고서,진행 중,80\r\n발표,완료,95\r\n복습,진행 중,60\r\n'], '과제 목록.csv', { type: 'text/csv' });
    const plan = await planImport([f], ex as never);
    expect(plan.heading).toBe('CSV 가져오기');
    expect(plan.notes.map((n) => n.title)).toEqual(['과제 목록']);
    expect(plan.warnings.join(' ')).toContain('항목 3개');
    const e = plan.notes[0]!.build();
    const contents = [...e.blocks()].flatMap((b) => e.contentsOf(b.id));
    expect(contents.some(isTextContent)).toBe(false);
    const db = contents.find(isDatabaseContent)!;
    expect(db.title).toBe('과제 목록');
    expect(db.properties.map((p) => [p.name, p.type])).toEqual([['이름', 'text'], ['상태', 'select'], ['점수', 'number']]);
    expect(db.rows).toHaveLength(3);
  });

  it('Markdown과 같이 고르면 둘 다', async () => {
    const md = new File(['# 메모\n\n본문'], '메모.md', { type: 'text/markdown' });
    const csv = new File(['a,b\n1,2\n'], '표.csv', { type: 'text/csv' });
    const plan = await planImport([md, csv], ex as never);
    expect(plan.notes.map((n) => n.title).sort()).toEqual(['메모', '표']);
  });
});
