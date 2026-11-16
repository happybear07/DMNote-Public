// 코드 구문 강조 (FR-026): 가벼운 토크나이저 — 주석 · 문자열 · 숫자 · 키워드 · 리터럴 · 함수 이름 · 태그 · 속성 · 키.
// 언어별 규칙은 표 하나로. 정확한 파서가 아니라 읽기 쉽게 색을 입히는 정도 — 모르는 언어는 강조 없이 그대로.
type TokenClass = 'kw' | 'lit' | 'str' | 'num' | 'com' | 'fn' | 'tag' | 'attr' | 'key' | 'type';
interface CodeToken { readonly from: number; readonly to: number; readonly cls: TokenClass }

interface Lang {
  readonly name: string;
  readonly line?: readonly string[];
  readonly block?: readonly (readonly [string, string])[];
  readonly quotes?: string;
  readonly multi?: string; // 여러 줄 문자열 따옴표 (백틱 · 삼중 따옴표)
  readonly kw?: string;
  readonly lit?: string;
  readonly types?: string;
  readonly ci?: boolean; // 키워드 대소문자 무시 (SQL)
  readonly markup?: boolean;
  readonly css?: boolean;
  readonly keys?: boolean; // JSON · YAML 키
}

const C_LIKE = 'if else for while do switch case default break continue return goto';
const LANGS: Record<string, Lang> = {
  javascript: { name: 'JavaScript', line: ['//'], block: [['/*', '*/']], quotes: `"'`, multi: '`', kw: `${C_LIKE} var let const function class extends new delete typeof instanceof in of try catch finally throw async await yield import export from as this super static get set void with debugger`, lit: 'true false null undefined NaN Infinity' },
  typescript: { name: 'TypeScript', line: ['//'], block: [['/*', '*/']], quotes: `"'`, multi: '`', kw: `${C_LIKE} var let const function class extends implements interface type enum namespace declare new delete typeof keyof instanceof in of try catch finally throw async await yield import export from as this super static readonly public private protected abstract override satisfies is get set void`, lit: 'true false null undefined NaN Infinity', types: 'string number boolean any unknown never object bigint symbol' },
  python: { name: 'Python', line: ['#'], quotes: `"'`, multi: '"""', kw: 'if elif else for while break continue return def class lambda pass import from as with try except finally raise yield global nonlocal assert del in is not and or async await match case', lit: 'True False None self' },
  java: { name: 'Java', line: ['//'], block: [['/*', '*/']], quotes: `"'`, kw: `${C_LIKE} class interface enum extends implements new this super static final public private protected abstract synchronized volatile transient native throws throw try catch finally import package instanceof var record`, lit: 'true false null', types: 'int long short byte char float double boolean void String' },
  kotlin: { name: 'Kotlin', line: ['//'], block: [['/*', '*/']], quotes: `"'`, multi: '"""', kw: `${C_LIKE} when fun val var class object interface data sealed enum open override private public internal protected companion import package is as in out try catch finally throw this super suspend`, lit: 'true false null', types: 'Int Long Double Float Boolean String Unit Any' },
  c: { name: 'C / C++', line: ['//'], block: [['/*', '*/']], quotes: `"'`, kw: `${C_LIKE} struct union enum typedef sizeof static extern const volatile inline register class public private protected virtual template typename namespace using new delete this operator friend try catch throw constexpr auto nullptr #include #define #ifdef #ifndef #endif #pragma`, lit: 'true false NULL', types: 'int long short char float double void unsigned signed bool size_t' },
  csharp: { name: 'C#', line: ['//'], block: [['/*', '*/']], quotes: `"'`, kw: `${C_LIKE} class struct interface enum namespace using new this base static readonly public private protected internal abstract virtual override sealed async await var foreach in is as try catch finally throw get set`, lit: 'true false null', types: 'int long double float bool string object void decimal' },
  go: { name: 'Go', line: ['//'], block: [['/*', '*/']], quotes: `"'`, multi: '`', kw: `${C_LIKE} func package import var const type struct interface map chan go defer select range fallthrough`, lit: 'true false nil iota', types: 'int int64 float64 string bool byte rune error' },
  rust: { name: 'Rust', line: ['//'], block: [['/*', '*/']], quotes: `"`, kw: `${C_LIKE} fn let mut const static struct enum trait impl for in loop match use mod pub crate self Self super where as ref move async await dyn unsafe type`, lit: 'true false None Some Ok Err', types: 'i32 i64 u8 u32 u64 usize f32 f64 bool char str String Vec Option Result' },
  swift: { name: 'Swift', line: ['//'], block: [['/*', '*/']], quotes: `"`, multi: '"""', kw: `${C_LIKE} func let var class struct enum protocol extension import guard in where return self Self init deinit throws throw try catch defer async await public private internal static override`, lit: 'true false nil', types: 'Int Double String Bool Array Dictionary' },
  sql: { name: 'SQL', line: ['--'], block: [['/*', '*/']], quotes: `'"`, ci: true, kw: 'select from where and or not insert into values update set delete create table drop alter add index view join left right inner outer full on group by order having limit offset as distinct union all case when then else end primary key foreign references default is in like between exists with returning', lit: 'null true false', types: 'int integer varchar text date timestamp boolean real numeric' },
  bash: { name: 'Shell', line: ['#'], quotes: `"'`, kw: 'if then else elif fi for while until do done case esac function in return export local echo cd exit set unset source sudo', lit: 'true false' },
  json: { name: 'JSON', quotes: '"', lit: 'true false null', keys: true },
  yaml: { name: 'YAML', line: ['#'], quotes: `"'`, lit: 'true false null yes no', keys: true },
  css: { name: 'CSS', block: [['/*', '*/']], quotes: `"'`, css: true },
  mermaid: { name: 'Mermaid', line: ['%%'], quotes: '"', kw: 'graph flowchart subgraph end direction classDef class style linkStyle click TD TB BT LR RL' },
  html: { name: 'HTML / XML', block: [['<!--', '-->']], quotes: `"'`, markup: true },
};
const ALIAS: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', kt: 'kotlin',
  cpp: 'c', 'c++': 'c', h: 'c', hpp: 'c', cs: 'csharp', 'c#': 'csharp', golang: 'go', rs: 'rust', sh: 'bash', shell: 'bash', zsh: 'bash',
  console: 'bash', yml: 'yaml', scss: 'css', less: 'css', xml: 'html', svg: 'html', htm: 'html', postgres: 'sql', mysql: 'sql', sqlite: 'sql', mmd: 'mermaid',
};

