// PDF 쓰기: 머리 · 쪽 수 · 그림 크기 · xref 위치가 실제 객체 위치와 맞는가(뷰어가 열 수 있는 구조) · 한글 제목
import { describe, expect, it } from 'vitest';
import { imagesToPdf } from '../src/pdf';

const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, ...Array.from({ length: n }, (_, i) => i % 256), 0xff, 0xd9]);

describe('PDF 쓰기', () => {
  it('쪽마다 그림 하나 · xref가 객체 위치를 정확히 가리킴 · 한글 제목', async () => {
    const blob = imagesToPdf([{ jpeg: jpeg(500), w: 1588, h: 2246 }, { jpeg: jpeg(300), w: 1588, h: 2246 }], '회의록');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(blob.type).toBe('application/pdf');
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toContain('/Type /Pages /Count 2');
    expect(text.match(/\/Subtype \/Image \/Width 1588 \/Height 2246/g)).toHaveLength(2);
    expect(text).toContain('/Title <FEFFD68CC758B85D>'); // 회의록
    const start = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const rows = text.slice(start).split('\n').slice(3).filter((l) => / 00000 n $/.test(l));
    rows.forEach((row, i) => { const off = Number(row.slice(0, 10)); expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`); });
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});
