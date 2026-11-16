// 가져오기 Markdown 변환 보강 (FR-124 · FR-127): 일반 Markdown 변환(text-pm markdownToDoc)이 다루지 않는 것들을 앞뒤로 처리한다.
// - 표(| a | b |) → 표 블록(v4)으로 떼어 낸다
// - 노션 콜아웃 <aside>…</aside> → 콜아웃, 토글 <details><summary>…</summary>…</details> → 토글
//   (변환 전에 표시 글자를 단 인용으로 바꿔 두고, 변환 뒤 그 인용을 해당 노드로 바꾼다)
import { Engine, makeTable, type TableData, type TextDoc, type TextNode, type DatabaseData } from '@dn/engine-core';
import { markdownToDoc } from '@dn/text-pm/headless';

const CALLOUT_MARK = '⁣C⁣';
const TOGGLE_MARK = '⁣T⁣';

export interface MdParts {
  doc: TextDoc;
  tables: TableData[];
  /** 옮기지 못하고 글자로 남긴 것들 (보고용) */
  leftovers: string[];
}

const quote = (mark: string, text: string) => text.trim().split('\n').map((l, i) => `> ${i ? '' : mark}${l}`).join('\n');
const stripTags = (s: string) => s.replace(/<\/?(?:p|span|strong|em|br\s*\/?)[^>]*>/gi, '').trim();

/** Markdown → 문서 + 따로 떼어 낸 표 */
export function convertMarkdown(md: string): MdParts {
  const leftovers: string[] = [];
  let body = md;
  // 콜아웃 · 토글 (노션 내보내기 HTML)
  body = body.replace(/<aside>\s*([\s\S]*?)\s*<\/aside>/gi, (_m, inner: string) => `\n${quote(CALLOUT_MARK, stripTags(inner))}\n`);
  body = body.replace(/<details>\s*<summary>([\s\S]*?)<\/summary>\s*([\s\S]*?)<\/details>/gi,
    (_m, s: string, inner: string) => `\n${quote(TOGGLE_MARK, `${stripTags(s)}\n${stripTags(inner)}`)}\n`);
  // 표: 머리 줄 + 구분 줄 + 이어지는 | 줄
  const tables: TableData[] = [];
  const lines = body.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]!, sep = lines[i + 1] ?? '';
    if (/^\s*\|.*\|\s*$/.test(head) && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(sep)) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
      const columns = cells(head);
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j]!); j++) rows.push(cells(lines[j]!));
      tables.push(makeTable(columns.map((c, k) => c || `열 ${k + 1}`), rows));
      i = j - 1;
      continue;
    }
    out.push(head);
  }
  if (/<(?!\/?(?:aside|details|summary|br)\b)[a-z][\w-]*[^>]*>/i.test(body.replace(/```[\s\S]*?```/g, ''))) leftovers.push('HTML 조각 (글자로 남김)');
  const doc = markdownToDoc(out.join('\n').trim() || ' ');
  return { doc: { ...doc, content: doc.content.map(upgradeQuote) }, tables, leftovers };
}

