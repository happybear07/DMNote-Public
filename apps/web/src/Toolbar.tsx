// 아래 도구 막대: 넣기(＋) · 선택(두 번 누르면 필기만 · 필기 뺀 콘텐츠 · 둘 다) · 글 상자(두 번 누르면 제목 · 내용) ·
// 화살표(두 번 누르면 새 화살표 모양 — 파선 · 점선 · 물결 · 한 번 감김 · 용수철 · 곡선 · 꺾은선) · 펜 ·
// 형광펜 · 지우개 · 이동 · 고정한 항목(넣기 메뉴에서 📌 — 사진 · 표 · 수식 …, 오른쪽 클릭으로 빼기) · 실행 취소 · 다시 실행.
import { useEffect, useState, type ReactNode } from 'react';
import { insertBlock, isInsertKind, type CanvasUiState, type CanvasView, type Tool } from '@dn/engine-dom';
import { ARROW_PRESETS, type ArrowPreset } from './arrow-icons';
import { Icon } from './Icon';
import { loadInkPrefs, saveInkPrefs } from './ink-prefs';
import { SNIPPET_PIN } from './snippets';
import { INSERT_ITEMS } from './InsertMenu';
import { saveChoice, savedChoice, svg, ToolChoice, type Choice } from './ToolChoice';
import type { Workspace, WorkspaceState } from './workspace';

type SelectTool = 'select' | 'lasso' | 'both';
const SELECT_MODES: readonly Choice<SelectTool>[] = [
  { value: 'select', label: '필기 뺀 콘텐츠 선택', hint: '상자 · 사진 · 표 … (V)', icon: <path d="M5 3l12 7-5 1.5L9.5 17z" /> },
  { value: 'lasso', label: '필기만 선택', hint: '펜 · 형광펜 획만 둘러 고르기 (L)', icon: <path d="M10 13c4 0 7-1.8 7-4.5S14 4 10 4 3 5.8 3 8.5c0 1.4.9 2.6 2.3 3.4M5.3 11.9C4.5 13 5 15 6.5 15.5c1 .3 1.5-.6 1-1.5" /> },
  { value: 'both', label: '둘 다 선택', hint: '상자와 필기를 함께 고르고 옮기기', icon: <><path d="M4 3l9 5.2-3.9 1.2L7.3 13z" /><path d="M12.5 17c2.8 0 5-1.3 5-3.1s-2.2-3.1-5-3.1-5 1.3-5 3.1c0 .9.6 1.7 1.6 2.3" /></> },
];
type TextTool = 'block' | 'title';
const TEXT_MODES: readonly Choice<TextTool>[] = [
  { value: 'block', label: '내용 상자', hint: '글을 쓰는 상자 (B)', icon: <><rect x="3.5" y="4" width="13" height="12" rx="2" /><path d="M6.5 8h7M6.5 11h5" /></> },
  { value: 'title', label: '제목 상자', hint: '한 줄 제목 (T)', icon: <path d="M4 5h12M10 5v11" /> },
];
const TOOLS: { tool: Tool; label: string; key: string; icon: ReactNode }[] = [
  { tool: 'pen', label: '펜', key: 'P', icon: <path d="M4 16l2.5-.5L15.5 6.5a1.4 1.4 0 00-2-2L4.5 13.5zM12 6l2 2" /> },
  { tool: 'highlighter', label: '형광펜', key: 'M', icon: <path d="M6 14l-2 3h4l1-1.5M6 14l6.5-9.5 3 2L9 16zM11 6l3 2" /> },
  { tool: 'eraser', label: '지우개', key: 'E', icon: <path d="M8.5 16H16M4.5 12.5l6.5-7 5 4.5-6 6.5H7.5z" /> },
  { tool: 'hand', label: '이동', key: 'H', icon: <path d="M7 10V5.5a1.25 1.25 0 012.5 0V9m0-3.5v-1a1.25 1.25 0 012.5 0V9m0-3a1.25 1.25 0 012.5 0v5.5a5 5 0 01-5 5h-.5a5 5 0 01-4.2-2.3L3.6 11a1.2 1.2 0 012-1.3L7 11.5" /> },
];
const isSelect = (t: Tool): t is SelectTool => t === 'select' || t === 'lasso' || t === 'both';
const isText = (t: Tool): t is TextTool => t === 'block' || t === 'title';

