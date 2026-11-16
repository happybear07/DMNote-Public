// 노트에 묻기 범위 좁히기 (2026-10-26): 전체 노트 질문은 역할 · 태그 → 요약 카드 순으로 좁히고, 앞 단계에서 근거가 안 나오면 다음 단계로,
// 어디에도 안 걸리면 근거 없음(Claude를 부르지 않는다). 직접 고른 범위(현재 노트 · 폴더 · 태그 · 역할)는 그대로.
import { beforeAll, describe, expect, it } from 'vitest';
import { createTextBlock, Engine, setDefaultTextCodec } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm/headless';
import { BUILTIN_ROLES, extractSearchDoc, SearchIndex } from '@dn/search';
import type { NoteMeta, Tag } from '@dn/storage-idb';
import { QaCtl } from '../src/qa-flow';
import { scopeStagesFor } from '../src/note-scope';

beforeAll(() => setDefaultTextCodec(pmCodec));

const index = new SearchIndex();
const metas: NoteMeta[] = [];
const tags: Tag[] = [{ id: 't-pay', name: '결제', nameKey: '결제', createdAt: 0 }];
function note(id: string, title: string, bodies: string[], extra: Partial<NoteMeta> = {}, heads: string[] = []) {
  const e = new Engine({ note: { id, title, createdAt: 0, updatedAt: 0 } });
  heads.forEach((h, i) => createTextBlock(e, { x: 0, y: i * 100 }, { kind: 'title', title: h }));
  bodies.forEach((b, i) => createTextBlock(e, { x: 600, y: i * 200 }, { body: b }));
  index.put(extractSearchDoc(e, 1));
  metas.push({ id, title, createdAt: 0, updatedAt: metas.length + 1, schemaVersion: 1, ...extra });
}
note('m1', '10월 3주 회의', ['결제 연동은 금요일까지 끝내기로 함'], { role: 'meeting', tagIds: ['t-pay'] });
note('m2', '10월 2주 회의', ['디자인 시안 검토'], { roleGuess: 'meeting' });
note('l1', '경제 강의', ['결제 수단의 역사와 연동 방식'], { role: 'lecture', tagIds: ['t-pay'] });
note('trip', '제주 여행', ['숙소는 애월, 렌터카 예약 완료'], {}, ['숙소', '예산']);

function ctl() {
  const h = {
    meta: null as never, consent: true, hasKey: true, qa: null, notes: metas, folders: [], tags, roles: BUILTIN_ROLES, currentId: null,
    passages: (q: string, ns: readonly { id: string; title: string; updatedAt: number }[]) => index.passages(q, ns),
    scopeStages: (q: string, ns: readonly { id: string; title: string; updatedAt: number }[]) => scopeStagesFor(q, ns, metas, tags, index, BUILTIN_ROLES),
    patch: () => {}, toast: () => {}, askConsent: () => {}, askKey: () => {}, openBlock: async () => true, saveNote: async () => {}, insertHere: () => null, structure: () => {},
  };
  return new QaCtl(h);
}

describe('노트에 묻기 범위 좁히기', () => {
  it('회의 + #결제가 걸리면 회의록 · 결제 태그 노트에서만 근거를 찾는다 (강의 노트의 "결제 연동"은 빠짐)', () => {
    const r = ctl().findPassages('지난 회의에서 결제 연동 일정 어떻게 됐어?', { kind: 'all' });
    expect(r.label).toBe('전체 노트 중 회의록 노트 · #결제 1개');
    expect(new Set(r.passages.map((p) => p.noteId))).toEqual(new Set(['m1']));
  });

  it('역할 · 태그가 안 걸리면 요약 카드(소제목 "숙소")로 고른 노트에서', () => {
    const r = ctl().findPassages('숙소 어디로 했지?', { kind: 'all' });
    expect(r.label).toBe('전체 노트 중 요약 카드로 고른 노트 1개');
    expect([...new Set(r.passages.map((p) => p.noteId))]).toEqual(['trip']);
  });

  it('역할 단계에 근거가 없으면 요약 카드 단계로 넘어간다', () => {
    // "회의"는 회의록 역할에 걸리지만 회의록 노트에는 "렌터카"가 없다 → 요약 카드 단계에서도 못 찾으면 근거 없음
    const r = ctl().findPassages('회의 때 렌터카 얘기', { kind: 'all' });
    expect(r.passages.every((p) => p.noteId !== 'l1')).toBe(true);
  });

  it('어디에도 안 걸리면 근거 없음 — Claude를 부르지 않는 경로', () => {
    const r = ctl().findPassages('우주 망원경 관측 결과', { kind: 'all' });
    expect(r.passages).toEqual([]);
    expect(r.label).toContain('없음');
  });

  it('직접 고른 범위(역할 · 태그)는 좁히지 않고 그대로 — 추정 역할도 역할 범위에 든다', () => {
    const c = ctl();
    expect(c.findPassages('디자인 시안', { kind: 'role', id: 'meeting' }).passages.map((p) => p.noteId)).toEqual(['m2']);
    expect(c.findPassages('연동', { kind: 'tag', id: 't-pay' }).passages.map((p) => p.noteId).sort()).toEqual(['l1', 'm1']);
    expect(c.scopeLabel({ kind: 'role', id: 'meeting' })).toBe('역할: 회의록');
  });
});
