// prompts/*.md → src/prompts.gen.ts (원문 문자열 그대로).
// Vite `?raw`는 Node 테스트 · Worker에서 못 쓰므로 TS 상수로 굳힌다. test/prompts.test.ts가 .md와 어긋나면 실패시킨다.
// 실행: corepack pnpm -F @dn/ai-pipeline gen:prompts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'prompts');
const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();

let out = '// 생성 파일 — scripts/gen-prompts.mjs가 prompts/*.md에서 만든다. 직접 고치지 말고 .md를 고친 뒤 다시 생성한다.\n';
out += '/* eslint-disable */\n';
out += 'export const RAW_PROMPTS: Readonly<Record<string, string>> = {\n';
for (const f of files) {
  const text = readFileSync(join(dir, f), 'utf8').replace(/\r\n?/g, '\n');
  out += `  ${JSON.stringify(f)}: ${JSON.stringify(text)},\n`;
}
out += '};\n';
writeFileSync(join(root, 'src', 'prompts.gen.ts'), out);
console.log(`prompts.gen.ts: ${files.length}개 파일`);
