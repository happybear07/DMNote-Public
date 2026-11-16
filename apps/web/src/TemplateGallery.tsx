// 템플릿 갤러리 (FR-078): 기본 제공 · 내 템플릿 고르기, 미리보기, 지금 노트를 템플릿으로 저장.
import { useMemo, useState } from 'react';
import { blockTextParts, isBound, textLines, type Engine } from '@dn/engine-core';
import { Icon } from './Icon';
import { BUILTIN_TEMPLATES, userEntry } from './templates';
import type { Workspace, WorkspaceState } from './workspace';

export function TemplateGallery({ ws, s }: { ws: Workspace; s: WorkspaceState }) {
  const entries = useMemo(() => [...BUILTIN_TEMPLATES, ...s.templates.map(userEntry)], [s.templates]);
  const [sel, setSel] = useState(entries[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const cur = entries.find((e) => e.id === sel) ?? entries[0];
  const preview = useMemo(() => { try { return cur ? cur.build() : null; } catch { return null; } }, [cur]);
  const canSave = !!s.currentId && s.page === 'note' && !s.emptyCanvas;

  return (
    <div className="dialog-backdrop" onMouseDown={() => ws.closeDialog()}>
      <div className="dialog tpl-dialog" role="dialog" aria-modal="true" aria-label="템플릿" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') ws.closeDialog(); }}>
        <div className="tpl-head">
          <h2>템플릿에서 새 노트</h2>
          <button className="icon-btn" aria-label="닫기" onClick={() => ws.closeDialog()}><Icon name="close" size={14} /></button>
        </div>
        <div className="tpl-body">
          <div className="tpl-list" role="listbox" aria-label="템플릿 목록">
            <div className="tpl-group">기본 템플릿</div>
            {entries.map((e, i) => (
              <div key={e.id}>
                {!e.builtin && entries[i - 1]?.builtin && <div className="tpl-group">내 템플릿</div>}
                <div role="option" aria-selected={e.id === cur?.id} className={`tpl-item${e.id === cur?.id ? ' on' : ''}`}
                  onClick={() => setSel(e.id)} onDoubleClick={() => void ws.newFromTemplate(e)}>
                  <span><b>{e.name}</b><small>{e.hint}</small></span>
                  {!e.builtin && (
                    <button className="icon-btn" aria-label={`'${e.name}' 템플릿 지우기`} title="지우기"
                      onClick={(ev) => { ev.stopPropagation(); void ws.deleteTemplate(e.id); }}><Icon name="trash" size={14} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="tpl-preview" aria-label="미리보기">
            {preview ? <Preview engine={preview} /> : <span className="tpl-none">미리보기를 만들지 못했어요</span>}
          </div>
        </div>
        <div className="dialog-actions tpl-actions">
          {saving ? (
            <input className="tpl-name" autoFocus value={name} placeholder="템플릿 이름" aria-label="템플릿 이름"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter' && name.trim()) { void ws.saveAsTemplate(name); setSaving(false); setName(''); }
                if (e.key === 'Escape') { e.stopPropagation(); setSaving(false); }
              }} />
          ) : (
            canSave && <button className="btn" onClick={() => { setSaving(true); setName(s.title || ''); }}>지금 노트를 템플릿으로 저장</button>
          )}
          <span className="grow" />
          <button className="btn" onClick={() => ws.closeDialog()}>취소</button>
          <button className="btn primary" disabled={!cur} onClick={() => cur && void ws.newFromTemplate(cur)}>이 템플릿으로 만들기</button>
        </div>
      </div>
    </div>
  );
}

/** 블록 배치를 줄여 그린다 — 상자 · 화살표 · 첫 줄 글자 */
function Preview({ engine }: { engine: Engine }) {
  const blocks = [...engine.blocks()];
  if (!blocks.length) return <span className="tpl-none">빈 노트</span>;
  const minX = Math.min(...blocks.map((b) => b.x)), minY = Math.min(...blocks.map((b) => b.y));
  const maxX = Math.max(...blocks.map((b) => b.x + b.w)), maxY = Math.max(...blocks.map((b) => b.y + b.h));
  const pad = 20;
  const center = (id: string) => { const b = engine.getBlock(id); return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null; };
  return (
    <svg viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`} role="img" aria-label="템플릿 배치">
      {[...engine.arrows()].filter(isBound).map((a) => {
        const p = center(a.from.blockId), q = center(a.to.blockId);
        return p && q ? <line key={a.id} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="tpl-arrow" /> : null;
      })}
      {blocks.map((b) => {
        const { title, bodies } = blockTextParts(engine.contentsOf(b.id));
        const lines = (title ? [title, ...bodies] : bodies).flatMap((c) => textLines(c.doc)).filter((l) => l.trim()).slice(0, 3);
        const isTitle = !!title && !bodies.length;
        return (
          <g key={b.id}>
            {!isTitle && <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} className="tpl-box" />}
            {lines.map((l, i) => (
              <text key={i} x={b.x + (isTitle ? 0 : 14)} y={b.y + (isTitle ? 30 : 28 + i * 24)} className={i === 0 ? (isTitle ? 'tpl-t big' : 'tpl-t') : 'tpl-t sub'}>
                {l.length > 22 ? `${l.slice(0, 22)}…` : l}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
