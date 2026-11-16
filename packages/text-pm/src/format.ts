// 서식 명령 이름 (툴바 · 단축키 · 블록 메뉴 · 슬래시 메뉴 공용). DOM 없는 진입점(headless)에서도 쓰도록 따로 둔다.
export type FormatCommand =
  | 'strong' | 'em' | 'underline' | 'strike' | 'code' | 'highlight' | 'link' | 'chip'
  | 'h1' | 'h2' | 'h3' | 'h4' | 'paragraph' | 'bullet' | 'ordered' | 'task' | 'quote'
  | 'code_block' | 'divider' | 'toggle' | 'toggleH1' | 'toggleH2' | 'toggleH3' | 'callout' | 'math' | 'mathInline'
  /** 위 · 아래 첨자, 서식 지우기(링크 · 댓글은 남김, 제목 → 본문), 목록 들여쓰기 · 내어쓰기(목록 밖이면 false) */
  | 'sup' | 'sub' | 'clear' | 'indent' | 'outdent'
  /** 고른 글자만 글자 색 · 배경 색 (arg: 색 이름 · #rrggbb, 비우면 지움) */
  | 'textColor' | 'bgColor'
  /** 고른 글자만 글자 크기 (arg: 배율 · 'up' · 'down', 1이면 지움) */
  | 'fontSize'
  /** 고른 글자만 글꼴 (arg: 'serif' · 'mono', 그 밖이면 지움) */
  | 'fontFamily'
  /** 각주 넣기 (Ctrl+Alt+F) */
  | 'footnote'
  /** 문단 스타일 하나로 (arg: 본문 · h1~h4 · 인용 · 코드 · 콜아웃 — para-style.ts) */
  | 'paraStyle'
  /** 번호 목록 번호 모양 (arg: '' 기본 · 'outline' 다단계 1.1 — list-nums.ts) */
  | 'listNums';
