// 블록 메뉴 (FR-024): 블록 핸들 ⋮⋮ 클릭 · 오른쪽 클릭(글 편집 중에도). 다중 선택이면 선택 블록 전체에 적용한다.
// 첫 화면은 동작만 (DS-001 — 46개 → 12개 안팎): 그 상자에만 있는 것 · 복제 · 링크 · 옮기기 · 댓글 │ (묶음 ▸) · 바꾸기 ▸ · 글자 모양 ▸ · 배경색 ▸ · 의미 ▸ │ AI │ 삭제.
// 하위 메뉴는 한 번에 하나(SubMenu). 글을 골라 둔 채 열면 '글자 모양'을 바로 펼친다(고른 글자 서식이 목적).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hasAudio } from './stt-flow';
import { STT_LANGS, type SttLang } from './stt';
import { BLOCK_COLORS, blockLabel, editCaption, editImageAlt, groupSelection, hasBoundInk, selectedGroup, sourceBlockOf, unbindBlockInk, ungroupSelection, type BlockMenuRequest, type CanvasView } from '@dn/engine-dom';
import { isIconName, type FormatCommand, type IconName, type TextEditor } from '@dn/text-pm';
import { boxKind, captionKind, convertRich, GROUP_KIND_LABEL, groupName, groupOf, isDividerContent, isImageContent, isTableContent, setTableHead, tableHeadOn, tableToChart, buttonFromBlocks, diagramToMermaid, insertMermaid, mermaidOfBlock } from '@dn/engine-core';
import { COLOR_LABEL, EditRow, TextStyleMenu } from './TextStyleMenu';
import { GroupMetaRows, NodeKindRow } from './MeaningMenu';
import { SubMenu } from './SubMenu';
import { DividerRows } from './CardMenu';
import { Icon } from './Icon';

const TYPES: { cmd: FormatCommand; label: string; icon: string | IconName }[] = [
  { cmd: 'paragraph', label: '텍스트', icon: 'T' },
  { cmd: 'h1', label: '제목 1', icon: 'H1' },
  { cmd: 'h2', label: '제목 2', icon: 'H2' },
  { cmd: 'h3', label: '제목 3', icon: 'H3' },
  { cmd: 'h4', label: '제목 4', icon: 'H4' },
  { cmd: 'bullet', label: '글머리 기호 목록', icon: 'list' },
  { cmd: 'ordered', label: '번호 목록', icon: 'listOrdered' },
  { cmd: 'task', label: '할 일 목록', icon: 'checkSquare' },
  { cmd: 'quote', label: '인용', icon: 'quote' },
  { cmd: 'toggle', label: '토글', icon: 'toggle' },
  { cmd: 'callout', label: '콜아웃', icon: 'bulb' },
];

const BRACKET_NAME = { brace: '중괄호', none: '테두리 없음', card: '카드' } as const;
/** '묶음 ▸' 줄 오른쪽의 지금 값 — 종류 · 기본(상자)이 아닌 테두리 */
function groupHint(view: CanvasView, gid: string): string | undefined {
  const m = view.engine.note.groups?.[gid];
  const kind = m?.kind ? GROUP_KIND_LABEL[m.kind as keyof typeof GROUP_KIND_LABEL] ?? m.kind : '';
  const bracket = m?.bracket && m.bracket !== 'box' ? BRACKET_NAME[m.bracket] : '';
  return [kind, bracket].filter(Boolean).join(' · ') || undefined;
}

