// 넣기 메뉴: 툴바 ＋ · 빈 곳 오른쪽 클릭 · 캔버스에서 / — 글 상자 · 사진 · 파일 · 표 · 그래프 · 데이터베이스 · 수식 · 코드 · 목록 등.
// 위에서 바로 찾기(초성도), ↑↓ · Enter로 고르기, Esc로 닫기. 고르면 engine-dom insertBlock이 블록을 만들고 바로 고칠 수 있게 연다.
// 핀 아이콘(키보드는 Ctrl+P): 그 항목을 아래 도구 막대에 고정 (한 번 눌러 바로 넣기).
// 맨 위 '내 블록': 블록 메뉴 › 내 블록으로 저장한 상자 · 블록 — 누르면 블록 이름을 물은 뒤 사본(그 이름의 블록), 오른쪽 클릭으로 이름 바꾸기 · 빼기.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { insertBlock, type CanvasView, type InsertKind, type InsertMenuRequest } from '@dn/engine-dom';
import { filterSlash, type IconName } from '@dn/text-pm';
import { Icon } from './Icon';
import { SNIPPET_PIN, type Snippet } from './snippets';

interface Item { kind: InsertKind; label: string; icon: IconName; hint: string; keywords: string[]; group: string }
/** 메뉴 한 줄 — 넣기 항목 또는 내 블록 (key = kind 또는 'snip:id', 도구 막대 고정 이름과 같다) */
interface Entry { key: string; label: string; icon: IconName; hint: string; keywords: string[]; group: string; kind?: InsertKind; snip?: Snippet }

