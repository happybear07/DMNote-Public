// 노트 위 태그 줄 (FR-074): 붙은 태그 칩 · ＃ 태그 추가(자동완성) · 이 노트에 자주 나온 낱말 추천(기기 안 계산, 10/26).
import { useMemo, useState } from 'react';
import { tagKey, type NoteMeta, type Tag } from '@dn/storage-idb';
import type { Workspace } from './workspace';
import { Icon } from './Icon';

export function TagBar({ ws, note, tags }: { ws: Workspace; note: NoteMeta; tags: Tag[] }) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const mine = (note.tagIds ?? []).map((id) => tags.find((t) => t.id === id)).filter((t): t is Tag => !!t);
  const key = tagKey(q.replace(/^#/, ''));
  const suggest = useMemo(() => tags.filter((t) => !note.tagIds?.includes(t.id) && (!key || t.nameKey.includes(key))).slice(0, 8), [tags, note.tagIds, key]);
  const exact = tags.some((t) => t.nameKey === key);
  // 추천: 이 노트의 키워드 중 아직 태그가 아닌 것 (검색 문서 v4 keywords)
  const mineKeys = new Set(mine.map((t) => t.nameKey));
  const recommend = adding ? (ws.index.card(note.id)?.keywords ?? []).filter((k) => !mineKeys.has(tagKey(k)) && !suggest.some((t) => t.nameKey === tagKey(k)) && (!key || tagKey(k).includes(key))).slice(0, 5) : [];
  // 마지막 줄은 "새 태그 만들기"
  const options: { label: string; name: string; isNew?: boolean }[] = [
    ...suggest.map((t) => ({ label: `#${t.name}`, name: t.name })),
    ...recommend.map((k) => ({ label: `추천 #${k}`, name: k })),
    ...(key && !exact && !recommend.some((k) => tagKey(k) === key) ? [{ label: `'#${q.replace(/^#/, '').trim()}' 새 태그`, name: q.replace(/^#/, ''), isNew: true }] : []),
  ];

  const close = () => { setAdding(false); setQ(''); setSel(0); };
  const pick = (name: string) => { void ws.addTag(note.id, name); setQ(''); setSel(0); };

  return (
    <div className={`tag-bar${mine.length ? '' : ' no-tags'}`}>
      {mine.map((t) => (
        <span key={t.id} className="tag-chip">
          <button className="tag-name" onClick={() => ws.setTagFilter(t.id)} title="이 태그의 노트 보기">#{t.name}</button>
          <button className="tag-x" aria-label={`#${t.name} 떼기`} title="떼기" onClick={() => void ws.untag(note.id, t.id)}><Icon name="close" size={14} /></button>
        </span>
      ))}
      {adding ? (
        <span className="tag-add">
          <input autoFocus value={q} placeholder="태그 이름" aria-label="태그 추가"
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onBlur={close}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, options.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
              if (e.key === 'Enter') { e.preventDefault(); const o = options[sel]; if (o) pick(o.name); else close(); }
              if (e.key === 'Escape') close();
              if (e.key === 'Backspace' && !q && mine.length) void ws.untag(note.id, mine[mine.length - 1]!.id);
            }} />
          {options.length > 0 && (
            <div className="tag-suggest" role="listbox">
              {options.map((o, i) => (
                <div key={o.label} role="option" aria-selected={i === sel} className={`${i === sel ? 'on' : ''}${o.isNew ? ' new' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); pick(o.name); }} onMouseEnter={() => setSel(i)}>{o.label}</div>
              ))}
            </div>
          )}
        </span>
      ) : (
        <button className="tag-add-btn" onClick={() => setAdding(true)} title="태그 추가">＃ 태그</button>
      )}
    </div>
  );
}
