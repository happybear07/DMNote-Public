// 스키마에 안 맞는 글 문서 고치기 (SYNC.md 13.4 N7): 맞는 블록은 그대로, 안 맞는 블록만 같은 글자의 문단으로
import { describe, expect, it } from 'vitest';
import type { TextDoc } from '@dn/engine-core';
import { pmCodec, toNode } from '../src/headless';

const repair = (d: unknown) => pmCodec.repair!(d);
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('repairDoc', () => {
  it('맞는 문서는 그대로 (같은 객체)', () => {
    const doc = { type: 'doc', content: [p('그대로')] } as TextDoc;
    expect(repair(doc)).toBe(doc);
  });

  it('목록 안에 목록 항목 대신 문단이 들어간 블록만 문단으로 펼치고, 앞뒤 블록과 서식은 지킨다', () => {
    const bold = { type: 'text', text: '굵게', marks: [{ type: 'strong' }] };
    const doc = {
      type: 'doc',
      content: [
        p('앞 문단'),
        { type: 'bullet_list', content: [
          { type: 'list_item', content: [p('항목 하나')] },
          { type: 'paragraph', content: [bold, { type: 'text', text: ' 끼어든 줄' }] }, // 스키마 위반
        ] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '뒤 제목' }] },
      ],
    };
    expect(pmCodec.validate(doc)).not.toBeNull();
    const fixed = repair(doc);
    expect(pmCodec.validate(fixed)).toBeNull();
    const n = toNode(fixed);
    expect(n.textContent).toBe('앞 문단항목 하나굵게 끼어든 줄뒤 제목');
    expect(fixed.content[0]).toEqual(p('앞 문단'));
    expect(fixed.content[fixed.content.length - 1]!.type).toBe('heading');
    expect(JSON.stringify(fixed)).toContain('"strong"');
  });

  it('모르는 노드 · 빈 문서도 맞는 문서가 된다', () => {
    expect(pmCodec.validate(repair({ type: 'doc', content: [{ type: '없는노드', content: [{ type: 'text', text: '글' }] }] }))).toBeNull();
    expect(pmCodec.validate(repair({ type: 'doc', content: [] }))).toBeNull();
    expect(toNode(repair({ type: 'doc', content: [{ type: '없는노드', content: [{ type: 'text', text: '글' }] }] })).textContent).toBe('글');
  });
});
