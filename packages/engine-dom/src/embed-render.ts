// 블록 임베드 그리기 (FR-082): 머리(↗ 원본 노트 이름 — 누르면 원본 블록으로) + 원본 블록 내용(읽기 전용, 글 · 표 · 그래프 · 이미지 · 파일).
// 원본은 앱이 읽어 준다(EmbedHost.resolve) — 그릴 때마다 읽으므로 원본을 고치면 다음에 그릴 때 따라 바뀐다. 원본이 없으면 "원본 없음".
// 임베드 안의 임베드는 펼치지 않는다(서로 가리키면 끝없이 돌기 때문) — 이름만.
import { Engine, isChartContent, isDatabaseContent, isFileContent, isImageContent, isTableContent, isTextContent, type Block, type Content, type EmbedContent, type Id } from '@dn/engine-core';
import { renderDatabase } from './db-view';
import { renderStatic } from '@dn/text-pm';
import { renderChart, renderFile, renderImage, renderTable } from './rich-render';

export interface EmbedSource { noteTitle: string; contents: readonly Content[] }
/** 앱이 넘겨 주는 원본 읽기 · 열기. resolve가 null이면 원본 없음(노트 · 블록이 지워짐), 'locked'면 잠긴 노트 */
export interface EmbedHost {
  resolve(noteId: Id, blockId: Id): Promise<EmbedSource | 'locked' | null>;
  open(noteId: Id, blockId: Id): void;
}

export function renderEmbed(c: EmbedContent, el: HTMLElement, host: EmbedHost | undefined, files: ((hash: string) => Promise<string | null>) | undefined): void {
  el.className = 'dn-embed';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'dn-embed-head dn-ui';
  head.textContent = '↗ 원본 불러오는 중…';
  head.addEventListener('click', (e) => { e.stopPropagation(); host?.open(c.srcNote, c.srcBlock); });
  const body = document.createElement('div');
  body.className = 'dn-embed-body';
  el.replaceChildren(head, body);
  const stamp = String(Math.random());
  el.dataset.stamp = stamp;
  void (host?.resolve(c.srcNote, c.srcBlock) ?? Promise.resolve(null)).then((src) => {
    if (el.dataset.stamp !== stamp) return; // 그 사이 다시 그렸다
    if (src === 'locked') { el.classList.add('dn-embed-missing'); head.textContent = '↗ 잠긴 노트'; body.textContent = '잠금을 풀면 보여요.'; return; }
    if (!src) { el.classList.add('dn-embed-missing'); head.textContent = '↗ 원본 없음'; body.textContent = '원본 블록이 지워졌거나 노트가 휴지통에 있어요.'; return; }
    head.textContent = `↗ ${src.noteTitle || '제목 없음'}`;
    head.title = '원본 블록으로 가기';
    const parts: HTMLElement[] = [];
    for (const x of src.contents) {
      const p = document.createElement('div');
      if (isTextContent(x)) { p.className = `dn-text dn-part-${x.role === 'title' ? 'title' : 'body'}`; renderStatic(x.doc, p); }
      else if (isTableContent(x)) renderTable(x, p);
      else if (isChartContent(x)) renderChart(x, p);
      else if (isImageContent(x)) renderImage(x, p, files);
      else if (isFileContent(x)) renderFile(x, p, files);
      // 데이터베이스 (GAP #20 — 노션 '링크된 데이터베이스' 대신): 원본의 지금 보기를 읽기 전용으로 — 그리기용 임시 엔진
      else if (isDatabaseContent(x)) renderDatabase(p, x, { engine: new Engine({ blocks: [{ id: x.blockId, x: 0, y: 0, w: 600, h: 200, z: 'a0', sizing: 'auto', layout: 'flow' } as Block], contents: [x] }), readOnly: true });
      else { p.className = 'dn-embed-other'; p.textContent = x.type === 'embed' ? '(다른 임베드)' : '이 내용은 원본 노트에서 볼 수 있어요.'; }
      parts.push(p);
    }
    body.replaceChildren(...parts);
  });
}
