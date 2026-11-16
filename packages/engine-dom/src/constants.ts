// 캔버스 뷰 상수: 색 · 핸들 크기 · 임계값.
export const PASTE_LONG = 240; // 이보다 긴 붙여넣기는 넓은 블록으로

/** 블록 배경색 (FR-024). 저장값은 이름이고 실제 색은 렌더러가 정한다 — 테마가 바뀌어도 데이터는 그대로. */
export const BLOCK_COLORS: Record<string, string> = {
  gray: '#f1f1ef', brown: '#f4eeee', orange: '#fbecdd', yellow: '#fbf3db', green: '#edf3ec',
  blue: '#e7f3f8', purple: '#f4f0f7', pink: '#f9eef3', red: '#fdebec',
};

export const HANDLE = 6;           // 핸들 한 변 (화면 px)
export const HANDLE_HIT = 8;
/** 터치 · 펜일 때 크기 조절 손잡이 그림 · 누르는 범위 (TABLET-CHECK T6 — 손가락 권장 44pt의 절반 둘레) */
export const HANDLE_TOUCH = 10;
export const HANDLE_HIT_TOUCH = 20;
export const CONNECT_R = 5;
export const DRAG_THRESHOLD = 3;
/** 자석 스냅이 끌어당기는 거리 (화면 px) */
export const SNAP_PX = 10;

export const DEFAULT_MIN_H = 56;
/** 제목 상자 최소 높이 — 한 줄 */
export const TITLE_MIN_H = 44;
export const LOD_ZOOM = 0.35;
/** 이보다 작게 보이면 카드 · 화살표를 경로 하나로 일괄 그리기 (최소 확대 25%에서도 쓰이게) */
export const LOD_BATCH_ZOOM = 0.3;
