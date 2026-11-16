// 생성물 — scripts/build-docs.js가 prd-tracker.html의 '단축키' 문서 페이지(FR.md 부록 A)에서 만든다. 직접 고치지 말 것.
// 도움말(Ctrl+/)과 구현이 같은 정의를 본다 (FR-023). ready=false는 그 기능이 아직 미착수라 "준비 중"으로 보인다.
export const SHORTCUT_SECTIONS: { heading: string; items: { text: string; frs: string[]; ready: boolean }[] }[] = [
  {
    "heading": "전역 · 탐색",
    "items": [
      {
        "text": "Ctrl+P — 노트 빠른 전환 (FR-087)",
        "frs": [
          "FR-087"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+Shift+P — 커맨드 팔레트 (FR-087)",
        "frs": [
          "FR-087"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+F — 현재 노트에서 찾기 / Ctrl+Shift+F — 전체 노트 검색 (FR-121)",
        "frs": [
          "FR-121"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+H — 찾아 바꾸기 (FR-123)",
        "frs": [
          "FR-123"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+Alt+N — 새 노트 (FR-067) · Ctrl+N은 브라우저가 선점하므로 사용하지 않는다",
        "frs": [
          "FR-067"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+\\ — 사이드바 접기 / 펼치기",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+Alt+Enter — 읽기 모드 전환 (FR-085)",
        "frs": [
          "FR-085"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+, — 설정 열기 (PRD-26)",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+/ — 단축키 도움말 열기 (FR-023)",
        "frs": [
          "FR-023"
        ],
        "ready": true
      },
      {
        "text": "Esc — 메뉴 · 팝업 닫기 → 텍스트 편집 종료 → 선택 해제 → 읽기 모드 해제 (순서대로 한 단계씩)",
        "frs": [],
        "ready": true
      }
    ]
  },
  {
    "heading": "캔버스",
    "items": [
      {
        "text": "Ctrl+= / Ctrl+- — 줌 인 / 줌 아웃 (FR-011)",
        "frs": [
          "FR-011"
        ],
        "ready": true
      },
      {
        "text": "Shift+0 — 줌 100%로 복귀 (FR-011) · Ctrl+0은 브라우저 확대 초기화로 남겨 둔다",
        "frs": [
          "FR-011"
        ],
        "ready": true
      },
      {
        "text": "Shift+1 — 전체 맞춤, 모든 블록을 한 화면에 (FR-012)",
        "frs": [
          "FR-012"
        ],
        "ready": true
      },
      {
        "text": "휠 · 두 손가락 스크롤 — 팬 · Ctrl/⌘+휠 · 핀치 — 커서 위치 기준 줌 (FR-011, D7)",
        "frs": [
          "FR-011"
        ],
        "ready": true
      },
      {
        "text": "Space+드래그 — 캔버스 팬 이동 (FR-011) · 마우스 휠 클릭 드래그도 동일",
        "frs": [
          "FR-011"
        ],
        "ready": true
      },
      {
        "text": "V — 선택 · B — 내용 상자 · T — 제목 상자 · A — 화살표 · H — 손(팬) 도구 · ] — 맨 앞으로 · Enter — 선택 블록 편집 (도구 전환, 텍스트 편집 중이 아닐 때)",
        "frs": [],
        "ready": true
      },
      {
        "text": "고른 글 상자에 바로 치기 — 도구 글자(V · B · T · A · H · P · M · E · L · C)가 아닌 글자 · 한글을 치면 그 상자에 바로 쓴다 · Enter: 표는 첫 칸 · 그래프는 데이터 창 (CQ-002 · CQ-003)",
        "frs": [],
        "ready": true
      },
      {
        "text": "방향키 — 선택한 블록을 1px 이동 / Shift+방향키 — 10px 이동",
        "frs": [],
        "ready": true
      },
      {
        "text": "/ — 넣기 메뉴: 사진 · 파일 · 표 · 그래프 · 데이터베이스 · 수식 · 코드 · 목록 · 콜아웃 (FR-018) · 툴바 ＋ · 빈 곳 오른쪽 클릭(그 자리에 넣기)도 같은 메뉴",
        "frs": [
          "FR-018"
        ],
        "ready": true
      },
      {
        "text": "두 번 클릭 — 표 머리글은 열 이름 고치기 · 그래프는 데이터 창(종류 · 제목 · 단위 · 값, 스프레드시트 붙여넣기) (FR-018)",
        "frs": [
          "FR-018"
        ],
        "ready": true
      },
      {
        "text": "오른쪽 클릭 — 블록 위면 블록 메뉴 (FR-024)",
        "frs": [
          "FR-024"
        ],
        "ready": true
      },
      {
        "text": "Tab / Shift+Tab — 블록 사이 이동, 읽는 순서대로 · 마지막에서 Tab이면 캔버스 밖으로 (FR-150)",
        "frs": [
          "FR-150"
        ],
        "ready": true
      },
      {
        "text": "Alt+방향키 — 고른 블록 크기 10px (Shift를 더하면 1px) (FR-150)",
        "frs": [
          "FR-150"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+방향키 — 고른 블록 크기 10px: ↓ 늘리기 · ↑ 줄이기(위 변 그대로), ← · → 그쪽으로 늘리기 · Ctrl+Shift+← · → 그쪽 변을 안으로 (FR-150, 10-28)",
        "frs": [
          "FR-150"
        ],
        "ready": true
      },
      {
        "text": "Shift+F10 · 메뉴 키 — 고른 블록의 블록 메뉴 (FR-150)",
        "frs": [
          "FR-150"
        ],
        "ready": true
      },
      {
        "text": "C — 고른 블록에서 연결 시작 → Tab으로 대상 → Enter로 화살표(이미 있으면 지우기) · Esc 그만두기 (FR-150)",
        "frs": [
          "FR-150"
        ],
        "ready": true
      }
    ]
  },
  {
    "heading": "블록 선택 · 조작",
    "items": [
      {
        "text": "클릭 — 선택 · Shift+클릭 — 선택 추가/해제 · 빈 캔버스 드래그 — 범위 선택 (FR-014)",
        "frs": [
          "FR-014"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+A — 전체 선택 (FR-014) · 텍스트 편집 중이면 그 블록 안 전체 선택",
        "frs": [
          "FR-014"
        ],
        "ready": true
      },
      {
        "text": "글 쓰다가 /선택 — 글쓰기를 끝내고 그 상자를 고른다(방향키로 옮기기 · Ctrl+방향키로 크기) · /블록 선택 — 그 상자가 든 묶음 전체 (FR-014, 10-28)",
        "frs": [
          "FR-014"
        ],
        "ready": true
      },
      {
        "text": "Delete / Backspace — 선택 블록 삭제, 연결된 화살표도 함께 정리 (FR-015)",
        "frs": [
          "FR-015"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+D — 복제 (FR-015) · Alt+드래그 — 복제하며 이동",
        "frs": [
          "FR-015"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+Z / Ctrl+Shift+Z — 실행 취소 / 다시 실행 (FR-022)",
        "frs": [
          "FR-022"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+C · Ctrl+X · Ctrl+V — 복사 · 잘라내기 · 붙여넣기",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+Shift+V — 서식 없이 순수 텍스트로 붙여넣기 (FR-031)",
        "frs": [
          "FR-031"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+L — 블록 링크 복사 (FR-025)",
        "frs": [
          "FR-025"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+Alt+M — 선택 블록에 댓글 달기 (FR-132)",
        "frs": [
          "FR-132"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+Alt+L — 현재 노트 잠금 / 해제 (FR-144)",
        "frs": [
          "FR-144"
        ],
        "ready": true
      }
    ]
  },
  {
    "heading": "텍스트 서식 (FR-027)",
    "items": [
      {
        "text": "Ctrl+B — 굵게 · Ctrl+I — 기울임 · Ctrl+U — 밑줄",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+Shift+X — 취소선",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+E — 인라인 코드",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+Shift+H — 형광펜 강조",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+K — 링크 삽입 (FR-030)",
        "frs": [
          "FR-030"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+Shift+\\ — 적용된 서식 모두 지우기",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+Shift+E — 고른 글을 인라인 수식으로 · 고른 글이 없으면 빈 수식 (FR-018, 노션과 같음) · 할 일 · 날짜 리마인더는 '@' 날짜 언급에서 (FR-136)",
        "frs": [
          "FR-018",
          "FR-136"
        ],
        "ready": true
      }
    ]
  },
  {
    "heading": "문서 뷰 — 워드처럼 (FR-088)",
    "items": [
      {
        "text": "Ctrl+L · Ctrl+E · Ctrl+R · Ctrl+J — 왼쪽 · 가운데 · 오른쪽 · 양쪽 맞춤 (문서 뷰에서는 Ctrl+E가 인라인 코드 대신 가운데 맞춤)",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+Shift+L — 글머리 목록 · Ctrl+] / Ctrl+[ (Ctrl+Shift+> / <) — 글자 크게 / 작게",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+Enter — 쪽 나누기 · 빈 줄에서 Enter — 그 자리에서 내용 상자 나누기",
        "frs": [],
        "ready": true
      },
      {
        "text": "Tab · Ctrl+M — 들여쓰기 / Shift+Tab · Ctrl+Shift+M — 내어쓰기 (목록 안이면 항목 단계)",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+. / Ctrl+, — 위 첨자 / 아래 첨자",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+Space · Ctrl+\\ — 고른 글 서식 지우기",
        "frs": [],
        "ready": true
      },
      {
        "text": "Alt+= — 인라인 수식 (워드 수식 키, 맥 제외 — Option+=는 ≠ 입력)",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+1 · 2 · 5 (줄 간격) · Ctrl+T (내어 쓰기)는 브라우저 탭 전환 · 새 탭이라 배정하지 않는다 — 서식 막대의 줄 간격 단추",
        "frs": [],
        "ready": true
      }
    ]
  },
  {
    "heading": "블록 타입 전환 (FR-026)",
    "items": [
      {
        "text": "/ — 슬래시 커맨드 메뉴 열기 (FR-029) · 블록 삽입의 기본 진입점",
        "frs": [
          "FR-029"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+Alt+0 — 본문 · Ctrl+Alt+1 / 2 / 3 — 제목 1 / 2 / 3",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+Alt+4 — 체크박스 · Ctrl+Alt+5 — 불릿 목록 · Ctrl+Alt+6 — 번호 목록",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+Alt+7 — 토글 · Ctrl+Alt+8 — 코드 블록 · Ctrl+Alt+9 — 콜아웃 (FR-048) · 인용은 '> ' 입력 또는 서식 툴바",
        "frs": [
          "FR-048"
        ],
        "ready": true
      }
    ]
  },
  {
    "heading": "목록 · 구조",
    "items": [
      {
        "text": "Tab / Shift+Tab — 목록 들여쓰기 단계 조절 (FR-032)",
        "frs": [
          "FR-032"
        ],
        "ready": true
      },
      {
        "text": "Alt+↑ / Alt+↓ — 현재 줄(하위 항목 포함) 위아래 이동 (FR-032)",
        "frs": [
          "FR-032"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+Enter — 체크박스 완료 토글 (FR-033)",
        "frs": [
          "FR-033"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+Alt+T — 토글 블록 접기 / 펼치기 (FR-047)",
        "frs": [
          "FR-047"
        ],
        "ready": true
      },
      {
        "text": "Enter — 같은 타입의 새 줄 · 빈 목록 항목에서 Enter — 본문으로 빠져나오기 · 제목 상자에서는 Enter · Tab — 편집 끝내기 (한 줄 제목)",
        "frs": [],
        "ready": true
      }
    ]
  },
  {
    "heading": "필기 (FR-034~042)",
    "items": [
      {
        "text": "P / M / E — 펜 · 형광펜(Marker) · 지우개 전환 (FR-034) · H는 손(팬) 도구",
        "frs": [
          "FR-034"
        ],
        "ready": true
      },
      {
        "text": "L — 올가미 선택 (FR-036)",
        "frs": [
          "FR-036"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+G — 고른 잉크가 있으면 블록에 묶기(FR-037), 아니면 고른 상자들을 블록으로 묶기(FR-019) / Ctrl+Shift+G — 묶음 풀기 · 잉크 풀기",
        "frs": [
          "FR-037",
          "FR-019"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+Alt+O — 선택한 필기를 텍스트로 인식 (FR-038)",
        "frs": [
          "FR-038"
        ],
        "ready": true
      },
      {
        "text": "숫자 1~5 — 펜 색상 전환 · [ / ] — 굵기 조절",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+Alt+H — 잉크 레이어 표시 전환 (FR-035)",
        "frs": [
          "FR-035"
        ],
        "ready": true
      },
      {
        "text": "펜 더블탭 — 지우개 전환 · 펜 버튼 누른 채 긋기 — 올가미 (태블릿, FR-154)",
        "frs": [
          "FR-154"
        ],
        "ready": false
      }
    ]
  },
  {
    "heading": "음성 · 캡처",
    "items": [
      {
        "text": "Ctrl+Alt+R — 녹음 시작 / 정지 (FR-043)",
        "frs": [
          "FR-043"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+Alt+I — 노션 · Markdown 가져오기 (PRD-22)",
        "frs": [],
        "ready": true
      }
    ]
  },
  {
    "heading": "AI",
    "items": [
      {
        "text": "Ctrl+Alt+S — 선택 영역을 AI로 구조화 요청 (FR-105)",
        "frs": [
          "FR-105"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+Alt+J — 내 노트에 질문하기 패널 열기 (FR-116)",
        "frs": [
          "FR-116"
        ],
        "ready": true
      },
      {
        "text": "Ctrl+J — AI 작성 도우미 열기 (요약 · 자세히 · 다듬기 · 말투, 캔버스 글 상자 — 고른 글이 없으면 상자 전체. 문서 뷰의 Ctrl+J는 워드처럼 양쪽 맞춤이라 말풍선 'AI'로) (FR-112)",
        "frs": [
          "FR-112"
        ],
        "ready": true
      },
      {
        "text": "Esc — 진행 중인 AI 요청 취소 (FR-103)",
        "frs": [
          "FR-103"
        ],
        "ready": true
      }
    ]
  },
  {
    "heading": "마크다운 입력 (FR-028) — 타이핑만으로 변환",
    "items": [
      {
        "text": "'# ' · '## ' · '### ' · '#### ' — 제목 1 / 2 / 3 / 4",
        "frs": [],
        "ready": true
      },
      {
        "text": "'- ' 또는 '* ' — 불릿 목록 · '1. ' — 번호 목록 · '[] ' — 체크박스",
        "frs": [],
        "ready": true
      },
      {
        "text": "'> ' — 인용 · '``` ' — 코드 블록 · '--- ' — 구분선",
        "frs": [],
        "ready": true
      },
      {
        "text": "'**굵게**' · '*기울임*' · '~~취소선~~' · '`코드`' — 인라인 서식",
        "frs": [],
        "ready": true
      },
      {
        "text": "변환 직후 Backspace를 누르면 원래 입력한 문자로 되돌아간다",
        "frs": [],
        "ready": true
      }
    ]
  },
  {
    "heading": "브라우저 단축키와의 충돌 처리",
    "items": [
      {
        "text": "브라우저 · OS가 선점해 가로챌 수 없거나 가로채면 안 되는 조합(Ctrl+N · T · W · Tab, Ctrl+Shift+T · N · I · J · A · M · R, Ctrl+R, Ctrl+0, ⌘+Space)은 아예 배정하지 않는다 — 새 노트에 Ctrl+Alt+N을 쓰는 이유 · 예외: 문서 뷰 글 편집 중 Ctrl+Shift+M은 워드처럼 내어쓰기 (브라우저가 먼저 가져가면 Shift+Tab)",
        "frs": [],
        "ready": true
      },
      {
        "text": "가로챌 수 있는 조합(Ctrl+P 인쇄 · Ctrl+F 찾기 · Ctrl+S 저장 · Ctrl+D 즐겨찾기 · Ctrl+H 기록 · Ctrl+J 다운로드)은 preventDefault로 앱 동작을 우선한다",
        "frs": [],
        "ready": true
      },
      {
        "text": "Ctrl+S는 별도 동작 없이 가로채기만 한다 — 자동 저장(FR-089)이 이미 동작 중임을 알리는 안내만 표시",
        "frs": [
          "FR-089"
        ],
        "ready": true
      },
      {
        "text": "읽기 모드(FR-085)와 편집 잠금(FR-072)에서는 편집용 단축키를 비활성화한다",
        "frs": [
          "FR-085",
          "FR-072"
        ],
        "ready": true
      },
      {
        "text": "입력 필드(검색창 · 이름 편집 등)에 포커스가 있을 때는 전역 단축키를 처리하지 않는다",
        "frs": [],
        "ready": true
      }
    ]
  }
];
