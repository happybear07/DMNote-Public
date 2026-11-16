// 배포 전 고친 것 (11/11 — DEMO-SECURITY-CHECK · DEMO-LEGAL-CHECK): 백업 첨부 형식 허용 목록 · 화면 문구가 'AI 학습'을 말하지 않음
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { safeMime } from '../src/import';

describe('백업 첨부 형식 (보안 2-9)', () => {
  it('그림 · PDF · 소리 · 영상 · 글만 그대로, HTML · SVG · 이상한 값은 내려받기 형식으로', () => {
    for (const ok of ['image/png', 'image/jpeg', 'application/pdf', 'audio/mpeg', 'video/mp4', 'text/plain']) expect(safeMime(ok)).toBe(ok);
    for (const bad of ['text/html', 'image/svg+xml', 'application/javascript', 'text/html; charset=utf-8', '', undefined, 42]) expect(safeMime(bad)).toBe('application/octet-stream');
  });
});

describe('화면 문구 (법률 B2)', () => {
  it('의미 메뉴 툴팁이 이용자 자료를 AI 학습에 쓴다고 말하지 않는다 — 처리방침 · AI 안내와 같게', () => {
    const src = readFileSync(new URL('../src/MeaningMenu.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/학습 라벨|학습에 쓰여/);
  });
});
