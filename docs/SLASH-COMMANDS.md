# 슬래시(/) 명령 목록

> **이 파일이 `/` 메뉴의 원본이다.** 캔버스(글 상자 · 제목 상자)와 문서 뷰가 모두 이 표를 읽는다 — 행을 더하거나 고치면 메뉴가 바로 바뀐다(개발 서버는 저장하자마자, 배포는 다음 빌드부터).
> 노션 슬래시 명령을 모두 옮겨 왔다. 앱에 아직 없는 기능은 맨 아래 **계획** 절에 두었다(메뉴에 안 나온다). PRD 트래커의 영역 **AC · 슬래시 명령**과 같은 목록이다.

## 쓰는 법

- `## 제목`이 메뉴의 묶음 머리다(검색어 없이 `/`만 치면 묶음별로 보인다). 제목에 `계획`이 들어간 절은 메뉴에 넣지 않는다.
- 표 한 줄 = 명령 하나. 열은 **이름 | 검색어 | 설명 | 실행 | 노션** 순서. 첫 줄(열 이름)과 `|---|` 줄은 건너뛴다.
  - **검색어**: 쉼표로 나눈 별칭(한글 · 영문 · 줄임말). 이름과 검색어는 초성으로도 찾는다(`ㅈㅁ` → 제목).
  - **노션**: 노션에서의 이름(참고용, 메뉴에는 안 나온다). 노션에 없는 명령은 `-`.
  - 글자 `|`를 쓰려면 `\|`.
- **실행** 칸에 쓰는 것:

| 실행 | 뜻 | 예 |
|---|---|---|
| `서식 <이름>` | 지금 줄을 그 모양으로 | `서식 h1`, `서식 bullet`, `서식 math` |
| `넣기 <종류>` | 이 상자 바로 아래에 새 블록 | `넣기 table`, `넣기 video`, `넣기 db-board` |
| `동작 <이름>` | 이 블록에 하는 일 | `동작 duplicate`, `동작 delete`, `동작 link` |
| `색 <색>` · `배경 <색>` | 이 블록의 글자 색 · 배경 색 (`default` = 기본) | `색 red`, `배경 yellow` |
| `날짜 <오늘 \| 내일 \| 어제>` | 날짜 언급(리마인더 · 할 일 모아보기와 이어짐) | `날짜 오늘` |
| `글 <마크다운>` | 이 자리에 글 넣기 — **직접 만드는 명령은 대부분 이것** | `글 ## 참석자\n- ` |
| `AI <이름>` | AI 기능 | `AI 구조화` |

- `글`의 마크다운: `\n` = 줄바꿈, `#` 제목 · `-` 목록 · `[ ]` 할 일 · `**굵게**` 등. 자리 표시 `{오늘}` · `{내일}` · `{어제}` · `{지금}` · `{요일}`은 넣는 순간의 날짜 · 시각으로 바뀐다.
- 쓸 수 있는 이름 — 서식: `paragraph h1 h2 h3 h4 bullet ordered task toggle toggleH1 toggleH2 toggleH3 quote callout code_block math mathInline divider footnote` · 넣기: `table chart image video audio file record toc database db-board db-calendar db-gallery db-list db-timeline db-chart columns-2 … columns-5 embed bookmark web-embed button tabs` · 동작: `duplicate delete copy-link comment move select select-block link page symbol emoji xref` · 색: `gray brown orange yellow green blue purple pink red default`.
- 모르는 이름이 든 줄은 메뉴에 넣지 않는다(개발 도구 콘솔에 경고).

## 기본 블록

