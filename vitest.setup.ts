// 테스트는 개발 빌드 검사를 켠 채로 돈다 — 엔진 레코드를 직접 고치는 코드가 있으면 여기서 터진다 (ENGINE 2.4).
// 루트는 @dn/engine-core에 의존하지 않으므로 경로로 — 패키지 main과 같은 파일이라 모듈 인스턴스도 같다
import { setDevChecks } from './packages/engine-core/src/index';

setDevChecks(true);
