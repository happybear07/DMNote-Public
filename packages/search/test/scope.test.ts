// 노트에 묻기 범위 좁히기 (2026-10-26): 글 속 #해시태그 · 자주 나온 낱말 · 소제목 · 역할 추정 · 범위 단계 · 요약 카드 md
import { describe, expect, it } from 'vitest';
import { createTextBlock, Engine } from '@dn/engine-core';
import { BUILTIN_ROLES, extractSearchDoc, guessRole, hashtags, narrowScope, noteDigest, scopeStages, SearchIndex, topKeywords, type NoteRole, type ScopeNote } from '../src';

const sn = (id: string, o: Partial<ScopeNote> = {}): ScopeNote => ({ id, title: o.title ?? id, updatedAt: o.updatedAt ?? 1, tags: o.tags ?? [], headings: o.headings ?? [], keywords: o.keywords ?? [], ...(o.role ? { role: o.role } : {}) });

describe('키워드', () => {
  it('글 속 #해시태그: 한글 · 영문 · 밑줄, 숫자뿐 · 색 코드 · 주소 조각 · 중복은 뺀다', () => {
    expect(hashtags('오늘 #회의 정리 #결제_연동 #결제_연동 #Beta 색은 #3b5bdb, 번호 #12, 주소 a.com/#top, 단락#붙음')).toEqual(['회의', '결제_연동', 'Beta']);
  });

  it('자주 나온 낱말: 제목 3점 · 소제목 2점 · 본문 1점, 조사 떼기 · 서술어 · 흔한 말 · 건너뛸 것 제외', () => {
    const k = topKeywords({ title: '결제 연동 회의', headings: ['일정', '위험 요소'], texts: ['결제 연동은 다음 주까지 끝낸다', '서버 비용이 커질 수 있다', '결제 시험을 했다'] }, 5, ['회의']);
    expect(k[0]).toBe('결제');
    expect(k).toContain('연동');
    expect(k).not.toContain('회의');
    expect(k).not.toContain('했다');
  });
});

describe('역할 추정', () => {
  it('소제목 "안건 · 논의 · 결정 사항"이면 회의록, 제목에 "강의"가 있으면 강의 필기, 걸리는 게 적으면 없음', () => {
    expect(guessRole('', ['안건', '논의', '결정 사항'], BUILTIN_ROLES)).toBe('meeting');
    expect(guessRole('3주차 강의', [], BUILTIN_ROLES)).toBe('lecture');
    expect(guessRole('장보기', ['우유', '계란'], BUILTIN_ROLES)).toBeUndefined();
  });

  it('사용자가 만든 역할도 낱말로 추정한다', () => {
    const roles: NoteRole[] = [...BUILTIN_ROLES, { id: 'client', name: '거래처 미팅', keywords: ['거래처', '견적'] }];
    expect(guessRole('A사 거래처 방문', ['견적'], roles)).toBe('client');
  });
});

describe('범위 단계', () => {
  const notes = [
    sn('m1', { title: '10월 3주 회의', role: 'meeting', tags: ['결제'], updatedAt: 3 }),
    sn('m2', { title: '10월 2주 회의', role: 'meeting', updatedAt: 2 }),
    sn('l1', { title: '경제 강의', role: 'lecture', tags: ['결제'] }),
    sn('x', { title: '여행 계획', headings: ['예산'], keywords: ['항공권', '숙소'] }),
  ];

  it('역할 · 태그가 둘 다 걸리면 둘 다 맞는 노트만, 범위 설명에 역할 · 태그', () => {
    const r = narrowScope('지난 회의에서 결제 연동 일정 어떻게 됐어?', notes, BUILTIN_ROLES);
    expect(r.via).toBe('role-tag');
    expect(r.ids).toEqual(['m1']);
    expect(r.label).toBe('회의록 노트 · #결제 1개');
  });

  it('역할만 걸리면 그 역할 노트 전부(최근 순), #태그를 직접 쓰면 그 태그 노트', () => {
    expect(narrowScope('회의에서 정한 것', notes, BUILTIN_ROLES).ids).toEqual(['m1', 'm2']);
    expect(narrowScope('#결제 관련 내용', notes, BUILTIN_ROLES).ids.sort()).toEqual(['l1', 'm1']);
  });

  it('역할 · 태그가 안 걸리면 요약 카드(제목 · 소제목 · 키워드), 그것도 없으면 범위 없음', () => {
    const r = scopeStages('숙소 예약은?', notes, BUILTIN_ROLES);
    expect(r.map((x) => x.via)).toEqual(['digest']);
    expect(r[0]!.ids).toEqual(['x']);
    expect(narrowScope('전혀 상관없는 우주 이야기', notes, BUILTIN_ROLES).via).toBe('none');
  });

  it('역할 · 태그 노트가 겹치지 않으면 합쳐서, 걸린 태그 수(2점씩) · 역할(3점) · 최근 순으로', () => {
    const ns = [
      sn('c', { role: 'meeting', updatedAt: 9 }),
      sn('b', { tags: ['결제'], updatedAt: 5 }),
      sn('a', { tags: ['결제', '연동'], updatedAt: 1 }),
      sn('z', { tags: ['여행'], updatedAt: 7 }),
    ];
    const r = scopeStages('회의 #결제 연동', ns, BUILTIN_ROLES)[0]!;
    expect(r.ids).toEqual(['a', 'c', 'b']);
    expect(r.tags).toEqual(['결제', '연동']);
    expect(r.label).toBe('회의록 노트 · #결제 · #연동 3개');
  });

  it('역할 단계 뒤에 요약 카드 단계도 함께 돌려준다 (앱이 앞 단계에서 근거가 없으면 넘어간다)', () => {
    const r = scopeStages('회의 숙소', notes, BUILTIN_ROLES);
    expect(r.map((x) => x.via)).toEqual(['role-tag', 'digest']);
  });
});

describe('검색 문서 v4 · 요약 카드', () => {
  it('제목 상자 · 이름 붙인 묶음이 소제목, 글 속 #태그 · 자주 나온 낱말이 문서에, 색인이 카드를 돌려준다', () => {
    const e = new Engine({ note: { id: 'n1', title: '출시 회의', createdAt: 0, updatedAt: 0 } });
    createTextBlock(e, { x: 0, y: 0 }, { kind: 'title', title: '결정 사항' });
    createTextBlock(e, { x: 0, y: 200 }, { body: '#결제 연동은 금요일까지. 결제 시험은 베타 전에.' });
    const d = extractSearchDoc(e, 1);
    expect(d.v).toBe(4);
    expect(d.headings).toEqual(['결정 사항']);
    expect(d.hashtags).toEqual(['결제']);
    expect(d.keywords).not.toContain('결제'); // 태그인 낱말은 키워드에서 뺀다
    expect(d.keywords).toContain('연동');
    const ix = new SearchIndex();
    ix.put({ ...d, digest: 'md' });
    expect(ix.card('n1')).toEqual({ headings: ['결정 사항'], keywords: d.keywords, hashtags: ['결제'], digest: 'md' });
    ix.remove('n1');
    expect(ix.card('n1')).toBeUndefined();
  });

  it('요약 카드 md: 제목 · 역할(추정 표시) · 태그 · 소제목 · 키워드만', () => {
    expect(noteDigest({ title: '출시 회의', role: { name: '회의록', guessed: true }, tags: ['결제'], headings: ['결정 사항'], keywords: ['연동', '베타'] }))
      .toBe('# 출시 회의\n- 역할: 회의록 (추정)\n- 태그: #결제\n- 소제목: 결정 사항\n- 키워드: 연동, 베타');
  });
});