export const INSERT_ITEMS: Item[] = [
  { kind: 'text', label: '내용 상자', icon: 'text', group: '기본', hint: '글을 쓰는 상자 · B', keywords: ['text', 'box', '글', '본문', '내용', '상자'] },
  { kind: 'title', label: '제목 상자', icon: 'heading', group: '기본', hint: '한 줄 제목 · T', keywords: ['title', 'heading', '제목'] },
  { kind: 'line-h', label: '구분선', icon: 'divider', group: '기본', hint: '상자 · 카드 사이 가로선 — 가운데 글을 달 수 있어요', keywords: ['divider', 'hr', 'line', 'separator', '구분선', '선', '가로선'] },
  { kind: 'line-v', label: '세로 구분선', icon: 'divider', group: '기본', hint: 'VS 비교 · 열 나누기', keywords: ['vertical', 'divider', 'vs', '세로선', '세로 구분선', '비교'] },
  { kind: 'image', label: '사진', icon: 'image', group: '미디어', hint: '이미지 파일 고르기 — 끌어 놓기 · 붙여넣기도 돼요', keywords: ['image', 'photo', 'picture', 'img', '사진', '이미지', '그림'] },
  { kind: 'file', label: '파일', icon: 'paperclip', group: '미디어', hint: '50MB까지 첨부', keywords: ['file', 'attach', 'pdf', '파일', '첨부'] },
  { kind: 'bookmark', label: '웹 북마크', icon: 'bookmark', group: '미디어', hint: '웹 주소를 제목 · 설명 카드로', keywords: ['bookmark', 'link', 'url', 'web', '북마크', '링크', '웹', '주소'] },
  { kind: 'web-embed', label: '웹 임베드', icon: 'globe', group: '미디어', hint: '유튜브 · 피그마 · 지도 등을 노트 안에서', keywords: ['embed', 'iframe', 'youtube', 'vimeo', 'figma', 'maps', 'web', '임베드', '유튜브', '지도', '웹', '끼워 넣기'] },
  { kind: 'record', label: '음성 녹음', icon: 'mic', group: '미디어', hint: '마이크로 녹음 — 끝내면 재생 블록', keywords: ['record', 'audio', 'voice', 'mic', '녹음', '음성', '마이크'] },
  { kind: 'table', label: '표', icon: 'table', group: '데이터', hint: '행 · 열 표 — 열 이름부터 입력', keywords: ['table', 'grid', '표', '테이블'] },
  { kind: 'chart', label: '그래프', icon: 'chart', group: '데이터', hint: '막대 · 꺾은선 · 원 — 데이터 창이 열려요', keywords: ['chart', 'graph', 'plot', '그래프', '차트', '도표'] },
  { kind: 'database', label: '데이터베이스', icon: 'database', group: '데이터', hint: '속성 · 표 · 보드 · 달력 보기', keywords: ['database', 'db', '데이터베이스', '디비', '목록'] },
  { kind: 'toc', label: '목차', icon: 'listOrdered', group: '데이터', hint: '노트의 제목을 모아 — 누르면 그 블록으로', keywords: ['toc', 'contents', 'outline', '목차', '차례', '개요'] },
  { kind: 'tabs', label: '탭', icon: 'pages', group: '데이터', hint: '블록 하나를 탭 여러 개로 — 한 번에 한 탭씩', keywords: ['tabs', 'tab', '탭'] },
  { kind: 'button', label: '버튼', icon: 'plus', group: '데이터', hint: '누르면 정해 둔 상자를 바로 아래에', keywords: ['button', '단추', '템플릿', '반복'] },
  { kind: 'embed', label: '블록 임베드', icon: 'link', group: '데이터', hint: '다른 노트의 블록을 그대로 — 블록 링크를 붙여넣어도 돼요', keywords: ['embed', 'reference', 'block', '임베드', '참조', '블록 링크', '가져오기'] },
  { kind: 'math', label: '수식', icon: 'sigma', group: '서식 상자', hint: 'LaTeX 블록 수식', keywords: ['math', 'latex', 'equation', 'formula', '수식', '공식', '방정식'] },
  { kind: 'code', label: '코드', icon: 'code', group: '서식 상자', hint: '코드 블록', keywords: ['code', 'codeblock', '코드'] },
  { kind: 'task', label: '할 일 목록', icon: 'checkSquare', group: '서식 상자', hint: '체크 상자 목록', keywords: ['todo', 'task', 'check', '할일', '체크'] },
  { kind: 'bullet', label: '글머리 목록', icon: 'list', group: '서식 상자', hint: '• 목록', keywords: ['bullet', 'list', '목록', '리스트'] },
  { kind: 'ordered', label: '번호 목록', icon: 'listOrdered', group: '서식 상자', hint: '1. 2. 3.', keywords: ['number', 'ordered', 'list', '번호', '숫자'] },
  { kind: 'callout', label: '콜아웃', icon: 'bulb', group: '서식 상자', hint: '아이콘 · 배경색 강조', keywords: ['callout', 'tip', 'note', '강조', '주의'] },
  { kind: 'quote', label: '인용', icon: 'quote', group: '서식 상자', hint: '인용문', keywords: ['quote', 'blockquote', '인용'] },
  { kind: 'toggle', label: '토글', icon: 'toggle', group: '서식 상자', hint: '접고 펼치는 목록', keywords: ['toggle', 'details', '접기', '펼치기'] },
  { kind: 'divider', label: '가로줄 (글 상자)', icon: 'divider', group: '서식 상자', hint: '글 상자 안 문단 사이 가로선', keywords: ['hr', 'rule', '가로줄', '글 가로줄'] },
];