/** 표시 글자로 시작하는 인용 → 콜아웃 · 토글 */
function upgradeQuote(n: TextNode): TextNode {
  if (n.type !== 'blockquote' || !n.content?.length) return n;
  const first = n.content[0]!;
  const lead = first.content?.[0];
  const text = typeof lead?.text === 'string' ? lead.text : '';
  const mark = text.startsWith(CALLOUT_MARK) ? 'c' : text.startsWith(TOGGLE_MARK) ? 't' : null;
  if (!mark) return n;
  const cut = text.slice(CALLOUT_MARK.length);
  const firstFixed: TextNode = { ...first, content: [...(cut ? [{ ...lead!, text: cut }] : []), ...first.content!.slice(1)] };
  let rest: TextNode[] = [firstFixed, ...n.content.slice(1)];
  if (mark === 't') {
    // 토글: 첫 문단 = 제목 줄 (요약과 본문이 한 문단에 줄바꿈으로 붙어 오면 나눈다)
    const kids = firstFixed.content ?? [];
    const br = kids.findIndex((k) => k.type === 'hard_break');
    if (br >= 0) rest = [{ type: 'paragraph', content: kids.slice(0, br) }, { type: 'paragraph', content: kids.slice(br + 1) }, ...rest.slice(1)];
    return { type: 'toggle', attrs: { open: false }, content: rest.map(dropEmptyContent) };
  }
  // 콜아웃: 맨 앞 이모지는 아이콘 대신 버린다 (아이콘은 선 아이콘만 쓴다)
  const p0 = rest[0]!;
  const t0 = p0.content?.[0];
  if (t0?.text) rest[0] = { ...p0, content: [{ ...t0, text: t0.text.replace(/^\p{Extended_Pictographic}️?\s*/u, '') }, ...p0.content!.slice(1)] };
  return { type: 'callout', attrs: { icon: 'bulb', color: 'yellow' }, content: rest.map(dropEmptyContent) };
}
const dropEmptyContent = (n: TextNode): TextNode => (n.content && !n.content.length ? { type: n.type, ...(n.attrs ? { attrs: n.attrs } : {}) } : n);

export interface PageParts {
  id: string;
  title: string;
  created: number;
  updated: number;
  doc: TextDoc;
  tables: readonly TableData[];
  /** 이미지 블록 (이미 저장한 첨부) */
  images: readonly { hash: string; w: number; h: number; alt: string }[];
  /** 데이터베이스 블록 (콘텐츠 데이터 그대로 — id가 있으면 그 id로) */
  databases: readonly (DatabaseData & { id?: string })[];
}

/** 가져온 페이지 → 노트 엔진: 글 상자 하나(왼쪽) + 표 · 데이터베이스 · 이미지(오른쪽 열, 위에서부터).
 *  글이 비었고 다른 것이 있으면(CSV 하나 · 노션의 품는 페이지 없는 데이터베이스) 빈 글 상자 없이 왼쪽부터 */
export function buildPage(p: PageParts): Engine {
  const e = new Engine({ note: { id: p.id, title: p.title, createdAt: p.created, updatedAt: p.updated } });
  const blank = (p.doc.content ?? []).every((n) => n.type === 'paragraph' && !n.content?.length);
  const solo = blank && p.databases.length + p.tables.length + p.images.length > 0;
  e.transact((tx) => {
    if (!solo) {
      const b = tx.createBlock({ x: 0, y: 0, w: 560, h: 200 });
      tx.createContent({ blockId: b, type: 'text', role: 'body', doc: p.doc });
    }
    let y = 0;
    const X = solo ? 0 : 600;
    for (const d of p.databases) {
      const props = d.properties;
      const w = Math.max(480, 82 + props.filter((x) => !x.hidden).reduce((s, x) => s + (x.width ?? 140), 0));
      const rows = d.rows.length;
      const h = 110 + rows * 31;
      const db = tx.createBlock({ x: X, y, w, h });
      tx.createContent({ blockId: db, type: 'database', ...d } as never);
      y += h + 40;
    }
    for (const t of p.tables) {
      const h = 50 + t.rows.length * 30;
      const tb = tx.createBlock({ x: X, y, w: Math.max(360, Math.min(720, t.columns.length * 140)), h });
      tx.createContent({ blockId: tb, type: 'table', ...t } as never);
      y += h + 40;
    }
    for (const img of p.images) {
      const w = Math.min(420, Math.max(80, img.w)), h = Math.round((w * img.h) / Math.max(1, img.w));
      const ib = tx.createBlock({ x: X, y, w, h });
      tx.createContent({ blockId: ib, type: 'image', attachment: img.hash, alt: img.alt, natural: { w: img.w, h: img.h } } as never);
      y += h + 40;
    }
  }, { origin: 'load', undoable: false });
  return e;
}
