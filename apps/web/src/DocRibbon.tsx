// 문서 뷰 서식 막대 (워드의 리본): 실행 취소 · 문단 스타일 · 글자 크기 · 굵게/기울임/밑줄/취소선/코드/형광펜/링크 · 글자 색 · 정렬 ·
// 목록 · 넣기(표 · 사진 · 수식 · 구분선 · 쪽 나눔) · 쪽 보기. 누르는 동안 에디터 초점을 빼앗지 않는다(mousedown 막기).
// 명령은 engine-dom DocWord로, 켜짐 표시는 DocWord가 알려 주는 상태(docUi)로.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { FIRST_LINES, FONT_BASE_PX, LINE_HEIGHTS, PARA_SPACES, pxOfScale, scaleOfPx, setHeadingNumbers, type BlockAlign, type Engine } from '@dn/engine-core';
import { pickTableSize, textColorCss, type DocUiState } from '@dn/engine-dom';
import type { FormatCommand } from '@dn/text-pm';
import type { Workspace } from './workspace';
import { Icon } from './Icon';
import { ColorPalette } from './ColorPalette';
import { PageSetupPanel } from './PageSetupPanel';
import { FontPick, PxSize } from './FontControls';

// 문단 스타일 (워드 스타일 갤러리): 하나만 — 고르면 감싼 인용 · 콜아웃을 풀고 새 모양으로 (text-pm para-style.ts)
const STYLES: { cmd: FormatCommand; label: string }[] = [
  { cmd: 'paragraph', label: '본문' }, { cmd: 'h1', label: '제목 1' }, { cmd: 'h2', label: '제목 2' }, { cmd: 'h3', label: '제목 3' }, { cmd: 'h4', label: '제목 4' },
  { cmd: 'quote', label: '인용' }, { cmd: 'code_block', label: '코드' }, { cmd: 'callout', label: '콜아웃' },
];
/** 지금 스타일: 코드 · 제목이 감싼 것(콜아웃 · 인용)보다 먼저 */
const STYLE_ORDER: FormatCommand[] = ['code_block', 'h1', 'h2', 'h3', 'h4', 'callout', 'quote', 'paragraph'];
const MARKS: { cmd: FormatCommand; label: ReactNode; title: string; cls?: string }[] = [
  { cmd: 'strong', label: <b>B</b>, title: '굵게 (Ctrl+B)' },
  { cmd: 'em', label: <i>I</i>, title: '기울임 (Ctrl+I)' },
  { cmd: 'underline', label: 'U', title: '밑줄 (Ctrl+U)', cls: 'rb-u' },
  { cmd: 'strike', label: 'S', title: '취소선 (Ctrl+Shift+X)', cls: 'rb-s' },
  { cmd: 'code', label: <Icon name="code" />, title: '코드' },
  { cmd: 'highlight', label: <Icon name="highlight" />, title: '형광펜 (Ctrl+Shift+H)' },
  { cmd: 'chip', label: <span className="rb-chip">칩</span>, title: '키워드 칩 — 고른 글을 둥근 알약으로 (노트형)' },
  { cmd: 'link', label: <Icon name="link" />, title: '링크 (Ctrl+K)' },
  { cmd: 'sup', label: 'x²', title: '위 첨자 (Ctrl+.)' },
  { cmd: 'sub', label: 'x₂', title: '아래 첨자 (Ctrl+,)' },
];
const svg = (d: string) => <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d={d} /></svg>;
const ALIGNS: { a: BlockAlign; title: string; d: string }[] = [
  { a: 'left', title: '왼쪽 맞춤 (Ctrl+L)', d: 'M3 5h14M3 9h9M3 13h14M3 17h9' },
  { a: 'center', title: '가운데 맞춤 (Ctrl+E)', d: 'M3 5h14M5.5 9h9M3 13h14M5.5 17h9' },
  { a: 'right', title: '오른쪽 맞춤 (Ctrl+R)', d: 'M3 5h14M8 9h9M3 13h14M8 17h9' },
  { a: 'justify', title: '양쪽 맞춤 (Ctrl+J)', d: 'M3 5h14M3 9h14M3 13h14M3 17h14' },
];
const LISTS: { cmd: FormatCommand; label: ReactNode; title: string }[] = [
  { cmd: 'bullet', label: <Icon name="list" />, title: '글머리 목록 (Ctrl+Shift+L)' },
  { cmd: 'ordered', label: <Icon name="listOrdered" />, title: '번호 목록' },
  { cmd: 'task', label: <Icon name="checkSquare" />, title: '할 일 목록' },
  { cmd: 'quote', label: <Icon name="quote" />, title: '인용' },
];

