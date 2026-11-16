// 마크다운 단축 입력 규칙 (FR-028)
import { textblockTypeInputRule, wrappingInputRule, InputRule } from 'prosemirror-inputrules';
import type { MarkType, NodeType } from 'prosemirror-model';
import { schema } from './schema';

const S = schema;
const N = S.nodes as Record<string, NodeType>;
const M = S.marks as Record<string, MarkType>;

// ───────── 마크다운 단축 입력 (FR-028) ─────────
function markRule(re: RegExp, type: MarkType): InputRule {
  return new InputRule(re, (state, match, start, end) => {
    const inner = match[1]!;
    const tr = state.tr.replaceWith(start, end, S.text(inner, [type.create()]));
    return tr.removeStoredMark(type);
  });
}

export function markdownRules(): InputRule[] {
  return [
    textblockTypeInputRule(/^(#{1,4})\s$/, N.heading!, (m) => ({ level: m[1]!.length })),
    wrappingInputRule(/^\s*([-*])\s$/, N.bullet_list!),
    wrappingInputRule(/^(\d+)\.\s$/, N.ordered_list!, (m) => ({ order: Number(m[1]) }), (m, n) => n.childCount + n.attrs.order === Number(m[1])),
    wrappingInputRule(/^\[( |x)?\]\s$/, N.task_list!),
    wrappingInputRule(/^\s*>\s$/, N.blockquote!),
    textblockTypeInputRule(/^```$/, N.code_block!),
    // 화살표 자동 바꾸기 (노션 · 워드 자동 고침) — <=>를 =>보다 먼저
    new InputRule(/<=>$/, '⇔'), new InputRule(/->$/, '→'), new InputRule(/<-$/, '←'), new InputRule(/=>$/, '⇒'),
    new InputRule(/^---$/, (state, _m, start) => {
      const $s = state.doc.resolve(start);
      if ($s.parent.type !== N.paragraph) return null;
      return state.tr.replaceRangeWith($s.before(), $s.after(), N.horizontal_rule!.create()).insert($s.before() + 1, N.paragraph!.create());
    }),
    // 수식 (FR-018): 줄 맨 앞 $$ + 공백 → 블록 수식, $식$ → 인라인 수식 (숫자뿐이면 돈 표기로 보고 넘어간다)
    new InputRule(/^\$\$\s$/, (state, _m, start) => {
      const $s = state.doc.resolve(start);
      if ($s.parent.type !== N.paragraph) return null;
      return state.tr.replaceRangeWith($s.before(), $s.after(), N.math_block!.create({ tex: '' }));
    }),
    new InputRule(/(?<![\w$])\$([^\s$](?:[^$]*[^\s$])?)\$$/, (state, m, start, end) => {
      const tex = m[1]!;
      if (/^\d+([.,]\d+)?$/.test(tex)) return null;
      return state.tr.replaceWith(start + (m[0].length - tex.length - 2), end, N.math_inline!.create({ tex }));
    }),
    markRule(/\*\*([^*]+)\*\*$/, M.strong!),
    markRule(/(?:^|[^*])\*([^*\s][^*]*)\*$/, M.em!),
    markRule(/`([^`]+)`$/, M.code!),
    markRule(/~~([^~]+)~~$/, M.strike!),
    markRule(/==([^=]+)==$/, M.highlight!),
  ];
}
