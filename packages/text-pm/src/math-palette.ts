// 수식 입력 도우미 (FR-018): LaTeX를 몰라도 눌러서 넣는다 — 틀(분수 · 근호 · 첨자 · 합 · 적분 · 극한 · 행렬 · 경우) · 기호 · 그리스 문자 · 함수 · 자주 쓰는 공식.
// 틀의 빈칸은 {} — 넣으면 첫 빈칸에 커서, Tab · Shift+Tab으로 다음 · 앞 빈칸. 글을 고른 채 누르면 고른 글이 첫 빈칸에 들어간다.
import katex from 'katex';

interface MathSnippet { readonly label: string; readonly tex: string }
interface MathGroup { readonly name: string; readonly items: readonly MathSnippet[] }

const sym = (label: string, tex: string): MathSnippet => ({ label, tex });
export const MATH_GROUPS: readonly MathGroup[] = [
  { name: '틀', items: [
    sym('분수', '\\frac{}{}'), sym('거듭제곱', '{}^{}'), sym('아래 첨자', '{}_{}'), sym('제곱근', '\\sqrt{}'), sym('n제곱근', '\\sqrt[{}]{}'),
    sym('괄호', '\\left( {} \\right)'), sym('대괄호', '\\left[ {} \\right]'), sym('절댓값', '\\left| {} \\right|'), sym('벡터', '\\vec{}'), sym('윗줄', '\\overline{}'),
    sym('모자', '\\hat{}'), sym('점', '\\dot{}'),
  ] },
  { name: '미적분', items: [
    sym('합', '\\sum_{}^{}'), sym('곱', '\\prod_{}^{}'), sym('적분', '\\int_{}^{}'), sym('이중 적분', '\\iint'), sym('선적분', '\\oint'), sym('극한', '\\lim_{{} \\to {}}'),
    sym('미분', '\\frac{d}{dx}'), sym('미분 (분수)', '\\frac{d{}}{d{}}'), sym('편미분', '\\frac{\\partial {}}{\\partial {}}'), sym('나블라', '\\nabla'), sym('무한대', '\\infty'), sym('프라임', "{}'"),
  ] },
  { name: '기호', items: [
    sym('플러스마이너스', '\\pm'), sym('곱하기', '\\times'), sym('나누기', '\\div'), sym('점 곱', '\\cdot'), sym('작거나 같음', '\\le'), sym('크거나 같음', '\\ge'),
    sym('같지 않음', '\\ne'), sym('근사', '\\approx'), sym('합동', '\\equiv'), sym('비례', '\\propto'), sym('오른쪽 화살표', '\\to'), sym('이면', '\\Rightarrow'),
    sym('동치', '\\Leftrightarrow'), sym('원소', '\\in'), sym('원소 아님', '\\notin'), sym('부분집합', '\\subset'), sym('부분집합(같음 포함)', '\\subseteq'), sym('합집합', '\\cup'),
    sym('교집합', '\\cap'), sym('공집합', '\\emptyset'), sym('모든', '\\forall'), sym('존재', '\\exists'), sym('각', '\\angle'), sym('도', '^\\circ'),
    sym('그러므로', '\\therefore'), sym('왜냐하면', '\\because'), sym('줄임표', '\\cdots'), sym('수직', '\\perp'), sym('평행', '\\parallel'), sym('삼각형', '\\triangle'),
  ] },
  { name: '그리스', items: [
    ['알파', 'alpha'], ['베타', 'beta'], ['감마', 'gamma'], ['델타', 'delta'], ['엡실론', 'epsilon'], ['세타', 'theta'], ['람다', 'lambda'], ['뮤', 'mu'],
    ['파이', 'pi'], ['로', 'rho'], ['시그마', 'sigma'], ['타우', 'tau'], ['파이(φ)', 'phi'], ['오메가', 'omega'], ['대문자 감마', 'Gamma'], ['대문자 델타', 'Delta'],
    ['대문자 세타', 'Theta'], ['대문자 람다', 'Lambda'], ['대문자 시그마', 'Sigma'], ['대문자 파이', 'Phi'], ['대문자 오메가', 'Omega'],
  ].map(([l, t]) => sym(l!, `\\${t}`)) },
  { name: '함수', items: [
    sym('사인', '\\sin'), sym('코사인', '\\cos'), sym('탄젠트', '\\tan'), sym('로그', '\\log'), sym('밑이 있는 로그', '\\log_{}'), sym('자연로그', '\\ln'),
    sym('지수', 'e^{}'), sym('최댓값', '\\max'), sym('최솟값', '\\min'), sym('조합', '\\binom{}{}'), sym('팩토리얼', '{}!'), sym('글자', '\\text{}'),
  ] },
  { name: '행렬', items: [
    sym('2×2 행렬', '\\begin{pmatrix} {} & {} \\\\ {} & {} \\end{pmatrix}'),
    sym('3×3 행렬', '\\begin{pmatrix} {} & {} & {} \\\\ {} & {} & {} \\\\ {} & {} & {} \\end{pmatrix}'),
    sym('행렬식', '\\begin{vmatrix} {} & {} \\\\ {} & {} \\end{vmatrix}'),
    sym('열벡터', '\\begin{pmatrix} {} \\\\ {} \\end{pmatrix}'),
    sym('경우 나누기', 'f(x) = \\begin{cases} {} & {} \\\\ {} & {} \\end{cases}'),
    sym('연립방정식', '\\begin{cases} {} \\\\ {} \\end{cases}'),
  ] },
  { name: '공식', items: [
    sym('근의 공식', 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'), sym('피타고라스', 'a^2 + b^2 = c^2'), sym('이차방정식', 'ax^2 + bx + c = 0'),
    sym('평균', '\\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_i'), sym('분산', '\\sigma^2 = \\frac{1}{n} \\sum_{i=1}^{n} (x_i - \\bar{x})^2'),
    sym('등차수열의 합', 'S_n = \\frac{n(a_1 + a_n)}{2}'), sym('등비수열의 합', 'S_n = \\frac{a(1 - r^n)}{1 - r}'), sym('미분의 정의', "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}"),
    sym('원의 넓이', 'S = \\pi r^2'), sym('오일러 공식', 'e^{i\\pi} + 1 = 0'), sym('삼각함수', '\\sin^2\\theta + \\cos^2\\theta = 1'), sym('질량-에너지', 'E = mc^2'),
  ] },
];

/** 버튼에 그릴 모양: 빈칸을 □로 */
const shown = (tex: string) => tex.replace(/\{\}/g, '{\\square}');

/** 틀 넣기: 고른 글은 첫 빈칸에, 커서는 (다음) 빈칸 — 없으면 끝 */
function insertSnippet(ta: HTMLTextAreaElement, tex: string): void {
  const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
  let text = tex;
  const first = text.indexOf('{}');
  const wrapped = !!sel && first >= 0;
  if (wrapped) text = `${text.slice(0, first + 1)}${sel}${text.slice(first + 1)}`;
  // \alpha 처럼 명령만이면 뒤에 오는 글자와 붙지 않게 한 칸
  if (/\\[a-zA-Z]+$/.test(text)) text += ' ';
  ta.setRangeText(text, s, e, 'end');
  const ph = text.indexOf('{}', wrapped ? first + sel.length + 2 : 0);
  if (ph >= 0) ta.setSelectionRange(s + ph + 1, s + ph + 1);
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}

/** Tab · Shift+Tab: 다음 · 앞 빈칸 {} 안으로. 없으면 (앞으로는) 끝으로 */
export function jumpPlaceholder(ta: HTMLTextAreaElement, dir: 1 | -1): void {
  const v = ta.value, at = ta.selectionEnd;
  const i = dir > 0 ? v.indexOf('{}', at) : v.lastIndexOf('{}', Math.max(0, ta.selectionStart - 2));
  const p = i >= 0 ? i + 1 : dir > 0 ? v.length : 0;
  ta.setSelectionRange(p, p);
}

/** 문법 오류 (없으면 null) — 빨간 글씨로 그려지는 것과 따로, 무엇이 틀렸는지 알려 준다 */
export function texError(tex: string, display: boolean): string | null {
  if (!tex.trim()) return null;
  try { katex.renderToString(tex, { throwOnError: true, displayMode: display, strict: 'ignore' }); return null; }
  catch (e) { return (e instanceof Error ? e.message : String(e)).replace(/^KaTeX parse error:\s*/, ''); }
}

let lastGroup = 0;

/** 도우미 판: 묶음 탭 + 버튼(수식 모양) — 누르면 입력 칸에 넣는다 (입력 칸 초점은 그대로) */
export function mathPalette(ta: HTMLTextAreaElement): HTMLElement {
  const box = document.createElement('div');
  box.className = 'dn-math-pal';
  const tabs = document.createElement('div');
  tabs.className = 'dn-math-tabs';
  tabs.setAttribute('role', 'tablist');
  const grid = document.createElement('div');
  grid.className = 'dn-math-grid';
  grid.setAttribute('role', 'toolbar');
  const show = (gi: number) => {
    lastGroup = gi;
    for (const [i, t] of [...tabs.children].entries()) { t.classList.toggle('on', i === gi); t.setAttribute('aria-selected', String(i === gi)); }
    grid.replaceChildren();
    const g = MATH_GROUPS[gi]!;
    grid.setAttribute('aria-label', `${g.name} 넣기`);
    grid.classList.toggle('wide', g.name === '공식' || g.name === '행렬');
    for (const it of g.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dn-math-key';
      b.title = `${it.label} — ${it.tex}`;
      b.setAttribute('aria-label', it.label);
      try { katex.render(shown(it.tex), b, { throwOnError: false, displayMode: false, strict: 'ignore' }); } catch { b.textContent = it.label; }
      b.addEventListener('click', () => insertSnippet(ta, it.tex));
      grid.append(b);
    }
  };
  MATH_GROUPS.forEach((g, i) => {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'dn-math-tab';
    t.textContent = g.name;
    t.setAttribute('role', 'tab');
    t.addEventListener('click', () => show(i));
    tabs.append(t);
  });
  box.append(tabs, grid);
  show(lastGroup);
  return box;
}
