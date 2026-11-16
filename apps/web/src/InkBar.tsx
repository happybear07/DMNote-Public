// 필기 도구 막대 (FR-034 · 035 · 036 · 040): 잉크 도구일 때 도구 막대 위에 — 색 줄(기본 3 + ＋로 더한 색 3까지) · 펜 설정(굵기 단추 →
// 종류 · 굵기 창) · 보이기 · 펜 전용 · 고른 획 색 바꾸기/지우기 · (지우개) 필기 모두 · 모두 지우기. 선택 도구 '둘 다'로 필기를 골랐을 때도 고른 획 색 · 묶기 · 지우기.
// 배경(점 · 괘선 · 모눈 · 간격)은 필기 막대가 아니라 노트 설정 판에서 고른다.
import { useEffect, useState } from 'react';
import type { CanvasUiState, CanvasView } from '@dn/engine-dom';
import { bindSelectedInk, deleteSelectedInk, EXTRA_COLORS, HIGHLIGHT_COLORS, HL_SUGGEST, INK_COLORS, INK_SUGGEST, inkTone, recolorSelectedInk, setInkStyle, setInkVisibility } from '@dn/engine-dom';
import { ChartColorPop } from './ChartColorPop';
import { HL_LABEL, PEN_LABEL, PenSettings } from './PenSettings';
import { InkClear } from './InkClear';
import { svg } from './ToolChoice';

const INK_ICON = <path d="M3 13.5c1.5-3.5 3-5 4.5-3.5s1 4 2.5 4 2-4.5 3.5-4.5 1.5 3 3.5 2.5" />;
const BOX_ICON = <rect x="3.5" y="5" width="13" height="10" rx="2" />;
const PEN_ONLY_ICON = <><path d="M10 2.5v10M7.5 12.5h5L10 17z" /><path d="M7.5 6h5" /></>;
const SLASH = <path d="M3.5 16.5l13-13" />;

