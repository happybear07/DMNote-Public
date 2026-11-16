// 인쇄 · 다른 파일로 저장 (FR-131 · FR-130): 왼쪽 미리보기 + 오른쪽 형식 · 설정 · 저장.
// PDF · 인쇄 · HTML은 문서 뷰를 그대로 그린 미리보기(PDF · 인쇄는 A4 쪽 보기), Markdown은 파일 글 그대로, 백업은 담기는 것 요약.
import { useEffect, useMemo, useRef, useState } from 'react';
import { DocView } from '@dn/engine-dom';
import { download, safeName } from './export';
import { noteToDocx } from './docx/docx-export';
import { imagesToPdf } from './pdf';
import { printHtml, rasterizePages, standaloneHtml } from './print-render';
import type { Workspace, WorkspaceState } from './workspace';
import { displayTitle } from './ws-model';
import { useEscape } from './hooks';
import { Icon } from './Icon';

type Format = 'pdf' | 'print' | 'docx' | 'html' | 'md' | 'json';
const FORMATS: { f: Format; label: string; hint: string }[] = [
  { f: 'pdf', label: 'PDF', hint: '쪽 모양 그대로 · 글자 고르기 · 책갈피' },
  { f: 'print', label: '인쇄', hint: '프린터 · 시스템 PDF' },
  { f: 'docx', label: 'Word', hint: '워드에서 열고 고치기' },
  { f: 'html', label: 'HTML', hint: '브라우저로 여는 한 파일' },
  { f: 'md', label: 'Markdown', hint: '다른 노트앱으로 옮기기' },
  { f: 'json', label: '백업', hint: '되살리기용 원본 그대로' },
];