/** 고를 수 있는 언어 (빈 값 = 일반 텍스트) */
export const CODE_LANGUAGES: readonly { id: string; name: string }[] = [{ id: '', name: '일반 텍스트' }, ...Object.entries(LANGS).map(([id, l]) => ({ id, name: l.name }))];

/** 펜스 · class 이름(js, language-ts …) → 아는 언어 id, 모르면 '' */
export function normalizeLanguage(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim().toLowerCase().replace(/^language-/, '');
  return LANGS[s] ? s : ALIAS[s] ?? '';
}

export function languageName(id: string): string { return LANGS[id]?.name ?? ''; }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
const cache = new Map<string, { re: RegExp; kw: Set<string>; lit: Set<string>; types: Set<string> }>();

function compile(id: string, l: Lang) {
  const hit = cache.get(id);
  if (hit) return hit;
  const com = [...(l.block ?? []).map(([a, b]) => `${esc(a)}[\\s\\S]*?(?:${esc(b)}|$)`), ...(l.line ?? []).map((p) => `${esc(p)}[^\\n]*`)];
  const str: string[] = [];
  if (l.multi) str.push(`${esc(l.multi)}[\\s\\S]*?(?:${esc(l.multi)}|$)`);
  // 마크업은 속성 값(= 뒤)만 문자열 — 본문의 따옴표(Don't)는 그대로
  for (const q of l.quotes ?? '') str.push(`${l.markup ? '(?<==\\s*)' : ''}${esc(q)}(?:\\\\.|(?!${esc(q)})[^\\\\\\n])*${esc(q)}?`);
  const parts: string[] = [];
  if (com.length) parts.push(`(?<com>${com.join('|')})`);
  if (l.markup) parts.push('(?<tag></?[A-Za-z][\\w:.-]*|/?>)', '(?<attr>[A-Za-z_:][\\w:.-]*(?=\\s*=))');
  if (str.length) parts.push(`(?<str>${str.join('|')})`);
  if (l.css) parts.push('(?<kw>@[\\w-]+)', '(?<attr>[\\w-]+(?=\\s*:[^;{}\\n]{0,300}[;}\\n]))', '(?<num>#[\\da-fA-F]{3,8}\\b|(?<![\\w-])-?\\d*\\.?\\d+(?:%|[a-z]+)?\\b)');
  else if (!l.markup) parts.push('(?<num>\\b(?:0[xX][\\da-fA-F_]+|0[bB][01_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)[a-zA-Z]*\\b)');
  if (!l.markup && !l.css) parts.push(`(?<id>#?[A-Za-z_$][\\w$]*)`);
  const words = (s?: string) => new Set((s ?? '').split(/\s+/).filter(Boolean).map((w) => (l.ci ? w.toLowerCase() : w)));
  const out = { re: new RegExp(parts.join('|'), 'g'), kw: words(l.kw), lit: words(l.lit), types: words(l.types) };
  cache.set(id, out);
  return out;
}

