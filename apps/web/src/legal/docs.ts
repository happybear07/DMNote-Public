// 법적 문서 본문 — LegalDialog가 열릴 때만 불러온다(첫 화면 번들에 넣지 않음).
import terms from './terms.md?raw';
import privacy from './privacy.md?raw';
import ai from './ai.md?raw';
import { parseMd, type MdBlock } from './md';
import type { LegalId } from './meta';

const SRC: Record<LegalId, string> = { terms, privacy, ai };

export const legalBlocks = (id: LegalId): MdBlock[] => parseMd(SRC[id]);