export function InkBar({ view, ui, settings, onSettings, onOcr, onStructure, onToast }: {
  view: CanvasView; ui: CanvasUiState;
  /** 펜 · 형광펜 설정 창 (App이 연다 — 도구 막대에서 펜을 두 번 눌러도) */
  settings: boolean; onSettings: (open: boolean) => void;
  onOcr?: () => void; onStructure?: () => void;
  /** 지우개 '지우기' 뒤 알림 (실행 취소 단추 달림) */
  onToast?: (text: string) => void;
}) {
  const hl = ui.tool === 'highlighter';
  const penTool = ui.tool === 'pen' || hl;
  const ink = ui.ink;
  const base = hl ? HIGHLIGHT_COLORS : INK_COLORS;
  const row = hl ? ink.hlColors : ink.colors;
  const current = hl ? ink.hlColor : ink.color;
  const picking = ui.tool === 'lasso' || ui.tool === 'both'; // 고른 필기를 다루는 도구
  const showColors = penTool || (picking && ink.selected > 0);
  const [add, setAdd] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { if (!penTool && settings) onSettings(false); }, [penTool, settings, onSettings]);
  const apply = (c: string) => { if (picking) recolorSelectedInk(view, c); else setInkStyle(view, hl ? { hlColor: c } : { color: c }); view.root.focus(); };
  const setRow = (next: string[]) => setInkStyle(view, hl ? { hlColors: next } : { colors: next });
  const addColor = (c: string) => { if (!row.includes(c)) setRow([...row, c].slice(0, base.length + EXTRA_COLORS)); apply(c); };
  const removeColor = (c: string) => {
    setRow(row.filter((x) => x !== c));
    if (c === current) setInkStyle(view, hl ? { hlColor: base[0]! } : { color: base[0]! });
  };
  const width = hl ? ink.hlWidth : ink.width;
  const erasing = ui.tool === 'eraser';
  const penOnly = (
    <button className={`ink-icon${ink.penOnly ? ' on' : ''}`} aria-pressed={ink.penOnly} aria-label="펜 전용"
      title={ink.penOnly ? '펜 전용 켜짐 — 손가락은 화면 이동' : '펜으로만 필기 — 손가락은 화면 이동'} onClick={() => setInkVisibility(view, { penOnly: !ink.penOnly })}>
      {svg(PEN_ONLY_ICON)}
    </button>
  );
  return (
    <div className="ink-bar" role="toolbar" aria-label="필기 설정">
      {showColors && (
        <span className="ink-group">
          <span className="ink-swatches" role="radiogroup" aria-label="색">
            {row.map((c, i) => {
              const extra = i >= base.length;
              // 검정 · 흰 펜은 바탕 따라 밝게 · 어둡게 보인다 (AT-021) — 반반으로 그려 알린다
              const tone = hl ? null : inkTone(c);
              const auto = tone === 'k' ? ' — 어두운 바탕에서는 밝게 보여요' : tone === 'w' ? ' — 밝은 바탕에서는 어둡게 보여요' : '';
              return (
                <button key={c} role="radio" aria-checked={c === current} aria-label={`색 ${i + 1}`} title={`색 ${i + 1} (${i + 1})${auto}${extra ? ' — 오른쪽 클릭으로 빼기' : ''}`}
                  className={`ink-swatch${c === current && !picking ? ' on' : ''}`} style={{ background: tone ? `linear-gradient(135deg, ${c} 50%, ${tone === 'k' ? '#e6e6e3' : '#37352f'} 50%)` : c }}
                  onClick={() => apply(c)} onContextMenu={extra ? (e) => { e.preventDefault(); removeColor(c); } : undefined} />
              );
            })}
          </span>
          {row.length < base.length + EXTRA_COLORS && (
            <button className="ink-add" aria-label="색 더하기" title={`색 더하기 — 추천 색 · 팔레트 (${EXTRA_COLORS}개까지)`} aria-haspopup="dialog" aria-expanded={!!add}
              onClick={(e) => { const bar = e.currentTarget.closest('.ink-bar')!.getBoundingClientRect(); setAdd(add ? null : { x: e.currentTarget.getBoundingClientRect().left - 12, y: bar.top - 8 }); }}>
              {svg(<path d="M10 4.5v11M4.5 10h11" />)}
            </button>
          )}
        </span>
      )}
      {add && showColors && <ChartColorPop at={add} place="above" paletteButton title="추천 색상" label={hl ? '형광펜 색 더하기' : '펜 색 더하기'} value={undefined} current={current}
        palette={(hl ? HL_SUGGEST : INK_SUGGEST).filter((c) => !row.includes(c))} onPick={(c) => { if (c) addColor(c); }} onClose={() => setAdd(null)} />}
      {penTool && (
        <span className="ink-group">
          <button className={`ink-pen-btn${settings ? ' on' : ''}`} aria-label={hl ? '형광펜 설정' : '펜 설정'} aria-haspopup="dialog" aria-expanded={settings}
            title={`${hl ? HL_LABEL[ink.hl] : PEN_LABEL[ink.pen]} · 굵기 ${width}px — 눌러서 종류 · 굵기 바꾸기 ([ ])`} onClick={() => onSettings(!settings)}>
            <i style={{ width: Math.min(16, 3 + width * (hl ? 0.4 : 1)), height: Math.min(16, 3 + width * (hl ? 0.4 : 1)), background: current }} />
            <span>{width}</span>
          </button>
        </span>
      )}
      {settings && penTool && <PenSettings view={view} ui={ui} onClose={() => onSettings(false)} />}
      {picking && ink.selected > 0 && (
        <span className="ink-group"><span className="ink-count">{ink.selected}획</span>
          {onOcr && <button className="ink-text" title="고른 손글씨를 AI로 읽어 글 상자로 (미리보기에서 고친 뒤 바꾸기)" onClick={onOcr}>글로 바꾸기</button>}
          {onStructure && <button className="ink-text" title="고른 손글씨를 읽어 관계 · 수치 · 비교를 블록 · 화살표 · 그래프 · 표로 (필기는 그대로, 잘 안 읽히면 미리보기에서 고친 뒤)" onClick={onStructure}>AI로 구조화</button>}
          <button className="ink-text" title="고른 잉크를 블록에 담아 함께 움직이고 문서 · 내보내기에 넣기 (Ctrl+G)" onClick={() => { bindSelectedInk(view); view.root.focus(); }}>블록으로 묶기</button>
          <button className="ink-text danger" title={ui.tool === 'both' ? '고른 필기만 지우기 — 상자까지 지우려면 Delete' : undefined} onClick={() => deleteSelectedInk(view)}>{ui.tool === 'both' ? '필기 지우기' : '지우기'}</button></span>
      )}
      {ui.tool === 'lasso' && !ink.selected && <span className="ink-hint">필기를 둘러 고르면 옮기거나 색을 바꿀 수 있어요</span>}
      {/* 보이기 전환은 아이콘 — 숨기면 같은 아이콘에 사선 · 흐리게, 펜 전용은 켜면 강조.
          지우개일 때는 '숨기기' · '지우기'(InkClear) 이름을 위에 달아 나눈다 (알파 10/31) */}
      <span className={`ink-group${erasing ? ' ink-labeled' : ''}`}>
        {erasing && <span className="ink-cap">숨기기</span>}
        <span className="ink-row">
          <button className={`ink-icon${ink.show ? '' : ' off'}`} aria-pressed={ink.show} aria-label="잉크 보이기"
            title={ink.show ? '잉크 숨기기 (Ctrl+Alt+H)' : '잉크 숨김 — 눌러서 보이기 (Ctrl+Alt+H)'} onClick={() => setInkVisibility(view, { ink: !ink.show })}>
            {svg(<>{INK_ICON}{!ink.show && SLASH}</>)}
          </button>
          <button className={`ink-icon${ink.showBlocks ? '' : ' off'}`} aria-pressed={ink.showBlocks} aria-label="상자 보이기"
            title={ink.showBlocks ? '상자 숨기기 — 잉크만 보기' : '상자 숨김 — 눌러서 보이기'} onClick={() => setInkVisibility(view, { blocks: !ink.showBlocks })}>
            {svg(<>{BOX_ICON}{!ink.showBlocks && SLASH}</>)}
          </button>
          {!erasing && penOnly}
        </span>
      </span>
      {erasing && <InkClear view={view} onDone={onToast} />}
      {erasing && <span className="ink-group">{penOnly}</span>}
    </div>
  );
}
