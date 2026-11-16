// 노트 템플릿 (FR-078): 기본 제공 4종(코드로 만든다) + 사용자가 저장한 템플릿(설정 'templates'에 노트 스냅샷).
import { deserialize, Engine, newId, serialize, titleDoc, type NoteSnapshot } from '@dn/engine-core';
import { markdownToDoc } from '@dn/text-pm';

export interface UserTemplate { id: string; name: string; createdAt: number; snapshot: NoteSnapshot }

export interface TemplateEntry {
  id: string;
  name: string;
  hint: string;
  /** 기본 제공이면 true (지울 수 없다) */
  builtin: boolean;
  build(): Engine;
}

type Box = { x: number; y: number; w: number; md: string; title?: boolean };

/** 상자 목록 + 화살표(상자 번호 쌍)로 노트를 만든다 */
function make(boxes: Box[], arrows: [number, number, string?][] = []): Engine {
  const e = new Engine({ note: { id: newId(), title: '', createdAt: Date.now(), updatedAt: Date.now() } });
  e.transact((tx) => {
    const ids = boxes.map((b) => {
      const id = tx.createBlock({ x: b.x, y: b.y, w: b.w, h: b.title ? 48 : 120 });
      tx.createContent({ blockId: id, type: 'text', role: b.title ? 'title' : 'body', doc: b.title ? titleDoc(b.md) : markdownToDoc(b.md) });
      return id;
    });
    for (const [a, b, label] of arrows) tx.createArrow({ from: { blockId: ids[a]!, side: 'auto' }, to: { blockId: ids[b]!, side: 'auto' }, ...(label ? { label } : {}) });
  }, { origin: 'load', undoable: false });
  return e;
}

export const BUILTIN_TEMPLATES: TemplateEntry[] = [
  {
    id: 'meeting', name: '회의록', hint: '안건 → 논의 → 결정 · 할 일', builtin: true,
    build: () => make([
      { x: 0, y: 0, w: 360, md: '회의록', title: true },
      { x: 0, y: 70, w: 300, md: '### 회의 정보\n- 일시: \n- 장소: \n- 참석자: ' },
      { x: 340, y: 70, w: 300, md: '### 안건\n1. \n2. \n3. ' },
      { x: 340, y: 300, w: 300, md: '### 논의 내용\n- ' },
      { x: 680, y: 300, w: 300, md: '### 결정 사항\n- ' },
      { x: 680, y: 70, w: 300, md: '### 할 일\n- [ ] 담당자 · 기한\n- [ ] ' },
    ], [[2, 3], [3, 4, '결정'], [4, 5, '실행']]),
  },
  {
    id: 'lecture', name: '강의 필기', hint: '핵심 개념 · 예시 · 질문 · 요약', builtin: true,
    build: () => make([
      { x: 0, y: 0, w: 360, md: '강의 제목', title: true },
      { x: 0, y: 70, w: 320, md: '### 핵심 개념\n- \n- ' },
      { x: 360, y: 70, w: 320, md: '### 예시\n- ' },
      { x: 0, y: 300, w: 320, md: '### 모르는 것 · 질문\n- [ ] ' },
      { x: 360, y: 300, w: 320, md: '### 한 줄 요약\n' },
    ], [[1, 2, '예'], [1, 3]]),
  },
  {
    id: 'research', name: '리서치', hint: '질문 → 자료 → 비교 → 결론', builtin: true,
    build: () => make([
      { x: 0, y: 0, w: 360, md: '리서치 주제', title: true },
      { x: 0, y: 70, w: 300, md: '### 알고 싶은 것\n' },
      { x: 340, y: 70, w: 300, md: '### 자료 · 출처\n- ' },
      { x: 340, y: 300, w: 300, md: '### 비교\n- A: 장점 · 단점\n- B: 장점 · 단점' },
      { x: 680, y: 300, w: 300, md: '### 결론\n' },
    ], [[1, 2], [2, 3], [3, 4]]),
  },
  {
    id: 'weekly', name: '주간 계획', hint: '목표 · 요일별 할 일 · 회고', builtin: true,
    build: () => make([
      { x: 0, y: 0, w: 360, md: '이번 주 계획', title: true },
      { x: 0, y: 70, w: 300, md: '### 이번 주 목표\n1. \n2. \n3. ' },
      ...['월', '화', '수', '목', '금'].map((d, i): Box => ({ x: 340 + (i % 3) * 230, y: 70 + Math.floor(i / 3) * 200, w: 210, md: `### ${d}\n- [ ] ` })),
      { x: 0, y: 300, w: 300, md: '### 회고\n- 잘한 것: \n- 아쉬운 것: \n- 다음 주에: ' },
    ]),
  },
];

/** 사용자 템플릿 → 갤러리 항목 */
export function userEntry(t: UserTemplate): TemplateEntry {
  return {
    id: t.id, name: t.name, hint: '내가 저장한 템플릿', builtin: false,
    build: () => {
      const r = deserialize(t.snapshot);
      if (!r.ok) throw new Error('템플릿을 읽지 못했어요');
      return new Engine(r.data);
    },
  };
}

/** 노트 → 템플릿 스냅샷 (노트 id · 날짜는 쓸 때 새로 매긴다) */
export function toTemplate(engine: Engine, name: string): UserTemplate {
  return { id: newId(), name, createdAt: Date.now(), snapshot: serialize(engine) };
}

/** 템플릿으로 새 노트 엔진 (새 id · 지금 날짜 · 제목은 비움 — 첫 블록이 자동 제목) */
export function instantiate(entry: TemplateEntry): Engine {
  const src = entry.build();
  const r = deserialize(serialize(src));
  if (!r.ok) throw new Error('템플릿을 읽지 못했어요');
  const now = Date.now();
  return new Engine({ ...r.data, note: { id: newId(), title: '', createdAt: now, updatedAt: now } });
}
