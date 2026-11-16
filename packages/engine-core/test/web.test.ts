// 웹 북마크 · 임베드 (FR-050 · FR-051): 주소 판별 · 끼워 넣기 허용 목록 · 만들기 · 주소 바꾸기 · 정보 채우기(실행 취소 대상 아님).
import { describe, expect, it } from 'vitest';
import { createWebBlock, embedTarget, Engine, isWebContent, setWebContent, setWebMeta, webBlockSize, webUrl } from '../src';

const content = (e: Engine, blockId: string) => { const c = e.contentsOf(blockId)[0]; if (!isWebContent(c)) throw new Error('web 아님'); return c; };

describe('웹 주소', () => {
  it('http · https만 주소로', () => {
    expect(webUrl('  https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1');
    expect(webUrl('javascript:alert(1)')).toBeNull();
    expect(webUrl('example.com')).toBeNull();
    expect(webUrl('https://a b')).toBeNull();
  });

  it('끼워 넣기 허용 목록 — 서비스마다 iframe 주소로', () => {
    expect(embedTarget('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42')).toEqual({ src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42', provider: 'YouTube', ratio: 16 / 9 });
    expect(embedTarget('https://youtu.be/dQw4w9WgXcQ')?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(embedTarget('https://www.youtube.com/shorts/abcdefGHIJK')?.src).toBe('https://www.youtube-nocookie.com/embed/abcdefGHIJK');
    expect(embedTarget('https://vimeo.com/76979871')?.src).toBe('https://player.vimeo.com/video/76979871');
    expect(embedTarget('https://www.figma.com/design/AbC123/Name?node-id=1-2')?.src).toBe(`https://www.figma.com/embed?embed_host=damiannote&url=${encodeURIComponent('https://www.figma.com/design/AbC123/Name?node-id=1-2')}`);
    expect(embedTarget('https://codepen.io/team/pen/xyzAB')?.src).toBe('https://codepen.io/team/embed/xyzAB?default-tab=result');
    expect(embedTarget('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toMatchObject({ src: 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC', height: 152 });
    expect(embedTarget('https://docs.google.com/document/d/1AbC_d-E/edit')?.src).toBe('https://docs.google.com/document/d/1AbC_d-E/preview');
    expect(embedTarget('https://www.google.com/maps/place/Seoul+Station/@37.55,126.97,17z')?.src).toBe('https://maps.google.com/maps?q=Seoul%20Station&output=embed');
    expect(embedTarget('https://www.google.com/maps/@37.55,126.97,17z')?.src).toBe(`https://maps.google.com/maps?q=${encodeURIComponent('37.55,126.97')}&output=embed`);
  });

  it('허용 목록 밖 · 이상한 id는 null (카드로 대신)', () => {
    expect(embedTarget('https://example.com/video')).toBeNull();
    expect(embedTarget('https://www.youtube.com/watch?v=<script>')).toBeNull();
    expect(embedTarget('https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(embedTarget('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(embedTarget('ftp://youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('블록 크기 — 카드는 낮게, 끼워 넣기는 비율 + 머리 줄', () => {
    expect(webBlockSize('https://example.com', 'bookmark')).toEqual({ w: 440, h: 104 });
    expect(webBlockSize('https://youtu.be/dQw4w9WgXcQ', 'embed')).toEqual({ w: 480, h: 298 });
    expect(webBlockSize('https://example.com', 'embed')).toEqual({ w: 440, h: 104 });
    expect(webBlockSize('', 'embed')).toEqual({ w: 480, h: 298 });
    expect(webBlockSize('', 'bookmark')).toEqual({ w: 440, h: 88 });
  });
});

describe('웹 블록', () => {
  it('빈 주소로 만들고 → 주소 넣기(실행 취소 대상) → 정보 채우기는 실행 취소 대상이 아니다', () => {
    const e = new Engine();
    const r = createWebBlock(e, { x: 0, y: 0 }, '', 'bookmark');
    if (!r.ok) throw new Error(r.reason);
    const { blockId, contentId } = r.value;
    expect(content(e, blockId)).toMatchObject({ type: 'web', url: '', view: 'bookmark' });
    expect(setWebContent(e, contentId, { url: 'https://example.com/' }).ok).toBe(true);
    expect(setWebMeta(e, contentId, 'https://example.com/', { title: '  예시  ', description: '설명', image: 'javascript:x', site: '예시 사이트' }).ok).toBe(true);
    expect(content(e, blockId)).toMatchObject({ url: 'https://example.com/', title: '예시', description: '설명', site: '예시 사이트' });
    expect(content(e, blockId).image).toBeUndefined();
    // 실행 취소 한 번 = 주소 넣기 취소 (정보 채우기는 건너뜀)
    e.undo();
    expect(content(e, blockId).url).toBe('');
  });

  it('주소를 바꾸면 옛 정보는 비우고, 늦게 온 옛 주소 정보는 버린다', () => {
    const e = new Engine();
    const r = createWebBlock(e, { x: 0, y: 0 }, 'https://a.com/', 'bookmark', { title: 'A' });
    if (!r.ok) throw new Error(r.reason);
    setWebContent(e, r.value.contentId, { url: 'https://b.com/' });
    expect(content(e, r.value.blockId).title).toBeUndefined();
    expect(setWebMeta(e, r.value.contentId, 'https://a.com/', { title: 'A' }).ok).toBe(false);
    expect(content(e, r.value.blockId).title).toBeUndefined();
  });

  it('카드 ↔ 끼워 넣기 바꾸기', () => {
    const e = new Engine();
    const r = createWebBlock(e, { x: 0, y: 0 }, 'https://youtu.be/dQw4w9WgXcQ', 'embed');
    if (!r.ok) throw new Error(r.reason);
    setWebContent(e, r.value.contentId, { view: 'bookmark' });
    expect(content(e, r.value.blockId).view).toBe('bookmark');
    e.undo();
    expect(content(e, r.value.blockId).view).toBe('embed');
  });

  it('끼워 넣어 보기로 커지면 블록 높이 · 아래 상자를 그만큼 내림 (DQ-024), 실행 취소 한 번에 되돌림', () => {
    const e = new Engine();
    const r = createWebBlock(e, { x: 0, y: 0 }, 'https://youtu.be/dQw4w9WgXcQ', 'bookmark');
    if (!r.ok) throw new Error(r.reason);
    const below = e.transact((tx) => tx.createBlock({ x: 600, y: 120, w: 200, h: 40 }), { origin: 'user' });
    if (!below.ok) throw new Error('setup');
    const h0 = e.getBlock(r.value.blockId)!.h;
    setWebContent(e, r.value.contentId, { view: 'embed' });
    const b = e.getBlock(r.value.blockId)!;
    expect(b.h).toBe(webBlockSize('https://youtu.be/dQw4w9WgXcQ', 'embed', b.w).h);
    expect(e.getBlock(below.value)!.y).toBeGreaterThanOrEqual(b.y + b.h);
    e.undo();
    expect([e.getBlock(r.value.blockId)!.h, e.getBlock(below.value)!.y]).toEqual([h0, 120]);
    // 카드로 돌아갈 때는 아무것도 옮기지 않는다
    setWebContent(e, r.value.contentId, { view: 'bookmark' });
    expect(e.getBlock(below.value)!.y).toBe(120);
  });
});