export function ExportDialog({ ws, s }: { ws: Workspace; s: WorkspaceState }) {
  // '문서에서 그림으로' 묶음: 캔버스 모양 그대로 그림 (문서 뷰 · 워드 같게)
  const diagram = (ids: readonly string[]) => ws.view?.exportPng({ ids, scale: 2, pad: 12 }) ?? Promise.resolve(null);
  const meta = s.notes.find((n) => n.id === s.currentId);
  const title = meta ? displayTitle(meta) : '노트';
  const [format, setFormat] = useState<Format>(() => { try { const f = localStorage.getItem('dn:export-format'); return (FORMATS.some((x) => x.f === f) ? f : 'pdf') as Format; } catch { return 'pdf'; } });
  const [opts, setOpts] = useState({ title: true, pageNumbers: true, colors: true });
  const [pages, setPages] = useState(0);
  const [md, setMd] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const docRef = useRef<DocView | null>(null);
  const paged = format === 'pdf' || format === 'print' || format === 'docx';
  const visual = paged || format === 'html';

  // 미리보기: 같은 엔진을 읽기 전용 문서 뷰로 (PDF · 인쇄는 쪽 보기)
  useEffect(() => {
    const el = host.current, engine = ws.view?.engine;
    if (!visual || !el || !engine) return;
    const d = new DocView({ engine, container: el, readOnly: true, files: { url: (h) => ws.fileUrl(h) }, embeds: ws.embedHost, pages: paged, title: () => title, ...(opts.title ? { header: title } : {}), diagram });
    docRef.current = d;
    const count = () => setPages(el.querySelectorAll('.dn-doc-sheet').length);
    const ro = new ResizeObserver(count);
    ro.observe(el);
    count();
    return () => { ro.disconnect(); d.destroy(); docRef.current = null; };
  }, [ws, visual, paged, opts.title, title]);
  useEffect(() => { if (format === 'md' && s.currentId) void ws.noteMarkdown(s.currentId).then(setMd); }, [ws, format, s.currentId]);
  useEscape(() => ws.closeDialog(), !busy);
  const counts = useMemo(() => {
    const e = ws.view?.engine;
    if (!e) return null;
    const contents = [...e.contents()];
    return { blocks: e.blockCount, images: contents.filter((c) => c.type === 'image').length, ink: [...e.strokes()].length, arrows: [...e.arrows()].length };
  }, [ws, format]);

  const root = () => host.current?.querySelector<HTMLElement>('.dn-doc') ?? null;
  const save = async () => {
    try { localStorage.setItem('dn:export-format', format); } catch { /* 다음엔 기본값 */ }
    const r = root();
    try {
      await docRef.current?.diagramsReady(); // 도식 그림이 다 그려진 뒤에 (인쇄 · PDF · HTML은 미리보기를 복제한다)
      if (format === 'pdf' && r) {
        setBusy('쪽을 그리는 중…');
        const { pages: imgs, outline } = await rasterizePages(r, { ...opts, onPage: (i, n) => setBusy(`쪽을 그리는 중… ${i}/${n}`) });
        download(`${safeName(title)}.pdf`, imagesToPdf(imgs, title, outline), 'application/pdf');
        ws.toast(`'${title}'을(를) PDF로 저장했어요 (${imgs.length}쪽).`);
      } else if (format === 'print' && r) {
        setBusy('인쇄 준비 중…');
        await printHtml(await standaloneHtml(r, title, opts));
      } else if (format === 'docx' && ws.view) {
        if (meta?.locked) { ws.toast('잠긴 노트는 내보낼 수 없어요 — 잠금을 풀고 내보내 주세요.'); return; }
        setBusy('워드 파일을 만드는 중…');
        const titleOf = (id: string) => { const m = s.notes.find((n) => n.id === id); return m ? displayTitle(m) : null; };
        const bytes = await noteToDocx(ws.view.engine, title, opts, { noteTitle: titleOf, file: async (h) => { const u = await ws.fileUrl(h); return u ? (await fetch(u)).blob() : null; }, diagram });
        download(`${safeName(title)}.docx`, bytes as BlobPart, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        ws.toast(`'${title}'을(를) 워드 파일로 저장했어요.`);
      } else if (format === 'html' && r) {
        setBusy('파일을 만드는 중…');
        download(`${safeName(title)}.html`, await standaloneHtml(r, title, opts), 'text/html;charset=utf-8');
        ws.toast(`'${title}'을(를) HTML 파일로 저장했어요.`);
      } else if (format === 'md' && s.currentId) await ws.exportNote(s.currentId);
      else if (format === 'json' && s.currentId) await ws.exportNoteBackup(s.currentId);
      ws.closeDialog();
    } catch (err) {
      console.warn('[dn] 내보내기 실패', err);
      ws.toast(format === 'pdf' ? 'PDF를 만들지 못했어요. 인쇄에서 "PDF로 저장"을 써 주세요.' : '파일을 만들지 못했어요. 다시 시도해 주세요.');
    } finally { setBusy(null); }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={() => !busy && ws.closeDialog()}>
      <div className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="export-preview" aria-label="미리보기">
          {visual && <div className={`export-paper${opts.pageNumbers ? '' : ' no-page-num'}${opts.colors ? '' : ' no-colors'}${paged ? ' paged' : ''}`} ref={host} />}
          {format === 'md' && <pre className="export-text">{md ?? '불러오는 중…'}</pre>}
          {format === 'json' && counts && (
            <div className="export-summary">
              <b>백업 파일에 담기는 것</b>
              <ul><li>상자 {counts.blocks}개 · 자리와 크기 그대로</li><li>화살표 {counts.arrows}개</li><li>필기 {counts.ink}획</li><li>그림 {counts.images}개 (파일 안에)</li><li>폴더 · 태그 · 하위 노트</li></ul>
              <p>가져오기로 되살리면 이 노트가 그대로 돌아와요.</p>
            </div>
          )}
        </div>
        <aside className="export-side">
          <header><h2 id="export-title">인쇄 · 다른 파일로 저장</h2><button className="x" aria-label="닫기" disabled={!!busy} onClick={() => ws.closeDialog()}><Icon name="close" size={14} /></button></header>
          <div className="export-formats" role="radiogroup" aria-label="형식">
            {FORMATS.map((x) => (
              <button key={x.f} role="radio" aria-checked={format === x.f} className={format === x.f ? 'on' : ''} disabled={!!busy} onClick={() => setFormat(x.f)}>
                <b>{x.label}</b><small>{x.hint}</small>
              </button>
            ))}
          </div>
          {visual && (
            <fieldset className="export-opts">
              <legend>설정</legend>
              <label><input type="checkbox" checked={opts.title} onChange={(e) => setOpts({ ...opts, title: e.target.checked })} /> 맨 위에 노트 제목</label>
              {paged && <label><input type="checkbox" checked={opts.pageNumbers} onChange={(e) => setOpts({ ...opts, pageNumbers: e.target.checked })} /> 쪽 번호</label>}
              <label><input type="checkbox" checked={opts.colors} onChange={(e) => setOpts({ ...opts, colors: e.target.checked })} /> 상자 배경색</label>
            </fieldset>
          )}
          {paged && <p className="export-meta">A4 세로 · <b>{pages}쪽</b></p>}
          <button className="btn primary export-go" disabled={!!busy || (visual && !pages && paged)} onClick={() => void save()}>
            {busy ?? (format === 'print' ? '인쇄…' : format === 'pdf' ? 'PDF로 저장' : '파일로 저장')}
          </button>
        </aside>
      </div>
    </div>
  );
}