export function Toolbar({ ws, s, view, ui, onInkSettings }: { ws: Workspace; s: WorkspaceState; view: CanvasView; ui: CanvasUiState; onInkSettings?: () => void }) {
  // 메뉴에서 고른 종류를 기억한다 — 선택은 다른 도구를 쓰다 돌아올 때 · Esc · 상자를 만든 뒤(엔진 homeTool) 그 방식으로,
  // 글 상자는 단추를 누를 때 그 종류로. 단축키(V · L · T · B)는 기억을 바꾸지 않는다
  const [mode, setMode] = useState<SelectTool>(() => savedChoice('dn:selectMode', SELECT_MODES.map((m) => m.value)));
  const [textMode, setTextMode] = useState<TextTool>(() => savedChoice('dn:textMode', TEXT_MODES.map((m) => m.value)));
  const [arrowPreset, setArrowPreset] = useState<ArrowPreset>(() => savedChoice('dn:arrowPreset', ARROW_PRESETS.map((m) => m.value)));
  useEffect(() => { view.homeTool = mode; }, [view, mode]);
  useEffect(() => { view.arrowStyle = ARROW_PRESETS.find((p) => p.value === arrowPreset)?.style; }, [view, arrowPreset]);
  // 펜 · 형광펜 설정(색 줄 · 굵기 · 종류)은 이 기기에 기억 — 노트를 바꿔도 그대로. 저장은 지금 값(view.ink)으로
  useEffect(() => { loadInkPrefs(view); }, [view]);
  const { color, hlColor, colors, hlColors, width, hlWidth, pen, hl, penOnly } = ui.ink;
  const inkKey = JSON.stringify([color, hlColor, colors, hlColors, width, hlWidth, pen, hl, penOnly]);
  useEffect(() => { saveInkPrefs(view.ink); }, [view, inkKey]);
  const use = (t: Tool) => { view.setTool(t); view.root.focus(); };

  const pins = s.toolbarPins.filter(isInsertKind);
  const snipPins = s.toolbarPins.flatMap((k) => (k.startsWith(SNIPPET_PIN) ? s.snippets.filter((x) => SNIPPET_PIN + x.id === k) : []));
  return (
    <div className="toolbar" role="toolbar" aria-label="도구">
      {/* 넣기: 사진 · 표 · 그래프 · 수식 … (캔버스에서 / · 빈 곳 오른쪽 클릭도) */}
      <button className={`insert-btn${s.insertMenu ? ' on' : ''}`} title="넣기 — 사진 · 표 · 그래프 · 수식 … (/) · 자주 쓰는 것은 핀으로 여기에 고정" aria-label="넣기" aria-haspopup="dialog" aria-expanded={!!s.insertMenu}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (s.insertMenu) ws.closeInsertMenu(); else ws.openInsertMenu({ x: r.left, y: r.top - 8 }); }}>
        <Icon name="plus" size={20} />
      </button>
      <span className="sep" />
      <ToolChoice<SelectTool> choices={SELECT_MODES} shown={isSelect(ui.tool) ? ui.tool : mode} active={isSelect(ui.tool)} cls="select" name="선택" menuLabel="선택 방식"
        onUse={use} onPick={(t) => { setMode(t); saveChoice('dn:selectMode', t); use(t); }} />
      <ToolChoice<TextTool> choices={TEXT_MODES} shown={isText(ui.tool) ? ui.tool : textMode} active={isText(ui.tool)} cls="text" name="글 상자" menuLabel="글 상자 종류"
        onUse={use} onPick={(t) => { setTextMode(t); saveChoice('dn:textMode', t); use(t); }} />
      <ToolChoice<ArrowPreset> choices={ARROW_PRESETS} shown={arrowPreset} active={ui.tool === 'arrow'} cls="arrow" name="화살표" menuLabel="새 화살표 모양"
        onUse={() => use('arrow')} onPick={(p) => { setArrowPreset(p); saveChoice('dn:arrowPreset', p); use('arrow'); }} />
      {TOOLS.map((t) => (
        <button key={t.tool} className={ui.tool === t.tool ? 'on' : ''} aria-label={t.label}
          title={t.tool === 'pen' || t.tool === 'highlighter' ? `${t.label} (${t.key}) — 두 번 눌러 종류 · 굵기` : `${t.label} (${t.key})`}
          onClick={() => use(t.tool)} onDoubleClick={t.tool === 'pen' || t.tool === 'highlighter' ? () => { use(t.tool); onInkSettings?.(); } : undefined}>
          {svg(t.icon)}
        </button>
      ))}
      {pins.length + snipPins.length > 0 && <span className="sep" />}
      {pins.map((k) => {
        const it = INSERT_ITEMS.find((x) => x.kind === k);
        if (!it) return null;
        return (
          <button key={k} className="pinned" title={`${it.label} 넣기 — 오른쪽 클릭으로 고정 풀기`} aria-label={`${it.label} 넣기`}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); insertBlock(view, k, { anchor: { x: r.left, y: r.bottom + 6 } }); }} onContextMenu={(e) => { e.preventDefault(); ws.togglePin(k); }}>
            <Icon name={it.icon} size={20} />
          </button>
        );
      })}
      {/* 고정한 내 블록 — 누르면 화면 가운데 빈 자리에 사본, 오른쪽 클릭으로 고정 풀기 */}
      {snipPins.map((sn) => (
        <button key={sn.id} className="pinned" title={`내 블록 '${sn.name}' 넣기 — 오른쪽 클릭으로 고정 풀기`} aria-label={`내 블록 ${sn.name} 넣기`}
          onClick={() => ws.useSnippet(sn.id)} onContextMenu={(e) => { e.preventDefault(); ws.togglePin(SNIPPET_PIN + sn.id); }}>
          <Icon name="block" size={20} />
        </button>
      ))}
      <span className="sep" />
      <button title="실행 취소 (Ctrl+Z)" aria-label="실행 취소" disabled={!ui.canUndo} onClick={() => view.undo()}>
        {svg(<path d="M7 5L3.5 8.5 7 12M4 8.5h8a4.5 4.5 0 010 9H9" />)}
      </button>
      <button title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행" disabled={!ui.canRedo} onClick={() => view.redo()}>
        {svg(<path d="M13 5l3.5 3.5L13 12M16 8.5H8a4.5 4.5 0 000 9h3" />)}
      </button>
    </div>
  );
}
