// 스키마 v4 (FR-018): 표 · 그래프 정식 형식, v3 임시 형식(table-v0 · chart-v0) 변환
import { describe, expect, it } from 'vitest';
import {
  cellText, chartCategories, deserialize, formatDuration, mediaKind, Engine, newId, isChartContent, isTableContent, makeTable, SCHEMA_VERSION, serialize, sortedRows, type TableContent,
} from '../src';

describe('스키마 v4 — 표 · 그래프', () => {
  it('현재 버전은 6', () => { expect(SCHEMA_VERSION).toBe(6); });

  it('v3 스냅샷의 table-v0 · chart-v0 → v4 (id · 블록 · AI 출처 유지, 다른 콘텐츠는 그대로)', () => {
    const [N, b1, b2, b3, t1, c1, x1] = Array.from({ length: 7 }, () => newId()) as [string, string, string, string, string, string, string];
    const v3 = {
      schemaVersion: 3, engine: { textSchema: 'pm-v1' },
      note: { id: N, title: '', createdAt: 0, updatedAt: 0 },
      blocks: {
        [b1]: { id: b1, x: 0, y: 0, w: 300, h: 100, sizing: 'auto', layout: 'flow', z: 'a0' },
        [b2]: { id: b2, x: 0, y: 200, w: 300, h: 100, sizing: 'auto', layout: 'flow', z: 'a1' },
        [b3]: { id: b3, x: 0, y: 400, w: 300, h: 100, sizing: 'auto', layout: 'flow', z: 'a2' },
      },
      contents: {
        [t1]: { id: t1, blockId: b1, order: 'a0', type: 'table', schema: 'table-v0', title: '요금', columns: ['플랜', '가격'], rows: [['기본', '9,900원'], ['프로', '—']], ai: { generated: true, runId: 'r1' } },
        [c1]: { id: c1, blockId: b2, order: 'a0', type: 'chart', schema: 'chart-v0', chartKind: 'line', title: '배포', unit: '회', series: [{ name: '횟수', points: [{ x: '1월', y: 24 }, { x: '2월', y: 17 }] }] },
        [x1]: { id: x1, blockId: b3, order: 'a0', type: 'text', role: 'body', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '글' }] }] } },
      },
      arrows: {}, strokes: {},
    };
    const r = deserialize(v3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(3);
    const e = new Engine(r.data);
    const t = e.getContent(t1);
    expect(isTableContent(t)).toBe(true);
    const table = t as TableContent;
    expect(table.ai).toEqual({ generated: true, runId: 'r1' });
    expect(table.blockId).toBe(b1);
    expect((table as unknown as Record<string, unknown>).schema).toBeUndefined();
    expect(table.columns.map((c) => c.name)).toEqual(['플랜', '가격']);
    expect(sortedRows(table).map((row) => table.columns.map((c) => cellText(row.cells[c.id])))).toEqual([['기본', '9,900원'], ['프로', '—']]);
    const c = e.getContent(c1);
    expect(isChartContent(c) && c.kind === 'line' && c.unit === '회' && c.series[0]!.id.length > 0 && c.series[0]!.points.length === 2).toBe(true);
    expect(e.getContent(x1)).toMatchObject({ type: 'text', role: 'body' });
    // v4로 다시 저장해도 같은 모양
    const again = deserialize(serialize(e));
    expect(again.ok && again.migratedFrom === undefined && isTableContent(new Engine(again.data).getContent(t1))).toBe(true);
  });

  it('표 셀 편집은 rows 필드 하나 — 실행 취소 한 번에 되돌아간다', () => {
    const e = new Engine();
    let id = '';
    e.transact((tx) => {
      const b = tx.createBlock({ x: 0, y: 0, w: 300, h: 100 });
      id = tx.createContent({ blockId: b, type: 'table', ...makeTable(['a', 'b'], [['1', '2']]) } as never);
    }, { origin: 'user' });
    const t = e.getContent(id) as TableContent;
    const row = t.rows[0]!, col = t.columns[1]!;
    const rows = t.rows.map((r) => ({ ...r, cells: { ...r.cells, [col.id]: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '바뀜' }] }] } } }));
    e.transact((tx) => tx.set('content', id, { rows }), { origin: 'user', label: '표 칸 편집' });
    expect(cellText((e.getContent(id) as TableContent).rows[0]!.cells[col.id])).toBe('바뀜');
    e.undo();
    expect(cellText((e.getContent(id) as TableContent).rows[0]!.cells[col.id])).toBe('2');
    expect(row.id).toBe((e.getContent(id) as TableContent).rows[0]!.id);
  });
});

describe('그래프 항목 순서 · 소리 · 영상', () => {
  it('categories가 있으면 그 순서, 없으면 계열마다의 순서를 지키며 합친다 (빈 칸 때문에 순서가 흔들리지 않는다)', () => {
    const pts = (...xs: string[]) => xs.map((x, i) => ({ x, y: i }));
    // 2023의 2월이 빈 칸 → 처음 본 순서로 모으면 [1월, 3월, 2월]이 되던 문제
    expect(chartCategories({ series: [{ points: pts('1월', '3월') }, { points: pts('1월', '2월', '3월') }] })).toEqual(['1월', '2월', '3월']);
    expect(chartCategories({ categories: ['1월', '2월', '3월', '4월'], series: [{ points: pts('1월', '3월') }] })).toEqual(['1월', '2월', '3월', '4월']);
    // categories에 없는 x는 그 계열의 앞 항목 뒤에
    expect(chartCategories({ categories: ['A', 'C'], series: [{ points: pts('A', 'B', 'C') }] })).toEqual(['A', 'B', 'C']);
  });

  it('소리 · 영상 판별 · 재생 시간 표기', () => {
    expect([mediaKind('audio/webm'), mediaKind('video/mp4'), mediaKind('application/pdf')]).toEqual(['audio', 'video', null]);
    expect([formatDuration(4), formatDuration(65.4), formatDuration(3723)]).toEqual(['0:04', '1:05', '1:02:03']);
  });
});
