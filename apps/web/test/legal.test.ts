// 법적 문서 (LEGAL-RISK R1 · R2 · R4 · R5, 10/26): md 해석 · 정적 페이지, 그리고 동의 창 · 처리방침 · AI 안내가 알릴 사항을 빠짐없이 같은 내용으로 적는지
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { legalPage } from '../legal-pages';
import { CONSENT_ITEMS } from '../src/legal/consent';
import { mdHtml, parseMd, plain } from '../src/legal/md';
import { LEGAL_DOCS } from '../src/legal/meta';

const md = (file: string) => readFileSync(new URL(`../src/legal/${file}`, import.meta.url), 'utf8');
const consent = CONSENT_ITEMS.map((x) => `${x.k} ${x.v}`).join('\n');

describe('법적 문서 md', () => {
  it('제목 · 번호 목록 아래 들여 쓴 목록 · 표 · 굵게 · 링크 — 자리표시자는 링크가 아님', () => {
    const b = parseMd('<!-- 숨김 -->\n# 제목\n\n[운영자 이름](이하 "운영자")은 **굵게** [안내](/ai)\n\n1. 하나\n   - 가\n   - 나\n2. 둘\n\n| 가 | 나 |\n|---|---|\n| 1 | [링크](https://a.example/x) |\n');
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'ol', 'table']);
    const p = b[1]!;
    expect(p.t === 'p' && p.text.map((x) => x.t)).toEqual(['text', 'b', 'text', 'a']);
    expect(p.t === 'p' && plain(p.text)).toBe('[운영자 이름](이하 "운영자")은 굵게 안내');
    const ol = b[2]!;
    expect(ol.t === 'ol' && ol.items.map((i) => [plain(i.text), i.sub.map(plain)])).toEqual([['하나', ['가', '나']], ['둘', []]]);
    const t = b[3]!;
    expect(t.t === 'table' && t.rows[0]![1]![0]).toEqual({ t: 'a', v: '링크', href: 'https://a.example/x' });
  });

  it('HTML은 글자로만 — 스크립트가 끼어들 수 없다', () => {
    const html = mdHtml(parseMd('<script>alert(1)</script> **<b>x</b>** [a](https://x.example/"onmouseover=1)'));
    expect(html).not.toMatch(/<script|<b>|"onmouseover/);
    expect(html).toContain('&lt;script&gt;');
  });

  it('문서마다 # 제목 · 시행일 · 정적 페이지', () => {
    for (const d of LEGAL_DOCS) {
      const b = parseMd(md(d.file));
      expect(b[0]?.t === 'h' && b[0].level).toBe(1);
      expect(md(d.file)).toMatch(/시행일: \d{4}년 \d{1,2}월 \d{1,2}일/);
      const html = legalPage(d.id);
      expect(html).toMatch(/^<!doctype html>/);
      expect(html).toContain(`aria-current="page">${d.title}<`);
      expect(html).not.toContain('<!--');
    }
  });
});

describe('AI 전송 고지 (개인정보보호법 제28조의8 제2항)', () => {
  // 알릴 사항: 이전 항목 · 국가 · 시기와 방법 · 받는 자(명칭 · 연락처) · 이용 목적 · 보유 기간 · 거부 방법과 효과
  // 10/29 교차 검토 C1 · C2 · C6: 요약의 표 · 데이터베이스 · 화살표 목록, 묻기의 범위 이름 · 손글씨에서 읽은 글
  const facts = ['Anthropic, PBC', '미국', 'privacy@anthropic.com', 'PNG', '수정일', 'HTTPS', '30일', '최대 2년', '철회', '학습에 쓰지 않', '화살표 목록', '범위의 이름', '손글씨에서 읽은 글'];
  it('동의 창 · 처리방침 · AI 안내 모두 같은 사실을 적는다', () => {
    for (const [name, text] of [['동의 창', consent], ['처리방침', md('privacy.md')], ['AI 안내', md('ai.md')]] as const) {
      for (const f of facts) expect(`${name} · ${f}: ${text.includes(f)}`).toBe(`${name} · ${f}: true`);
    }
  });
  it('동의 창은 알릴 사항 일곱 가지를 여섯 줄에 담는다 (국가는 받는 곳 줄에)', () => {
    expect(CONSENT_ITEMS.map((x) => x.k)).toEqual(['보내는 것', '받는 곳', '언제 · 어떻게', '목적', '보관', '거부하면']);
    expect(consent).toMatch(/실행할 때마다/); // 시기
    expect(consent).toMatch(/나머지는 그대로/); // 거부의 효과
  });
  it('일곱 기능(구조화 · 손글씨 · 고치기 · 초안 · 노트 요약 · 노트 번역 · 묻기)의 전송을 모두 적는다', () => {
    for (const text of [consent, md('privacy.md'), md('ai.md')]) {
      expect(text).toMatch(/구조화/);
      expect(text).toMatch(/손글씨|필기/);
      expect(text).toMatch(/AI로 고칠|AI로 고치기/);
      expect(text).toMatch(/초안을 쓸 주제|AI로 초안 쓰기/);
      expect(text).toMatch(/요약하거나 번역할 노트|AI로 노트 요약/);
      expect(text).toMatch(/번역할 노트|AI로 노트 번역/);
      expect(text).toMatch(/이어 쓰기/);
      expect(text).toMatch(/노트에 묻기/);
    }
  });
});

describe('API 키 · 학습 (R4 · R5)', () => {
  it('약관 · AI 안내에 키 요금 · Anthropic 약관 · 이용 정책 링크', () => {
    for (const f of ['terms.md', 'ai.md']) {
      const t = md(f);
      expect(t).toContain('https://www.anthropic.com/legal/commercial-terms');
      expect(t).toContain('https://www.anthropic.com/legal/aup');
      expect(t).toMatch(/요금을 받거나 대신 내지 않습니다/);
    }
  });
  it('처리방침 · AI 안내 · 약관이 학습에 쓰지 않는다고 적고, 학습하려면 따로 받는 동의(기본 끔)', () => {
    for (const f of ['privacy.md', 'ai.md']) expect(md(f)).toMatch(/AI 전송 동의와 따로 받는 학습 동의\(처음에는 꺼져 있음\)/);
    expect(md('terms.md')).toMatch(/AI 모델 학습에 쓰지 않습니다/);
  });
});
