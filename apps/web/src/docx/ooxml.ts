// docx의 고정 부분 (Office Open XML): 스타일 · 번호 매기기 · 설정 · 내용 형식 · 관계 · 문서 정보 · 각주 틀.
// 단위: 글자 크기 w:sz = 반 포인트, 길이 = twip(1/1440인치, 화면 1px = 15twip), 그림 = EMU(1px = 9525).

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"`;
export const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** XML 글자 · 속성 값 — 제어 문자(XML 1.0에 못 쓰는 것)는 뺀다 */
export function esc(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export const px2tw = (px: number) => Math.round(px * 15);
export const px2emu = (px: number) => Math.round(px * 9525);

/** 기본 글꼴 — 한글은 맑은 고딕, 명조는 바탕, 고정폭은 Consolas (이름은 워드가 아는 것) */
const FONTS = {
  sans: { ascii: 'Malgun Gothic', ea: '맑은 고딕' },
  serif: { ascii: 'Batang', ea: '바탕' },
  mono: { ascii: 'Consolas', ea: 'D2Coding' },
} as const;
export const rFonts = (f: keyof typeof FONTS) => `<w:rFonts w:ascii="${FONTS[f].ascii}" w:hAnsi="${FONTS[f].ascii}" w:eastAsia="${FONTS[f].ea}" w:cs="${FONTS[f].ascii}"/>`;

/** 본문 11pt · 제목 크기 (반 포인트) */
export const BODY_SZ = 22;
const HEAD_SZ = [0, 36, 30, 26, 23] as const;

/** 제목 번호(노트 설정)를 켜면 제목 1~4 스타일에 번호 매기기를 잇는다 (HEADING_NUM_ID) */
const HEADING_NUM_ID = 99;

export function stylesXml(headingNumbers = false): string {
  const heading = (n: 1 | 2 | 3 | 4) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/>${headingNumbers ? `<w:numPr><w:ilvl w:val="${n - 1}"/><w:numId w:val="${HEADING_NUM_ID}"/></w:numPr>` : ''}<w:spacing w:before="${[0, 360, 280, 240, 200][n]}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${HEAD_SZ[n]}"/><w:szCs w:val="${HEAD_SZ[n]}"/></w:rPr></w:style>`;
  return `${HEAD}<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr>${rFonts('sans')}<w:sz w:val="${BODY_SZ}"/><w:szCs w:val="${BODY_SZ}"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>
${heading(1)}${heading(2)}${heading(3)}${heading(4)}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="D0D0CC"/></w:pBdr><w:ind w:left="240"/></w:pPr><w:rPr><w:color w:val="555550"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F6F5F4"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr>${rFonts('mono')}<w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="SectionHead"><w:name w:val="Section Heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:i/><w:color w:val="6B6B68"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="9B9A97"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2E6BD9"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/></w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
}

/** 번호 매기기: 0 = 글머리 기호, 1 = 숫자(1. a. i. 반복), 2 = 다단계(1. 1.1. 1.1.1.), 3 = 제목 번호(제목 1~4 스타일에 묶임).
 *  번호 목록마다 새 num(처음부터 · 시작 번호) — 다단계 목록 안의 번호 목록은 같은 num을 단계만 내려 쓴다(1.1.이 바깥 번호를 잇게) */
export function numberingXml(ordered: readonly { numId: number; start: number; outline?: boolean }[], headingNumbers = false): string {
  const lvl = (i: number, fmt: string, text: string) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 * (i + 1) + 60}" w:hanging="300"/></w:pPr>${fmt === 'bullet' ? `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>` : ''}</w:lvl>`;
  const bullets = ['●', '○', '■'], fmts = ['decimal', 'lowerLetter', 'lowerRoman'];
  const abs0 = `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => lvl(i, 'bullet', bullets[i % 3]!)).join('')}</w:abstractNum>`;
  const abs1 = `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => lvl(i, fmts[i % 3]!, `%${i + 1}.`)).join('')}</w:abstractNum>`;
  const path = (i: number) => Array.from({ length: i + 1 }, (_, k) => `%${k + 1}`).join('.');
  const abs2 = `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="multilevel"/>${Array.from({ length: 9 }, (_, i) => lvl(i, 'decimal', `${path(i)}.`)).join('')}</w:abstractNum>`;
  const hl = (i: number) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading${i + 1}"/><w:suff w:val="space"/><w:lvlText w:val="${i ? path(i) : '%1.'}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="0" w:firstLine="0"/></w:pPr></w:lvl>`;
  const abs3 = headingNumbers ? `<w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="multilevel"/>${[0, 1, 2, 3].map(hl).join('')}</w:abstractNum>` : '';
  const nums = [`<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`,
    ...ordered.map((o) => `<w:num w:numId="${o.numId}"><w:abstractNumId w:val="${o.outline ? 2 : 1}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${o.start}"/></w:lvlOverride></w:num>`),
    ...(headingNumbers ? [`<w:num w:numId="${HEADING_NUM_ID}"><w:abstractNumId w:val="3"/></w:num>`] : [])];
  return `${HEAD}<w:numbering xmlns:w="${W}">${abs0}${abs1}${abs2}${abs3}${nums.join('')}</w:numbering>`;
}

export function settingsXml(): string {
  return `${HEAD}<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="compressPunctuation"/><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
}

/** 각주 틀 (구분선 두 개 + 각주들) */
export function footnotesXml(notes: readonly string[]): string {
  const sep = (id: number, type: string, el: string) => `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:${el}/></w:r></w:p></w:footnote>`;
  return `${HEAD}<w:footnotes ${NS}>${sep(-1, 'separator', 'separator')}${sep(0, 'continuationSeparator', 'continuationSeparator')}${notes.join('')}</w:footnotes>`;
}

export interface Part { readonly path: string; readonly type?: string; readonly rel?: { readonly id: string; readonly type: string } }

export function contentTypesXml(overrides: readonly { path: string; type: string }[], exts: readonly string[]): string {
  const mime: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif' };
  return `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...new Set(exts)].map((e) => `<Default Extension="${e}" ContentType="${mime[e]}"/>`).join('')}${overrides.map((o) => `<Override PartName="/${o.path}" ContentType="${o.type}"/>`).join('')}</Types>`;
}

export function relsXml(rels: readonly { id: string; type: string; target: string; external?: boolean }[]): string {
  return `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
}

export const REL = {
  doc: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  styles: `${R}/styles`, numbering: `${R}/numbering`, settings: `${R}/settings`, footnotes: `${R}/footnotes`,
  header: `${R}/header`, footer: `${R}/footer`, image: `${R}/image`, link: `${R}/hyperlink`,
};
export const CT = {
  doc: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  styles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  numbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  settings: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  footnotes: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
  header: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  footer: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
};

export function coreXml(title: string, created: Date, modified: Date): string {
  const d = (x: Date) => x.toISOString().replace(/\.\d+Z$/, 'Z');
  return `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>DamianNote</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${d(created)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${d(modified)}</dcterms:modified></cp:coreProperties>`;
}