/** 눌러도 에디터 초점 · 선택을 그대로 (버튼이 초점을 가져가지 않게) */
function Btn({ title, onClick, onDoubleClick, active, disabled, cls, children }: { title: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; onDoubleClick?: () => void; active?: boolean; disabled?: boolean; cls?: string; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title.replace(/ \(.*\)$/, '')} aria-pressed={active ?? undefined} disabled={disabled}
      className={`${cls ?? ''}${active ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={onClick} onDoubleClick={onDoubleClick}>{children}</button>
  );
}

/** 버튼 하나 + 아래로 펼쳐지는 판 (색 · 줄 간격). 눌러도 에디터 초점을 빼앗지 않고, 바깥을 누르면 닫힌다 */
function Pop({ title, trigger, disabled, children }: { title: string; trigger: ReactNode; disabled?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // 판은 화면 안에: 버튼 아래, 오른쪽이 넘치면 왼쪽으로 당긴다 (서식 막대가 좁은 창에서 줄바꿈돼도)
  useLayoutEffect(() => {
    const p = panel.current, b = box.current?.firstElementChild?.getBoundingClientRect();
    if (!open || !p || !b) return;
    const w = p.offsetWidth;
    p.style.left = `${Math.max(8, Math.min(b.left, window.innerWidth - w - 8))}px`;
    p.style.top = `${b.bottom + 6}px`;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return (
    <span className="rb-pop" ref={box}>
      <button type="button" title={title} aria-label={title} aria-haspopup="true" aria-expanded={open} disabled={disabled} className={open ? 'on' : ''}
        onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>{trigger}</button>
      {open && <div ref={panel} className="rb-pop-panel" role="menu" aria-label={title} onMouseDown={(e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }}>{children(() => setOpen(false))}</div>}
    </span>
  );
}

const LIST_ON = (ui: DocUiState | null) => !!(ui?.active.bullet || ui?.active.ordered || ui?.active.task);

/** 노트의 제목 번호 설정 — 엔진이 바뀌면(실행 취소 · 다른 탭) 따라간다 */
function useHeadingNumbers(e: Engine | undefined): boolean {
  const [on, setOn] = useState(!!e?.note.headingNumbers);
  useEffect(() => { if (!e) return; setOn(!!e.note.headingNumbers); return e.subscribe(() => setOn(!!e.note.headingNumbers)); }, [e]);
  return on;
}

/** 다단계 번호 판: 번호 목록 모양(1 · a · i ↔ 1 · 1.1 · 1.1.1) · 제목 번호(노트 전체) */
const NUMS: { v: '' | 'outline'; label: string }[] = [{ v: '', label: '1.  a.  i.' }, { v: 'outline', label: '1.  1.1.  1.1.1.' }];

export function DocRibbon({ ws, ui, pages }: { ws: Workspace; ui: DocUiState | null; pages: boolean }) {
  const doc = ws.docView;
  const editing = !!ui?.editing, body = ui?.kind === 'body';
  const on = (c: FormatCommand) => !!ui?.active[c];
  const style = STYLE_ORDER.find(on) ?? 'paragraph';
  const engine = ws.view?.engine;
  const hnum = useHeadingNumbers(engine);
  const [list, setList] = useState<'font' | 'size' | null>(null);
  // 글자 크기 px: 상자 기준(제목 17 · 본문 12.5) × 상자 배율 (× 고른 글자 배율, 섞이면 빈 칸)
  const base = FONT_BASE_PX[ui?.kind === 'title' ? 'title' : 'text'], box = ui?.fontScale ?? 1;
  const sizePx = ui?.sel ? (ui.markSize === null ? null : pxOfScale(box * ui.markSize, base)) : pxOfScale(box, base);
  return (
    <div className="doc-ribbon" role="toolbar" aria-label="문서 서식">
      <span className="rb-group">
        <Btn title="실행 취소 (Ctrl+Z)" onClick={() => ws.view?.undo()}>{svg('M7 5L3.5 8.5 7 12M4 8.5h8a4.5 4.5 0 010 9H9')}</Btn>
        <Btn title="다시 실행 (Ctrl+Y)" onClick={() => ws.view?.redo()}>{svg('M13 5l3.5 3.5L13 12M16 8.5H8a4.5 4.5 0 000 9h3')}</Btn>
      </span>
      <span className="rb-group">
        <select aria-label="문단 스타일" title="문단 스타일 (Ctrl+Alt+1 · 2 · 3 · 0)" disabled={!body} value={style} onChange={(e) => doc?.word.format('paraStyle', e.target.value)}>
          {STYLES.map((s) => <option key={s.cmd} value={s.cmd}>{s.label}</option>)}
        </select>
        {/* 글꼴 · 글자 크기(px): 글자를 골랐으면 고른 글자만(크기는 상자 크기에 곱함), 아니면 상자 전체 */}
        <FontPick float disabled={!editing} value={(ui?.sel ? ui.markFont : ui?.fontFamily) ?? null} onPick={(f) => doc?.word.setFont(f)} open={list === 'font'} onOpen={(v) => setList(v ? 'font' : null)} />
        <PxSize float disabled={!editing} px={sizePx} base={base} min={pxOfScale(ui?.sel ? 0.5 * box : 0.5, base)} max={pxOfScale(ui?.sel ? 4 * box : 4, base)}
          onSet={(px) => { if (ui?.sel) doc?.word.markSize(Math.max(0.5, Math.min(4, px / (base * box)))); else doc?.word.setFontScale(scaleOfPx(px, base)); }}
          open={list === 'size'} onOpen={(v) => setList(v ? 'size' : null)} />
      </span>
      <span className="rb-group">
        {/* 서식 복사 (워드 붓): 한 번 누르면 한 번, 두 번 누르면 Esc까지 계속 · Ctrl+Alt+C · V */}
        <Btn title="서식 복사 (Ctrl+Alt+C · 붙여넣기 Ctrl+Alt+V) — 두 번 누르면 계속" active={!!ui?.painting} disabled={!editing} onClick={() => doc?.word.painter.pick(false)} onDoubleClick={() => doc?.word.painter.pick(true)}><Icon name="brush" /></Btn>
        {MARKS.map((m) => <Btn key={m.cmd} title={m.title} cls={m.cls} active={on(m.cmd)} disabled={!editing} onClick={() => doc?.word.format(m.cmd)}>{m.label}</Btn>)}
        <Btn title="서식 지우기 (Ctrl+\) — 링크 · 댓글은 남김" disabled={!editing} onClick={() => doc?.word.format('clear')}>{svg('M4 16h7M9 4h7M12.5 4l-4 12M3 3l14 14')}</Btn>
      </span>
      <span className="rb-group">
        <Pop title="글자 색" disabled={!editing} trigger={<span className="rb-color-trigger"><i style={{ background: textColorCss(ui?.sel ? ui.markColor : ui?.textColor) || 'var(--card)' }} /></span>}>
          {(close) => ui?.sel
            // 글자를 골랐으면 고른 글자에만 (글자 색 · 배경 색), 아니면 상자 전체 글자 색
            ? <ColorPalette title="고른 글자 색" value={ui.markColor} onPick={(c) => { doc?.word.markColor('textColor', c); close(); }}
                background={{ value: ui.markBg, onPick: (c) => { doc?.word.markColor('bgColor', c); close(); } }} />
            : <ColorPalette value={ui?.textColor ?? null} onPick={(c) => { doc?.word.setTextColor(c); close(); }} />}
        </Pop>
      </span>
      <span className="rb-group">
        {ALIGNS.map((x) => <Btn key={x.a} title={x.title} active={editing && ui?.align === x.a} disabled={!editing} onClick={() => doc?.word.setAlign(x.a)}>{svg(x.d)}</Btn>)}
        <Pop title="줄 · 문단 간격" disabled={!editing} trigger={<Icon name="lineSpacing" />}>
          {(close) => (
            <>
              <div className="rb-pop-title">줄 간격</div>
              {LINE_HEIGHTS.map((h) => (
                <button key={h} type="button" role="menuitemradio" aria-checked={(ui?.lineHeight ?? 1) === h} className={`rb-opt${(ui?.lineHeight ?? 1) === h ? ' on' : ''}`}
                  onClick={() => { doc?.word.setLineHeight(h); close(); }}><span>{h === 1 ? '기본' : String(h)}</span><i style={{ height: `${10 + h * 8}px` }} /></button>
              ))}
              {/* 워드 문단: 첫 줄 들여쓰기 · 내어쓰기 · 문단 앞뒤 간격 — 판은 열어 둔 채 여러 번 고른다 */}
              <div className="rb-pop-title rb-pop-sub">첫 줄</div>
              <div className="rb-chips">
                {FIRST_LINES.map((f) => <button key={f} type="button" role="menuitemradio" aria-checked={(ui?.firstLine ?? 0) === f} className={`rb-chip${(ui?.firstLine ?? 0) === f ? ' on' : ''}`}
                  onClick={() => doc?.word.setParagraph({ firstLine: f })}>{f === 0 ? '없음' : f > 0 ? `들여쓰기 ${f}글자` : `내어쓰기 ${-f}글자`}</button>)}
              </div>
              {(['spaceBefore', 'spaceAfter'] as const).map((k) => (
                <div key={k}>
                  <div className="rb-pop-title rb-pop-sub">{k === 'spaceBefore' ? '문단 앞 간격' : '문단 뒤 간격'}</div>
                  <div className="rb-chips">
                    {PARA_SPACES.map((v) => <button key={v} type="button" role="menuitemradio" aria-label={`${k === 'spaceBefore' ? '문단 앞' : '문단 뒤'} ${v || '기본'}`} aria-checked={(ui?.[k] ?? 0) === v} className={`rb-chip${(ui?.[k] ?? 0) === v ? ' on' : ''}`}
                      onClick={() => doc?.word.setParagraph({ [k]: v })}>{v === 0 ? '기본' : v}</button>)}
                  </div>
                </div>
              ))}
            </>
          )}
        </Pop>
        <Btn title="내어쓰기 (Shift+Tab)" disabled={!editing || (!ui?.indent && !LIST_ON(ui))} onClick={() => doc?.word.indent(-1)}>{svg('M3 4h14M9 8h8M9 12h8M3 16h14M6 8l-3 2 3 2')}</Btn>
        <Btn title="들여쓰기 (Tab)" disabled={!editing} onClick={() => doc?.word.indent(1)}>{svg('M3 4h14M9 8h8M9 12h8M3 16h14M3 8l3 2-3 2')}</Btn>
      </span>
      <span className="rb-group">
        {LISTS.map((x) => <Btn key={x.cmd} title={x.title} active={on(x.cmd)} disabled={!body} onClick={() => doc?.word.format(x.cmd)}>{x.label}</Btn>)}
        <Pop title="다단계 번호 — 번호 목록 모양 · 제목 번호" trigger={<span className="rb-nums">1.1</span>}>
          {(close) => (
            <>
              <div className="rb-pop-title">번호 목록 모양</div>
              {NUMS.map((n) => (
                <button key={n.v} type="button" role="menuitemradio" aria-checked={ui?.listNums === n.v} disabled={!body} className={`rb-opt${ui?.listNums === n.v ? ' on' : ''}`}
                  onClick={() => { doc?.word.format('listNums', n.v); close(); }}><span>{n.label}</span></button>
              ))}
              <div className="rb-pop-title rb-pop-sub">제목 번호 (노트 전체)</div>
              <button type="button" role="menuitemcheckbox" aria-checked={hnum} className={`rb-opt${hnum ? ' on' : ''}`} disabled={!engine}
                onClick={() => { if (engine) setHeadingNumbers(engine, !hnum); close(); }}><span>{hnum ? '제목 번호 끄기' : '제목에 번호 (1. · 1.1 · 1.1.1)'}</span></button>
            </>
          )}
        </Pop>
      </span>
      <span className="rb-group">
        <Btn title="표 넣기 (이 문단 아래)" disabled={!editing} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); pickTableSize((s) => doc?.word.insert('table', s), { x: r.left, y: r.bottom + 4 }); }}><Icon name="table" /></Btn>
        <Btn title="사진 넣기 (이 문단 아래)" disabled={!editing} onClick={() => doc?.word.insert('image')}><Icon name="image" /></Btn>
        <Btn title="수식 블록 (줄 맨 앞 $$)" disabled={!body} onClick={() => doc?.word.format('math')}><Icon name="sigma" /></Btn>
        <Btn title="인라인 수식 (Ctrl+Shift+E · 글 속 $식$) — 고른 글은 그 LaTeX로" disabled={!editing} onClick={() => doc?.word.format('mathInline')}><Icon name="mathInline" /></Btn>
        <Btn title="각주 (Ctrl+Alt+F) — 글 속 번호 · 문서 끝 목록" disabled={!editing} onClick={() => doc?.word.format('footnote')}><Icon name="footnote" /></Btn>
        <Btn title="상호 참조 — 캡션 단 그림 · 표 번호 넣기 (/상호 참조)" disabled={!body} onClick={() => doc?.word.symbols('xref')}><Icon name="xref" /></Btn>
        <Btn title="기호 · 특수 문자 (/기호 · 이모지는 :하트)" disabled={!editing} onClick={() => doc?.word.symbols('symbol')}><Icon name="omega" /></Btn>
        <Btn title="구분선" disabled={!body} onClick={() => doc?.word.format('divider')}><Icon name="divider" /></Btn>
        <Btn title="이 문단부터 새 쪽 (커서에서 나누기: Ctrl+Enter)" active={editing && ui?.pageBreak} disabled={!editing} onClick={() => doc?.word.togglePageBreak()}><Icon name="pageBreak" /></Btn>
      </span>
      <span className="rb-group">
        <Btn title="쪽 보기 — A4 종이 · 쪽 번호 (인쇄 모양)" active={pages} onClick={() => ws.setDocPages(!pages)}><Icon name="pages" /></Btn>
        <Pop title="쪽 설정 — 방향 · 여백 · 머리글 · 바닥글 · 쪽 번호" trigger={<Icon name="pageSetup" />}>{() => <PageSetupPanel ws={ws} />}</Pop>
      </span>
    </div>
  );
}