/** 코드 글 → 색 입힐 구간 (겹치지 않고 앞에서부터) */
export function tokenizeCode(code: string, language: string): CodeToken[] {
  const id = normalizeLanguage(language);
  const l = LANGS[id];
  if (!l || !code) return [];
  const { re, kw, lit, types } = compile(id, l);
  const out: CodeToken[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m[0] === '') { re.lastIndex++; continue; }
    const g = m.groups ?? {};
    const from = m.index, to = from + m[0].length;
    let cls: TokenClass | null = null;
    if (g.com) cls = 'com';
    else if (g.str) cls = l.keys && /^\s*:/.test(code.slice(to, to + 40)) ? 'key' : 'str';
    else if (g.tag) cls = 'tag';
    else if (g.attr) cls = 'attr';
    else if (g.num) cls = 'num';
    else if (g.kw) cls = 'kw';
    else if (g.id) {
      const w = l.ci ? g.id.toLowerCase() : g.id;
      if (kw.has(w)) cls = 'kw';
      else if (lit.has(w)) cls = 'lit';
      else if (types.has(w)) cls = 'type';
      else if (l.keys && /^\s*:/.test(code.slice(to, to + 40)) && /^\s*(- )?$/.test(code.slice(code.lastIndexOf('\n', from - 1) + 1, from))) cls = 'key';
      else if (/^\s*\(/.test(code.slice(to, to + 40))) cls = 'fn';
    }
    if (cls) out.push({ from, to, cls });
  }
  return out;
}

/** 정적 렌더: <code> 안 글자를 토큰 span으로 (편집 중이 아닐 때) */
export function highlightElement(code: HTMLElement, language: string): void {
  const text = code.textContent ?? '';
  const toks = tokenizeCode(text, language);
  if (!toks.length) return;
  const frag = document.createDocumentFragment();
  let at = 0;
  for (const t of toks) {
    if (t.from > at) frag.append(text.slice(at, t.from));
    const s = document.createElement('span');
    s.className = `dn-tok-${t.cls}`;
    s.textContent = text.slice(t.from, t.to);
    frag.append(s);
    at = t.to;
  }
  if (at < text.length) frag.append(text.slice(at));
  code.replaceChildren(frag);
}