export function BlockMenu({ req, view, noteId, onClose, onToast, onStructure, onTidy, onRestructure, onMove, onTranscribe, onSnippet, docEditor }: {
  req: BlockMenuRequest; view: CanvasView; noteId: string; onClose: () => void; onToast: (t: string) => void; onStructure: (id: string) => void;
  /** 배치 다듬기 — 고른 상자들의 줄 · 간격 · 폭 (서브 구조화) */
  onTidy?: (ids: string[]) => void;
  /** 녹음 블록 → 글로 받아쓰기 (FR-044) */
  onTranscribe?: (id: string, lang: SttLang) => void;
  /** AI로 다시 구조화 — 고른 AI 상자들이 나온 원문 구간만 다시 (FR-110) */
  onRestructure?: (ids: string[]) => void;
  /** 다른 노트로 옮기기 창 (GAP #16) */
  onMove?: (ids: string[]) => void;
  /** 내 블록으로 저장 — 넣기(＋) 메뉴에서 같은 사본을 다시 넣게 */
  onSnippet?: (ids: string[]) => void;
  /** 문서 뷰에서 지금 고치는 글 (글 편집 중 오른쪽 클릭 — 고른 글자 서식 · 붙여넣기 · 닫은 뒤 초점) */
  docEditor?: () => TextEditor | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const docEd = req.doc && req.editing ? docEditor?.() ?? undefined : undefined;
  // 문서 뷰에서 열었으면 닫은 뒤 초점을 문서로(고치던 글이면 그 글로) — 숨은 캔버스가 키를 받지 않게, 자리도 문서 항목에서
  const refocus = () => (docEd?.view.dom.isConnected ? docEd.focus() : req.doc ? document.querySelector<HTMLElement>('.dn-doc')?.focus({ preventScroll: true }) : view.root.focus({ preventScroll: true }));
  const rectOf = (id: string) => {
    const doc = document.querySelector(`.dn-doc .dn-doc-item[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect(), cv = view.mounted.get(id)?.el.getBoundingClientRect();
    return req.doc ? doc ?? cv : cv?.width ? cv : doc;
  };
  const [pos, setPos] = useState({ x: req.x, y: req.y });
  const n = req.ids.length;
  const kinds = req.ids.map((id) => boxKind(view.engine.contentsOf(id)));
  const one = n === 1 ? view.engine.contentsOf(req.ids[0]!) : [];
  const chart = one.find((c) => c.type === 'chart'), image = one.find(isImageContent), table = one.find(isTableContent), divider = one.find(isDividerContent);
  const mermaid = n === 1 ? mermaidOfBlock(view.engine, req.ids[0]!) : null; // 머메이드 순서도 코드가 든 상자 (GAP #18)
  const textBlocks = req.ids.filter((id) => view.engine.contentsOf(id).some((c) => c.type === 'text'));
  const aiOnly = req.ids.every((id) => !!view.engine.getBlock(id)?.ai); // 고른 것이 모두 AI가 만든 상자 — 'AI로 다시 구조화'
  const src = n === 1 ? sourceBlockOf(view, req.ids[0]!) : null; // 이 상자가 나온 원문 상자 — AI 상자 · 원문에서 꺼낸 상자 (FR-111)
  // 글을 골라 둔 채 연 메뉴 — 고른 글자 서식이 목적이니 '글자 모양'을 펼쳐 둔다
  const selEd = req.editing ? docEd ?? view.mounted.get(req.ids[0]!)?.editor : undefined;
  const [sub, setSub] = useState<string | null>(() => (textBlocks.length && selEd && !selEd.view.state.selection.empty ? 'style' : null));
  const [, redraw] = useState(0);

  // 화면 밖으로 넘치면 안쪽으로 당긴다
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 아래가 모자라 위로 올리면 블록을 덮는다 — 그럴 때는 ⋮⋮(블록 왼쪽) 더 왼쪽에 (CQ-018). 왼쪽이 사이드바면 덮지 않고
    // 누른 자리 오른쪽에서 화면 안까지만 올린다 (AT-015)
    const up = r.bottom > innerHeight - 8, left = req.x - r.width - 12;
    const minX = (document.querySelector('.main')?.getBoundingClientRect().left ?? 0) + 8;
    const side = up && left >= minX;
    setPos({ x: side ? left : Math.min(req.x, innerWidth - r.width - 8), y: !up ? req.y : side ? Math.max(8, req.y - r.height - 36) : Math.max(8, innerHeight - r.height - 8) });
  }, [req]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
      // 글 편집 중에 연 메뉴면 편집기로 (캔버스에 초점을 주면 편집이 끝난다, CQ-013)
      const ed = req.editing ? docEd ?? view.mounted.get(req.ids[0]!)?.editor : undefined;
      if (ed) ed.focus(); else refocus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [onClose, view]);

  const act = (fn: () => void) => () => { fn(); onClose(); refocus(); };
  // 블록(콘텐츠 묶음): 고른 것이 묶음 하나 전체면 그 묶음, 묶음에 든 상자가 있으면 풀기
  const sg = selectedGroup(view);
  const whole = sg ? { ...sg, name: groupName(view.engine, sg.id, sg.ids) } : null;
  const inGroup = req.ids.some((id) => !!groupOf(view.engine, id));

  const copyLink = async () => {
    const url = `${location.origin}${location.pathname}#n=${noteId}&b=${req.ids[0]}`;
    try { await navigator.clipboard.writeText(url); onToast('블록 링크를 복사했어요. 다른 노트 캔버스에 붙여넣으면 그 블록이 임베드돼요.'); }
    catch { onToast('링크를 복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.'); }
  };
  const subProps = { open: sub, setOpen: setSub };

  return (
    <div ref={ref} className={`menu${req.editing ? ' dn-editor-pop' : ''}`} role="menu" aria-label="블록 메뉴" style={{ left: pos.x, top: pos.y }}
      // 하위 메뉴가 아닌 줄로 옮기면 열린 하위 메뉴를 닫는다
      onMouseOver={(e) => { if (sub && !(e.target as Element).closest('.menu-sub')) setSub(null); }}
      onMouseDown={req.editing ? (e) => { if (!(e.target as Element).closest('input')) e.preventDefault(); } : undefined /* 글 편집 중이면 에디터 초점 · 선택을 그대로 — 숫자 칸만 초점을 받는다(편집은 이어짐, dn-editor-pop) */}>
      {n > 1 && <div className="menu-head">{whole ? `블록 · ${whole.name}` : `상자 ${n}개`}</div>}
      {n === 1 && <div className="menu-head menu-head-one" title={blockLabel(view, req.ids[0]!, false)}>{blockLabel(view, req.ids[0]!, false)}</div>/* 무엇의 메뉴인지 (AT-015) */}
      {n > 1 && !whole && <button role="menuitem" onClick={act(() => groupSelection(view))}><span>블록으로 묶기</span><kbd>Ctrl+G</kbd></button>}
      {n > 1 && onTidy && !view.readOnly && !req.doc && <button role="menuitem" title="고른 상자들의 차례는 그대로 두고 줄 · 간격 · 폭을 고르게" onClick={act(() => onTidy([...req.ids]))}><span>배치 다듬기</span></button>}
      {inGroup && <button role="menuitem" onClick={act(() => ungroupSelection(view))}><span>묶음 풀기</span><kbd>Ctrl+Shift+G</kbd></button>}
      {onSnippet && !req.editing && <button role="menuitem" title="넣기(＋) 메뉴의 '내 블록'에 이름을 붙여 저장 — 누를 때마다 같은 블록이 새로 들어가요" onClick={act(() => onSnippet([...req.ids]))}><span>내 블록으로 저장…</span></button>}
      {divider && !view.readOnly && <DividerRows key={divider.id} view={view} c={divider} />}
      {req.editing && <EditRow view={view} id={req.ids[0]!} onClose={onClose} onToast={onToast} {...(docEd ? { target: () => docEd.view.dom } : {})} />}
      {/* 그 상자에만 있는 것 */}
      {chart && view.host.onEditContent && <button role="menuitem" onClick={() => { onClose(); view.host.onEditContent?.(req.ids[0]!, chart.id); }}><span>그래프 데이터 고치기</span><kbd>두 번 클릭</kbd></button>}
      {chart && view.host.onEditContent && <button role="menuitem" onClick={() => { onClose(); view.host.onEditContent?.(req.ids[0]!, chart.id, 'style'); }}><span>그래프 모양 (색 · 보기)</span></button>}
      {/* 그래프 ↔ 표 (FR-110): 같은 수치를 다른 모양으로 — AI에 다시 묻지 않는다 */}
      {chart && !view.readOnly && <button role="menuitem" onClick={act(() => { const r = convertRich(view.engine, req.ids[0]!, 'table'); if (!r.ok) onToast(r.reason); })}><span>표로 바꾸기</span></button>}
      {table && !view.readOnly && tableToChart(table) && <button role="menuitem" onClick={act(() => { const r = convertRich(view.engine, req.ids[0]!, 'chart'); if (!r.ok) onToast(r.reason); })}><span>그래프로 바꾸기</span></button>}
      {n === 1 && captionKind(view.engine, req.ids[0]!) && <button role="menuitem" onClick={() => { const id = req.ids[0]!, r = rectOf(id); onClose(); if (r) editCaption(view.engine, id, { left: r.left, top: r.bottom + 4, width: r.width }); }}><span>{view.engine.getBlock(req.ids[0]!)?.caption ? '캡션 고치기' : '캡션 달기'}</span></button>}
      {image && <button role="menuitem" onClick={() => { const id = req.ids[0]!, r = rectOf(id); onClose(); if (r) editImageAlt(view.engine, id, { left: r.left, top: r.bottom + 4, width: r.width }); }}><span>{image.alt ? '대체 텍스트 고치기' : '대체 텍스트 달기'}</span></button>}
      {n === 1 && onTranscribe && !view.readOnly && hasAudio(view.engine, req.ids[0]!) && (
        <SubMenu id="stt" label="글로 받아쓰기" hint="이 기기 안에서 — 녹음은 밖으로 나가지 않아요" {...subProps}>
          {STT_LANGS.map((l) => <button key={l.id} role="menuitem" onClick={act(() => onTranscribe(req.ids[0]!, l.id))}><span>{l.label}</span></button>)}
        </SubMenu>
      )}
      {table && (
        <SubMenu id="table" label="표" {...subProps}>
          {(['row', 'col'] as const).map((w) => (
            <button key={w} role="menuitemcheckbox" aria-checked={tableHeadOn(table, w)} onClick={act(() => setTableHead(view.engine, table.id, w, !tableHeadOn(table, w)))}>
              <span>{w === 'row' ? '머리 행 (열 이름 줄)' : '머리 열 (첫 열)'}</span><kbd>{tableHeadOn(table, w) ? '켬' : '끔'}</kbd>
            </button>))}
        </SubMenu>
      )}
      {mermaid && !view.readOnly && <button role="menuitem" title="이 상자의 flowchart 글을 바로 아래에 상자 · 화살표로" onClick={act(() => { const r = insertMermaid(view.engine, req.ids[0]!, mermaid, (nd) => ({ w: Math.max(120, Math.min(260, 40 + [...nd.label.split('\n')[0]!].length * 13)), h: Math.max(44, view.measureText({ type: 'doc', content: nd.label.split('\n').map((t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })) }, 200) ?? 44) })); if (r.ok) view.select(r.value); else onToast(r.reason); })}><span>Mermaid → 캔버스 도식</span></button>}
      {hasBoundInk(view, req.ids) && <button role="menuitem" onClick={act(() => unbindBlockInk(view, req.ids))}><span>손글씨 풀기</span><kbd>Ctrl+Shift+G</kbd></button>}
      {/* 여느 상자 동작 */}
      <button role="menuitem" onClick={act(() => view.duplicateSelection())}><span>복제</span><kbd>Ctrl+D</kbd></button>
      {n === 1 && <button role="menuitem" onClick={act(() => void copyLink())}><span>블록 링크 복사</span></button>}
      {/* 원문 출처 (FR-111): 이 상자(AI 상자 · 원문에서 꺼낸 상자)가 나온 원문 상자로 화면을 옮긴다 — 이 상자는 고른 채라 원문에 그 구절이 강조된다 */}
      {src && !req.doc && <button role="menuitem" onClick={() => { onClose(); const r = view.engine.blockRect(src); if (r) view.revealRect(r); view.root.focus({ preventScroll: true }); }}><span>원문에서 보기</span></button>}
      {onMove && !view.readOnly && <button role="menuitem" onClick={() => { onClose(); onMove([...req.ids]); }}><span>다른 노트로 옮기기…</span></button>}
      {n === 1 && view.host.onComments && <button role="menuitem" onClick={() => { onClose(); const r = rectOf(req.ids[0]!); view.host.onComments?.({ blockId: req.ids[0]!, x: r ? r.right + 12 : req.x, y: r ? r.top : req.y }); }}><span>댓글 달기</span><kbd>Ctrl+Alt+M</kbd></button>}
      {!view.readOnly && !req.doc && <button role="menuitem" title="누르면 이 상자들(사이 화살표째)을 버튼 아래에 새로 넣는 버튼" onClick={act(() => { const r = buttonFromBlocks(view.engine, req.ids); if (r.ok) view.select([r.value]); })}><span>이 상자들로 버튼 만들기</span></button>}
      {n > 1 && <button role="menuitem" title="고른 상자 · 사이 화살표를 Mermaid 순서도 글로 — 다른 앱 · AI에 붙여넣기" onClick={act(() => void navigator.clipboard.writeText(diagramToMermaid(view.engine, req.ids)).then(() => onToast('Mermaid 순서도 글로 복사했어요.'), () => onToast('클립보드에 쓰지 못했어요.')))}><span>Mermaid 글로 복사</span></button>}
      <div className="menu-sep" />
      {/* 바꾸기 · 꾸미기 — 하위 메뉴. 묶음 전체를 골랐으면 맨 앞에 '묶음' (종류 · 테두리 · 문서에서) */}
      {whole && (
        <SubMenu id="group" label="묶음" hint={groupHint(view, whole.id)} {...subProps}>
          <GroupMetaRows view={view} gid={whole.id} onDone={onClose} onChange={() => redraw((k) => k + 1)} />
        </SubMenu>
      )}
      <SubMenu id="turn" label="바꾸기" hint={kinds.every((k) => k === 'title') ? '제목 상자' : kinds.every((k) => k === 'text') ? '내용 상자' : undefined} {...subProps}>
        <div className="menu-head">상자 종류</div>
        <div className="menu-types">
          <button role="menuitem" className={kinds.every((k) => k === 'title') ? 'on' : ''} onClick={act(() => view.convertSelection('title'))}>
            <span className="ti">T</span><span>제목 상자</span>
          </button>
          <button role="menuitem" className={kinds.every((k) => k === 'text') ? 'on' : ''} onClick={act(() => view.convertSelection('text'))}>
            <span className="ti">¶</span><span>내용 상자</span>
          </button>
        </div>
        {kinds.some((k) => k === 'text') && <>
          <div className="menu-sep" />
          <div className="menu-head">내용 서식</div>
          <div className="menu-types">
            {TYPES.map((t) => (
              <button key={t.cmd} role="menuitem" title={t.label} onClick={act(() => view.formatSelection(t.cmd))}>
                <span className="ti">{isIconName(t.icon) ? <Icon name={t.icon} size={14} /> : t.icon}</span><span>{t.label}</span>
              </button>
            ))}
          </div>
        </>}
      </SubMenu>
      {textBlocks.length > 0 && (
        <SubMenu id="style" label="글자 모양" {...subProps}>
          <TextStyleMenu view={view} ids={textBlocks} {...(docEd ? { editor: docEd } : {})} />
        </SubMenu>
      )}
      <SubMenu id="bg" label="배경색" {...subProps}>
        <div className="swatches">
          <button role="menuitem" className="sw none" title="기본" aria-label="기본 배경" onClick={act(() => view.setSelectionColor(undefined))} />
          {Object.entries(BLOCK_COLORS).map(([k, c]) => (
            <button key={k} role="menuitem" className="sw" title={COLOR_LABEL[k]} aria-label={`${COLOR_LABEL[k]} 배경`}
              style={{ background: c }} onClick={act(() => view.setSelectionColor(k))} />
          ))}
        </div>
      </SubMenu>
      <SubMenu id="mean" label="의미" {...subProps}>
        <NodeKindRow view={view} ids={req.ids} />
      </SubMenu>
      {aiOnly && onRestructure && !view.readOnly ? <>
        <div className="menu-sep" />
        <button role="menuitem" className="ai-item" title="이 상자들이 나온 원문 구간만 다시 보내 이 자리에서 바꿔요 (실행 취소 한 번이면 이전 결과)" onClick={act(() => onRestructure([...req.ids]))}><span><Icon name="sparkle" size={14} /> AI로 다시 구조화</span></button>
      </> : n === 1 && <>
        <div className="menu-sep" />
        <button role="menuitem" className="ai-item" onClick={act(() => onStructure(req.ids[0]!))}><span><Icon name="sparkle" size={14} /> AI로 구조화</span><kbd>Ctrl+Alt+S</kbd></button>
      </>}
      <div className="menu-sep" />
      <button role="menuitem" className="danger-item" onClick={act(() => view.deleteSelection())}><span>삭제</span><kbd>Del</kbd></button>
    </div>
  );
}
