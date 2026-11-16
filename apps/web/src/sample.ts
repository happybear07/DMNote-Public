// 첫 실행용 예시 노트 (Figma 앱 화면 02 · 메인 캔버스와 같은 내용) · 성능 확인용 합성 노트.
import { bodyDoc, Engine, keyBetween, mergeTitleBody, newId, titleDoc, type Tx } from '@dn/engine-core';

/** 내용 상자 (스키마 v3): 첫 줄 제목3 + 본문 */
function contentBox(tx: Tx, blockId: string, title: string, body: string): void {
  tx.createContent({ blockId, type: 'text', role: 'body', doc: mergeTitleBody(titleDoc(title), bodyDoc(body)) });
}

/** 빈 캔버스 [샘플로 체험하기]용 — Claude에게 받은 답변을 붙여넣었다고 치는 글 (FR-148) */
export const SAMPLE_PASTE = `## 커피 추출 방식 비교

에스프레소는 9기압으로 25~30초 동안 추출해 진하고 크레마가 생긴다. 드립은 중력으로 3~4분 추출해 깔끔하고 향이 살아 있다.
콜드브루는 찬물에 12~24시간 우려 산미가 적고 부드럽다.

- 카페인(한 잔 기준): 에스프레소 63mg, 드립 95mg, 콜드브루 150mg
- 추천: 아침엔 드립 → 오후엔 콜드브루 → 디저트엔 에스프레소`;

export function buildSampleNote(): Engine {
  const e = new Engine({ note: { id: newId(), title: 'Claude API 구조 정리', createdAt: Date.now(), updatedAt: Date.now() } });
  e.transact((tx) => {
    // 제목 상자 — 캔버스 구역 이름
    const t = tx.createBlock({ x: 120, y: 24, w: 320, h: 48 });
    tx.createContent({ blockId: t, type: 'text', role: 'title', doc: titleDoc('AI 구조화 흐름') });
    const mk = (x: number, y: number, w: number, title: string, body: string) => {
      const id = tx.createBlock({ x, y, w, h: 84 });
      contentBox(tx, id, title, body);
      return id;
    };
    const a = mk(120, 90, 300, '구조 분석 파이프라인', '붙여넣은 텍스트를 관계 · 수치 · 비교로 나눠 처리한다.');
    const b = mk(120, 280, 260, '프롬프트 구성', '구조 유형별 지시문 템플릿 결합');
    const c = mk(500, 280, 260, '응답 스키마 검증', 'JSON 스키마 불일치 시 1회 교정 재요청');
    const d = mk(500, 470, 260, '캔버스 반영', '블록 · 화살표 · 그래프 생성');
    tx.createArrow({ from: { blockId: a, side: 'auto' }, to: { blockId: b, side: 'auto' }, label: '1단계' });
    tx.createArrow({ from: { blockId: b, side: 'right' }, to: { blockId: c, side: 'left' }, label: '검증' });
    tx.createArrow({ from: { blockId: c, side: 'bottom' }, to: { blockId: d, side: 'top' } });
  }, { origin: 'load', undoable: false });
  return e;
}

/** `?synth=N` — 블록 N개 격자 + 이웃 화살표 (FR-008 벤치 시나리오 확인용). */
export function buildSynthNote(n: number): Engine {
  const e = new Engine({ note: { id: newId(), title: `합성 노트 · 블록 ${n.toLocaleString()}개`, createdAt: Date.now(), updatedAt: Date.now() } });
  const cols = Math.ceil(Math.sqrt(n));
  e.transact((tx) => {
    let z: string | null = null;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      z = keyBetween(z, null);
      const x = (i % cols) * 320, y = Math.floor(i / cols) * 160;
      const id = tx.createBlock({ x, y, w: 260, h: 84, z });
      contentBox(tx, id, `블록 ${i + 1}`, `행 ${Math.floor(i / cols) + 1} · 열 ${(i % cols) + 1}`);
      ids.push(id);
      if (i % cols !== 0 && i % 5 === 0) tx.createArrow({ from: { blockId: ids[i - 1]!, side: 'auto' }, to: { blockId: id, side: 'auto' } });
    }
  }, { origin: 'load', undoable: false });
  return e;
}