| 이름 | 검색어 | 설명 | 실행 | 노션 |
|---|---|---|---|---|
| 텍스트 | text, paragraph, plain, 본문, 문단, 글 | 일반 글 | 서식 paragraph | Text |
| 제목 1 | heading1, h1, title, 큰제목, # | 큰 제목 | 서식 h1 | Heading 1 |
| 제목 2 | heading2, h2, 중제목, ## | 중간 제목 | 서식 h2 | Heading 2 |
| 제목 3 | heading3, h3, 소제목, ### | 작은 제목 | 서식 h3 | Heading 3 |
| 제목 4 | heading4, h4, ####, 작은 소제목 | 가장 작은 제목 | 서식 h4 | Heading 4 |
| 글머리 기호 목록 | bullet, list, ul, 목록, 리스트 | - 로도 시작 | 서식 bullet | Bulleted list |
| 번호 목록 | number, numbered, ordered, ol, 숫자 | 1. 로도 시작 | 서식 ordered | Numbered list |
| 할 일 목록 | todo, task, check, 체크, 할일, 체크박스 | [] 로도 시작 | 서식 task | To-do list |
| 토글 | toggle, collapse, details, 접기, 펼치기 | 접고 펼치는 목록 | 서식 toggle | Toggle list |
| 토글 제목 1 | toggle heading 1, toggle h1 | 큰 제목 모양의 토글 | 서식 toggleH1 | Toggle heading 1 |
| 토글 제목 2 | toggle heading 2, toggle h2 | 중간 제목 모양의 토글 | 서식 toggleH2 | Toggle heading 2 |
| 토글 제목 3 | toggle heading 3, toggle h3 | 작은 제목 모양의 토글 | 서식 toggleH3 | Toggle heading 3 |
| 인용 | quote, blockquote, 인용문 | > 로도 시작 | 서식 quote | Quote |
| 구분선 | divider, hr, line, separator, 가로선, 선 | --- 로도 시작 | 서식 divider | Divider |
| 콜아웃 | callout, note, tip, 강조, 박스, 주의 | 아이콘 · 배경색 강조 상자 | 서식 callout | Callout |
| 표 | table, grid, simple table, 테이블, 행열 | 행 · 열 표 — 아래에 새 블록, 열 이름부터 | 넣기 table | Table · Simple table |
| 페이지 | page, subpage, 하위 페이지, 새 노트 | 새 노트를 만들고 여기에 링크 | 동작 page | Page |
| 페이지 링크 | link, link to page, mention page, 노트 링크, 언급 | 있는 노트를 골라 링크 ([[ 로도) | 동작 link | Link to page · Mention a page |
| 코드 | code, codeblock, pre, 코드블록 | ``` 로도 시작 | 서식 code_block | Code |
| 머메이드 | mermaid, diagram, flowchart, 순서도, 도식 | 글로 쓰는 순서도 — 블록 메뉴 › 'Mermaid → 캔버스 도식'으로 상자 · 화살표로 | 글 ```mermaid\nflowchart TD\n  A[시작] --> B{조건}\n  B -->\|예\| C[처리]\n  B -->\|아니요\| D[끝]\n``` | Code - Mermaid |
| 수식 블록 | math, latex, equation, formula, katex, 수식, 공식, 방정식 | 블록 수식 — 줄 맨 앞 $$ 로도 | 서식 math | Block equation |
| 목차 | toc, contents, outline, table of contents, 차례, 개요 | 노트의 제목을 모은 목차 — 누르면 그 블록으로 | 넣기 toc | Table of contents |
| 탭 | tabs, tab, 탭, 나눠 보기 | 블록 하나를 탭 여러 개로 — 한 번에 한 탭씩 (글은 두 번 눌러 고치기) | 넣기 tabs | Tabs |
| 버튼 | button, 단추, 템플릿 버튼, 반복 | 누르면 정해 둔 상자를 바로 아래에 넣는 단추 (⋯에서 고른 상자로 바꾸기) | 넣기 button | Button |
| 동기화 블록 | synced block, embed block, 블록 임베드, 원본 | 다른 블록을 그대로 보여 줌 (블록 링크로) | 넣기 embed | Synced block |
| 2열 | columns, 2 columns, 두 칸, 단 나누기 | 나란한 두 칸 — 아래에 빈 글 상자 둘 | 넣기 columns-2 | 2 columns |
| 3열 | 3 columns, 세 칸 | 나란한 세 칸 | 넣기 columns-3 | 3 columns |
| 4열 | 4 columns, 네 칸 | 나란한 네 칸 | 넣기 columns-4 | 4 columns |
| 5열 | 5 columns, 다섯 칸 | 나란한 다섯 칸 | 넣기 columns-5 | 5 columns |

## 글 속

| 이름 | 검색어 | 설명 | 실행 | 노션 |
|---|---|---|---|---|
| 인라인 수식 | inline math, inline equation, 글속 수식 | 글 사이에 넣는 수식 — Ctrl+Shift+E · $식$ 로도 | 서식 mathInline | Inline equation |
| 오늘 | today, now, date, 날짜, 리마인더, remind | 오늘 날짜 언급 (@ 로도) | 날짜 오늘 | Date or reminder · /today |
| 내일 | tomorrow, 내일 날짜 | 내일 날짜 언급 | 날짜 내일 | /tomorrow |
| 어제 | yesterday, 어제 날짜 | 어제 날짜 언급 | 날짜 어제 | /yesterday |
| 지금 시각 | time, clock, 시각, 시간, 타임스탬프 | 지금 날짜 · 시각을 글로 | 글 {지금} | /now |
| 각주 | footnote, endnote, 주석, 출처, 참고 | 글 속 번호 + 문서 끝 각주 — Ctrl+Alt+F 로도 | 서식 footnote | - |
| 상호 참조 | xref, cross-reference, reference, 참조, 그림 번호, 표 번호 | 캡션 단 그림 · 표를 골라 '그림 1' 넣기 — 차례가 바뀌면 번호도 | 동작 xref | - |
| 기호 | symbol, special character, 특수 문자, 화살표, 수학 기호, 그리스 | 화살표 · 수학 · 그리스 문자 · 원 숫자 고르기 (→ 는 -> 로도) | 동작 symbol | - |
| 이모지 | emoji, emoticon, 이모티콘, 웃음, 하트 | 이모지 고르기 — 글 속에서 :하트 처럼 쳐도 | 동작 emoji | Emoji |

## 미디어

| 이름 | 검색어 | 설명 | 실행 | 노션 |
|---|---|---|---|---|
| 사진 | image, photo, picture, img, 이미지, 그림 | 이미지 파일 고르기 — 아래에 새 블록 | 넣기 image | Image |
| 동영상 | video, movie, mp4, 비디오, 영상 | 동영상 파일 고르기 — 아래에 재생 블록 | 넣기 video | Video |
| 오디오 | audio, sound, mp3, 소리, 음악 | 오디오 파일 고르기 — 아래에 재생 블록 | 넣기 audio | Audio |
| 웹 북마크 | bookmark, link preview, url, 북마크, 링크 카드, 웹 | 웹 주소를 제목 · 설명 · 그림 카드로 | 넣기 bookmark | Web bookmark |
| 웹 임베드 | embed, iframe, youtube, vimeo, figma, maps, codepen, loom, spotify, 유튜브, 지도, 끼워 넣기 | 유튜브 · 피그마 · 지도 등을 노트 안에서 바로 (그 밖의 주소는 카드로) | 넣기 web-embed | Embed |
| 파일 | file, attach, attachment, pdf, 첨부 | 파일 첨부 — 아래에 새 블록 | 넣기 file | File |
| 음성 녹음 | record, voice, mic, 녹음, 음성, 마이크 | 마이크로 녹음 — 끝내면 재생 블록 | 넣기 record | - |
| 그래프 | chart, graph, plot, bar, pie, 차트, 도표 | 막대 · 꺾은선 · 원 — 아래에 새 블록, 데이터 창이 열려요 | 넣기 chart | Chart view |

## 데이터베이스

| 이름 | 검색어 | 설명 | 실행 | 노션 |
|---|---|---|---|---|
| 데이터베이스 | database, db, table view, inline, 디비, 속성 | 속성으로 항목을 관리하는 표 — 아래에 새 블록 | 넣기 database | Database - Inline · Table view |
| 보드 보기 | board, kanban, 칸반, 보드 | 상태별 칸으로 나눈 데이터베이스 | 넣기 db-board | Board view |
| 캘린더 보기 | calendar, 달력, 캘린더, 일정 | 날짜 속성을 달력으로 | 넣기 db-calendar | Calendar view |
| 갤러리 보기 | gallery, cards, 카드, 갤러리 | 항목을 카드로 | 넣기 db-gallery | Gallery view |
| 리스트 보기 | list view, 리스트 보기, 목록 보기 | 항목을 한 줄씩 | 넣기 db-list | List view |
| 타임라인 보기 | timeline, gantt, 간트, 일정 막대 | 날짜 · 기간을 가로 막대로 (끌어서 날짜 옮기기) | 넣기 db-timeline | Timeline view |
| 차트 보기 | chart view, 그래프 보기, 통계 | 항목을 묶음별 막대로 (개수 · 숫자 합) | 넣기 db-chart | Chart view |

## 블록 동작

| 이름 | 검색어 | 설명 | 실행 | 노션 |
|---|---|---|---|---|
| 복제 | duplicate, copy block, 복사, 사본 | 이 블록을 바로 아래에 하나 더 (Ctrl+D) | 동작 duplicate | Duplicate |
| 삭제 | delete, remove, 지우기 | 이 블록 지우기 | 동작 delete | Delete |
| 블록 링크 복사 | copy link, link to block, 링크 복사 | 이 블록 링크 — 다른 노트에 붙이면 임베드 | 동작 copy-link | Copy link to block |
| 댓글 | comment, 메모, 의견 | 이 블록에 댓글 (글을 골라 달 수도) | 동작 comment | Comment |
| 다른 노트로 옮기기 | move to, move, 옮기기, 이동, 보내기 | 이 블록을 다른 노트 맨 아래로 | 동작 move | Move to |
| 선택 | select, 고르기, 상자 선택, 콘텐츠 선택 | 글쓰기를 끝내고 이 상자를 고른다 — 화살표로 옮기기, Ctrl+화살표로 크기(Shift면 줄이기) | 동작 select | - |
| 블록 선택 | select block, 묶음 선택, 블록 고르기 | 이 상자가 든 블록(묶음) 전체를 고른다 — 묶음이 아니면 이 상자 | 동작 select-block | - |
| 기본 글자 색 | default color, 글자 기본, 색 없애기 | 이 블록 글자 색 지우기 | 색 default | Default |
| 회색 글자 | gray, grey, 회색 | 이 블록 글자를 회색으로 | 색 gray | Gray |
| 갈색 글자 | brown, 갈색 | 이 블록 글자를 갈색으로 | 색 brown | Brown |
| 주황 글자 | orange, 주황 | 이 블록 글자를 주황으로 | 색 orange | Orange |
| 노랑 글자 | yellow, 노랑, 노란 | 이 블록 글자를 노랑으로 | 색 yellow | Yellow |
| 초록 글자 | green, 초록, 녹색 | 이 블록 글자를 초록으로 | 색 green | Green |
| 파랑 글자 | blue, 파랑, 파란 | 이 블록 글자를 파랑으로 | 색 blue | Blue |
| 보라 글자 | purple, 보라 | 이 블록 글자를 보라로 | 색 purple | Purple |
| 분홍 글자 | pink, 분홍 | 이 블록 글자를 분홍으로 | 색 pink | Pink |
| 빨강 글자 | red, 빨강, 빨간 | 이 블록 글자를 빨강으로 | 색 red | Red |
| 기본 배경 | default background, 배경 없애기 | 이 블록 배경 색 지우기 | 배경 default | Default background |
| 회색 배경 | gray background, 회색 배경 | 이 블록 배경을 회색으로 | 배경 gray | Gray background |
| 갈색 배경 | brown background, 갈색 배경 | 이 블록 배경을 갈색으로 | 배경 brown | Brown background |
| 주황 배경 | orange background, 주황 배경 | 이 블록 배경을 주황으로 | 배경 orange | Orange background |
| 노랑 배경 | yellow background, 노랑 배경 | 이 블록 배경을 노랑으로 | 배경 yellow | Yellow background |
| 초록 배경 | green background, 초록 배경 | 이 블록 배경을 초록으로 | 배경 green | Green background |
| 파랑 배경 | blue background, 파랑 배경 | 이 블록 배경을 파랑으로 | 배경 blue | Blue background |
| 보라 배경 | purple background, 보라 배경 | 이 블록 배경을 보라로 | 배경 purple | Purple background |
| 분홍 배경 | pink background, 분홍 배경 | 이 블록 배경을 분홍으로 | 배경 pink | Pink background |
| 빨강 배경 | red background, 빨강 배경 | 이 블록 배경을 빨강으로 | 배경 red | Red background |

## AI

| 이름 | 검색어 | 설명 | 실행 | 노션 |
|---|---|---|---|---|
| AI로 구조화하기 | ai, structure, claude, 구조화, 자동, 정리 | 이 상자 글을 블록 · 화살표 · 표로 | AI 구조화 | - |

## 내가 만든 명령

> 여기에 줄을 더하면 내 명령이 된다. 실행은 보통 `글 …`(마크다운). 아래 둘은 예시 — 고치거나 지워도 된다.

| 이름 | 검색어 | 설명 | 실행 | 노션 |
|---|---|---|---|---|
| 회의록 틀 | meeting, minutes, 회의, 회의록 | 날짜 · 참석자 · 안건 · 결정 · 할 일 | 글 ### {오늘} 회의\n**참석자** \n## 안건\n- \n## 결정\n- \n## 할 일\n- [ ] | - |
| 오늘 일기 | diary, journal, 일기, 하루 | 오늘 날짜 제목과 세 줄 | 글 ## {오늘} ({요일})\n- 한 일: \n- 배운 것: \n- 내일: | - |

## 계획 — 아직 없는 노션 명령

> 메뉴에 나오지 않는다. 기능이 생기면 위 절로 옮기고 실행 칸을 채운다. (PRD 트래커 영역 AC의 '계획' 항목)

| 이름 | 검색어 | 설명 | 실행 | 노션 |
|---|---|---|---|---|
| 이동 경로 | breadcrumb | 상위 노트 경로 | 계획 | Breadcrumb |
| 사람 언급 | person, mention | 다른 사용자 언급 (계정 · 공유가 생긴 뒤) | 계획 | Mention a person |
| 폼 | form | 데이터베이스에 항목을 받는 양식 | 계획 | Form |
| 전체 페이지 데이터베이스 | full page database | 노트 하나가 통째로 데이터베이스 | 계획 | Database - Full page |
| 다른 블록으로 전환 | turn into | 블록 종류 바꾸기 (지금은 서식 명령으로) | 계획 | Turn into |
| AI에게 묻기 · 이어 쓰기 · 요약 · 번역 · 다듬기 | ask ai, continue, summarize, translate | AI 작성 도우미 (나중에) | 계획 | Ask AI · Continue writing · Summarize · Translate · Improve writing |
