// 개발 서버가 저장소 밖 패키지 원본을 내주는 주소 (/@fs/<절대 경로>) — 이 시험 파일이 든 저장소 기준이라 작업 트리 · 다른 폴더에서도 맞다
import { fileURLToPath } from 'node:url';

/** rel: 저장소 뿌리에서 본 경로 (예: 'packages/engine-core/src/index.ts') */
export const fsPath = (rel) => `/@fs/${fileURLToPath(new URL(`../../${rel}`, import.meta.url)).split('\\').join('/')}`;
