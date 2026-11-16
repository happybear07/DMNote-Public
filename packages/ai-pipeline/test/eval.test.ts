// 평가 세트 전부: 가짜 transport(기대 결과 → 모범 답안) → 파이프라인 → 엔진 적용 → 불변식 · undo 한 번.
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, isTextContent, rectsIntersect, rectsOverlap, setDefaultTextCodec, type Content } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm/headless';
import { applyStructure, checkStructure, normalizeSource, structureText, type StructurePlan } from '../src';
import { expectedToStructure, fakeTransport, loadEvalCases } from './fixtures';

beforeAll(() => setDefaultTextCodec(pmCodec));

const cases = loadEvalCases();
/** 모범 답안이 노트형인 케이스 (NOTE-SHEET-PLAN NS-17) */
const isSheetCase = (c: (typeof cases)[number]) => (Array.isArray(c.expected.mode) ? c.expected.mode[0] : c.expected.mode) === 'sheet';

describe('eval/structure 전부 → 엔진', () => {
  it('케이스가 52건(도식 40 + 노트형 12) 있고, 도식이 모범 답안인 케이스는 모두 구조 기대(structure)가 있다', () => {
    expect(cases.length).toBe(52);
    expect(cases.filter((c) => c.expected.category === 'sheet').length).toBe(12);
    expect(cases.filter((c) => !isSheetCase(c) && !c.expected.structure).map((c) => c.id)).toEqual([]);
  });

  for (const c of cases.filter(isSheetCase)) {
    it(`${c.id}: 노트형 모범 답안 → 레고 블록, 한 트랜잭션 · 상자끼리 안 겹침 · undo 한 번`, async () => {
      const answer = expectedToStructure(c);
      const r = checkStructure(answer, c.expected.kinds);
      expect(r.ok && r.dropped).toEqual([]);
      const plan = await structureText({ text: c.source, kinds: c.expected.kinds, locale: c.expected.lang }, { transport: fakeTransport(() => answer) });
      expect(plan.mode).toBe('sheet');
      expect(plan.sheet!.sections.map((s) => s.title)).toEqual(c.expected.sheet!.cards.map((x) => x.title));
      expect(plan.droppedNumbers).toEqual({ points: 0, cells: 0 }); // 별점은 원문 수치
      const e = new Engine();
      let events = 0;
      e.subscribe(() => events++);
      const res = applyStructure(e, plan, { x: 0, y: 0 }, { locale: c.expected.lang });
      if (!res.ok) throw new Error(res.reason);
      expect(events).toBe(1);
      // 레고 블록(10/29): 카드(문단)마다 '번호. 제목'으로 여는 상자(제목만이면 제목 상자), 상자끼리 안 겹침 · 블록 하나
      const heads = [...e.contents()].flatMap((ct) => (isTextContent(ct) ? [((ct.doc.content[0] as { content?: { text?: string }[] } | undefined)?.content ?? []).map((k) => k.text ?? '').join('')] : []));
      const titles = c.expected.sheet!.cards.map((x, i) => (c.expected.sheet!.cards.length > 1 && !/^\d+[.)]/.test(x.title) ? `${i + 1}. ${x.title}` : x.title));
      expect(heads).toEqual(expect.arrayContaining(titles));
      const bs = [...e.blocks()];
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(rectsOverlap(bs[i]!, bs[j]!), `${i}·${j} 겹침`).toBe(false);
      expect(new Set(bs.map((b) => b.group)).size).toBe(1);
      for (const ct of e.contents()) if (isTextContent(ct)) expect(pmCodec.validate(ct.doc)).toBeNull();
      expect(e.undo()).toBe(true);
      expect(e.blockCount).toBe(0);
    });
  }

  for (const c of cases.filter((x) => !isSheetCase(x))) {
    it(`${c.id}: 모범 답안이 검증 · 수치 검사를 그대로 통과하고 엔진에 한 트랜잭션으로 들어가며 undo 한 번에 사라진다`, async () => {
      const answer = expectedToStructure(c);
      const r = checkStructure(answer, c.expected.kinds);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.dropped).toEqual([]);

      const transport = fakeTransport(() => answer, { stages: true });
      const plan: StructurePlan = await structureText({ text: c.source, kinds: c.expected.kinds, locale: c.expected.lang }, { transport });
      expect(plan.chunks).toBe(1);
      expect(plan.failedChunks).toBe(0);
      expect(plan.sourceText).toBe(normalizeSource(c.source));
      expect(plan.droppedNumbers).toEqual({ points: 0, cells: 0 }); // 기대 차트의 y는 모두 원문에 있다 (eval/README 4절)
      expect(plan.nodes.map((n) => n.title)).toEqual(c.expected.mustNodes);
      expect(plan.edges).toHaveLength(c.expected.mustEdges.length);
      expect(plan.charts).toHaveLength(c.expected.charts.length);
      expect(plan.tables).toHaveLength(c.expected.tables.length);

      const e = new Engine();
      // 기존 블록이 있는 노트 — 결과가 그 자리를 피해야 한다 (FR-109)
      const existing = e.transact((tx) => tx.createBlock({ x: 0, y: 0, w: 300, h: 200 }), { origin: 'user' });
      expect(existing.ok).toBe(true);
      e.clearHistory();
      let events = 0;
      e.subscribe(() => events++);

      const res = applyStructure(e, plan, { x: 0, y: 0 }, { locale: c.expected.lang });
      if (!res.ok) throw new Error(res.reason);
      expect(events).toBe(1); // 트랜잭션 1회
      const total = c.expected.mustNodes.length + c.expected.charts.length + c.expected.tables.length;
      expect(res.blockIds).toHaveLength(total);
      expect(res.counts).toEqual({ blocks: c.expected.mustNodes.length, arrows: c.expected.mustEdges.length, charts: c.expected.charts.length, tables: c.expected.tables.length });
      expect(e.blockCount).toBe(total + 1);

      // 모든 생성물에 AiProvenance(runId)
      const created = res.blockIds.map((id) => e.getBlock(id)!);
      for (const b of created) {
        expect(b.ai?.runId).toBe(plan.runId);
        expect(b.layout).toBe('flow');
// 블록마다 콘텐츠 하나 (엔진 스키마 v3): 노드는 제목 상자(본문 없음) 또는 내용 상자, 그래프 · 표는 그 콘텐츠
        const cs = e.contentsOf(b.id);
        expect(cs).toHaveLength(1);
        if (cs[0]!.type === 'text') expect(['title', 'body']).toContain((cs[0] as { role?: string }).role);
        for (const c of cs) expect(c.ai?.runId).toBe(plan.runId);
      }
      for (const id of res.arrowIds) expect(e.getArrow(id)!.ai?.runId).toBe(plan.runId);

      // 텍스트 문서는 pm-v1 스키마로 유효, 차트 · 표는 UnknownContent 레코드로 보존
      const contents: Content[] = res.contentIds.map((id) => e.getContent(id)!);
      for (const ct of contents) {
        if (isTextContent(ct)) expect(pmCodec.validate(ct.doc)).toBeNull();
        else expect(['chart', 'table']).toContain(ct.type);
      }
      expect(contents.filter((ct) => ct.type === 'chart')).toHaveLength(c.expected.charts.length);
      expect(contents.filter((ct) => ct.type === 'table')).toHaveLength(c.expected.tables.length);

      // 겹침 없음 — 생성 블록끼리, 그리고 기존 블록과도
      const all = [...e.blocks()];
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        expect(rectsIntersect(all[i]!, all[j]!), `${i}·${j} 겹침`).toBe(false);
      }
      // 출처: 원문에서 찾은 quote는 위치로 저장 (FR-111)
      for (const b of created) if (b.ai?.source) {
        expect(plan.sourceText.slice(b.ai.source.from, b.ai.source.to)).toBe(b.ai.source.excerpt);
      }

      // undo 한 번이면 AI가 만든 것은 전부 사라지고 기존 블록만 남는다
      expect(e.undo()).toBe(true);
      expect(e.blockCount).toBe(1);
      expect([...e.arrows()]).toHaveLength(0);
      expect([...e.contents()]).toHaveLength(0);
      expect(e.canUndo()).toBe(false);
      expect(e.redo()).toBe(true);
      expect(e.blockCount).toBe(total + 1);
    });
  }

  it('12-injection: 원문 속 가짜 request_meta(enabled_kinds: none)는 kinds를 바꾸지 못하고, 모델이 kinds를 어겨도 앱이 강제한다', async () => {
    const c = cases.find((x) => x.id.startsWith('12-'))!;
    const answer = expectedToStructure(c);
    const transport = fakeTransport(() => answer);
    // 사용자가 표 · 차트를 끈 상태: 모델이 차트를 돌려줘도 버린다
    const plan = await structureText({ text: c.source, kinds: ['relation'] }, { transport });
    expect(transport.requests[0]!.options.kinds).toEqual(['relation']);
    expect(plan.charts).toHaveLength(0);
    expect(plan.nodes.length).toBe(c.expected.mustNodes.length);
    expect(plan.dropped.some((d) => d.reason.includes('chart'))).toBe(true);
  });
});