export function InsertMenu({ req, view, onClose, pins = [], onPin, snippets = [], onSnippet, onRenameSnippet, onRemoveSnippet }: {
  req: InsertMenuRequest; view: CanvasView; onClose: () => void; pins?: readonly string[]; onPin?: (key: string) => void;
  snippets?: readonly Snippet[]; onSnippet?: (id: string, at?: { x: number; y: number }) => void;
  onRenameSnippet?: (id: string, name: string) => void; onRemoveSnippet?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ x: req.x, y: req.y });
  const [ctx, setCtx] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const items = useMemo(() => filterSlash<Entry>([
    ...snippets.map((sn): Entry => ({ key: SNIPPET_PIN + sn.id, label: sn.name, icon: 'block', group: '내 블록', hint: `${sn.name} — 누르면 블록 이름을 정해 새로 넣어요 · 오른쪽 클릭으로 이름 바꾸기 · 빼기`, keywords: ['내 블록', 'snippet'], snip: sn })),
    ...INSERT_ITEMS.map((it): Entry => ({ ...it, key: it.kind })),
  ], q, true), [q, snippets]);
  // 터치 화면에서는 찾기 칸에 바로 포커스하지 않는다 — 화면 키보드가 올라와 목록을 가린다
  const [coarse] = useState(() => matchMedia('(pointer: coarse)').matches);
  useEffect(() => setActive(0), [q]);

  // 화면 밖으로 넘치면 안쪽으로
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const y = req.y + r.height > innerHeight - 8 ? Math.max(8, req.y - r.height) : req.y; // 아래가 모자라면 위로 (툴바에서 열면 위로)
    setPos({ x: Math.max(8, Math.min(req.x, innerWidth - r.width - 8)), y });
  }, [req]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (it: Entry) => {
    onClose();
    if (it.snip) onSnippet?.(it.snip.id, req.at);
    else if (it.kind) insertBlock(view, it.kind, { ...(req.at ? { at: req.at } : {}), anchor: { x: req.x, y: req.y } });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); onClose(); view.root.focus({ preventScroll: true }); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[active]; if (it) choose(it); }
    // Ctrl+P는 앱 전체에서 빠른 전환 — 넣기 메뉴 안에서는 고정으로 쓰고 위로 올려 보내지 않는다
    else if (onPin && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyP') { e.preventDefault(); e.stopPropagation(); const it = items[active]; if (it) onPin(it.key); }
  };

  let lastGroup = '';
  return (
    <div ref={ref} className="menu insert-menu" role="dialog" aria-label="넣기" style={{ left: pos.x, top: pos.y }} onKeyDown={onKey}>
      <input className="insert-search" autoFocus={!coarse} value={q} onChange={(e) => setQ(e.target.value)} placeholder="넣을 것 찾기 (사진 · 표 · 수식 …)"
        aria-label="넣을 것 찾기" aria-controls="insert-list" aria-activedescendant={items[active] ? `ins-${items[active]!.key}` : undefined} />
      <div className="insert-list" id="insert-list" role="listbox" aria-label="넣을 것">
        {!items.length && <div className="insert-empty">맞는 항목이 없어요</div>}
        {items.map((it, i) => {
          const head = !q && it.group !== lastGroup ? it.group : null;
          lastGroup = it.group;
          const sn = it.snip;
          return (
            <div key={it.key}>
              {head && <div className="menu-head">{head}</div>}
              {sn && renaming?.id === sn.id ? (
                <input className="insert-snip-name" autoFocus value={renaming.draft} aria-label="내 블록 이름" maxLength={40}
                  onChange={(e) => setRenaming({ id: sn.id, draft: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') { e.preventDefault(); onRenameSnippet?.(sn.id, renaming.draft); setRenaming(null); }
                    else if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); }
                  }} onBlur={() => setRenaming(null)} />
              ) : (
                <button id={`ins-${it.key}`} data-i={i} role="option" aria-selected={i === active} className={`insert-item${i === active ? ' on' : ''}`}
                  onMouseMove={() => setActive(i)} onClick={() => choose(it)}
                  onContextMenu={sn ? (e) => { e.preventDefault(); setCtx(ctx === sn.id ? null : sn.id); } : undefined}>
                  <span className="insert-ic"><Icon name={it.icon} size={20} /></span>
                  <span className="insert-text" title={it.hint}><b>{it.label}</b></span>
                  {onPin && (
                    // 옵션 안에 또 단추를 두면 안 된다(nested-interactive) — 마우스는 핀 아이콘, 키보드는 Ctrl+P
                    <span aria-hidden="true" className={`insert-pin${pins.includes(it.key) ? ' on' : ''}`}
                      title={`${pins.includes(it.key) ? '아래 도구 막대에서 빼기' : '아래 도구 막대에 고정'} (Ctrl+P)`}
                      onClick={(e) => { e.stopPropagation(); onPin(it.key); }}><Icon name="pin" size={14} /></span>
                  )}
                  {pins.includes(it.key) && <span className="sr-only">도구 막대에 고정됨</span>}
                </button>
              )}
              {sn && ctx === sn.id && (
                <div className="insert-snip-ctx" role="group" aria-label={`${sn.name} 관리`}>
                  <button type="button" onClick={() => { setRenaming({ id: sn.id, draft: sn.name }); setCtx(null); }}>이름 바꾸기</button>
                  <button type="button" className="danger" onClick={() => { onRemoveSnippet?.(sn.id); setCtx(null); }}>빼기</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {items[active] && <div className="insert-foot" aria-hidden="true">{items[active]!.hint}</div>}
    </div>
  );
}
