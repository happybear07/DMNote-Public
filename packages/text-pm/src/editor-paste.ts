// 편집기 붙여넣기 해석 (FR-031): HTML은 위험한 것만 걷어 내고 스키마 규칙으로, 텍스트는 마크다운이면 변환, 제목 상자는 한 줄로.
// Ctrl+Shift+V면 ProseMirror가 plain=true로 부르고 HTML은 무시한다. (URL · 이미지 · 표 붙여넣기는 editor.ts handlePaste)
import { Fragment, Slice, type Node as PMNode, type NodeType } from 'prosemirror-model';
import type { EditorProps } from 'prosemirror-view';
import { toNode } from './codec';
import { looksLikeMarkdown, markdownToDoc, plainTextToDoc } from './markdown';
import { scrubHTML } from './paste';
import { schema } from './schema';
import type { EditorMode } from './editor';

const S = schema;
const N = S.nodes as Record<string, NodeType>;

export function pasteParsers(mode: () => EditorMode, onScrubbed?: () => void): Pick<EditorProps, 'transformPastedHTML' | 'transformPasted' | 'clipboardTextParser'> {
  return {
    transformPastedHTML: (html) => {
      const r = scrubHTML(html);
      if (r.report.removedActive) onScrubbed?.();
      return r.html;
    },
    // 제목 상자: 무엇을 붙여넣든 한 줄 글자로 (서식 있는 HTML이면 글자 서식은 남긴다)
    transformPasted: (slice) => (mode() === 'title' && (slice.content.childCount > 1 || !slice.content.firstChild?.isInline)
      ? flattenToLine(slice) : slice),
    clipboardTextParser: (text, $ctx, plain) => {
      if (mode() === 'title') {
        const line = text.replace(/\s*\r?\n\s*/g, ' ');
        return line.trim() ? new Slice(Fragment.from(S.text(line)), 0, 0) : Slice.empty;
      }
      if ($ctx.parent.type.spec.code) return new Slice(Fragment.from(S.text(text)), 0, 0);
      const doc = !plain && looksLikeMarkdown(text) ? markdownToDoc(text) : plainTextToDoc(text, { links: !plain });
      return Slice.maxOpen(toNode(doc).content);
    },
  };
}

/** 여러 블록에 걸친 조각 → 인라인 노드 한 줄 (블록 사이는 공백) */
function flattenToLine(slice: Slice): Slice {
  const inline: PMNode[] = [];
  slice.content.descendants((n) => {
    if (n.isTextblock) { if (inline.length) inline.push(S.text(' ')); return true; }
    if (n.isInline) { if (n.type !== N.hard_break) inline.push(n); return false; }
    return true;
  });
  return inline.length ? new Slice(Fragment.from(inline), 0, 0) : Slice.empty;
}
