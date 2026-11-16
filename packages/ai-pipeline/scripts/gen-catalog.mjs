// docs/STRUCTURE-GUIDE.md 2.2 표 → prompts/structure.v2.catalog.md (structure.v2 시스템 프롬프트 뒤에 붙는 구조 목록).
// 한 줄 = "S-xx 이름 · 원형 · 신호어". 표가 바뀌면 다시 생성한다 — test/prompts.test.ts가 가이드와 어긋나면 실패시킨다.
// 실행: corepack pnpm -F @dn/ai-pipeline gen:catalog  (그다음 gen:prompts)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 가이드 본문 → 목록 줄들 (테스트도 같은 함수를 쓴다) */
export function catalogLines(guide) {
  const text = guide.replace(/\r\n?/g, '\n');
  const start = text.indexOf('\n### 2.2 ');
  const end = text.indexOf('\n### 2.3 ', start);
  if (start < 0 || end < 0) throw new Error('STRUCTURE-GUIDE 2.2 절을 찾지 못함');
  const lines = [];
  for (const row of text.slice(start, end).split('\n')) {
    const m = /^\|\s*(S-\d{2})[^|]*\|\s*([^|]+?)\s*\|\s*[A-J]\s*\|\s*([^|]+?)\s*\|\s*[^|]*\|\s*([^|]*?)\s*\|$/.exec(row);
    if (!m) continue;
    const [, id, name, archetype, signals] = m;
    const arch = archetype.replace(/`/g, '').replace(/\s*·\s*/g, ' / ');
    lines.push(`${id} ${name} [${arch}]${signals ? `: ${signals}` : ''}`);
  }
  if (lines.length < 70) throw new Error(`2.2 표에서 ${lines.length}줄만 읽음 — 표 모양이 바뀌었는지 확인`);
  return lines;
}

export function catalogFile(guide) {
  return `<!--
id: structure.v2.catalog
revision: 1
role: structure catalog appended to the structure.v2 system prompt ("\\n\\n" + this body). GENERATED from docs/STRUCTURE-GUIDE.md section 2.2 by scripts/gen-catalog.mjs — do not edit by hand.
-->
# Structure catalog

Each line: id, name [layout archetype = the \`pattern\` value]: typical signal words. Use these ids in \`patterns[].id\`.

${catalogLines(guide).join('\n')}
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const guide = readFileSync(join(root, '..', '..', 'docs', 'STRUCTURE-GUIDE.md'), 'utf8');
  writeFileSync(join(root, 'prompts', 'structure.v2.catalog.md'), catalogFile(guide));
  console.log(`structure.v2.catalog.md: ${catalogLines(guide).length}개 구조`);
}
