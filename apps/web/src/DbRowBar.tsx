// 데이터베이스 항목 페이지 머리 (FR-063): 이 노트가 어느 데이터베이스의 항목인지 · 그 항목의 속성. 누르면 데이터베이스가 있는 노트로.
// 속성 값은 데이터베이스에서 고친다 (여기는 읽기 — 다른 노트의 데이터라서).
import { useEffect, useState } from 'react';
import type { Workspace } from './workspace';
import type { DbRowInfo } from './ws-dbpages';

export function DbRowBar({ ws, noteId, rev }: { ws: Workspace; noteId: string; rev: unknown }) {
  const [info, setInfo] = useState<DbRowInfo | null>(null);
  useEffect(() => {
    let live = true;
    void ws.dbRowInfo(noteId).then((x) => { if (live) setInfo(x); });
    return () => { live = false; };
  }, [ws, noteId, rev]);
  if (!info) return null;
  const props = info.props.filter((p) => p.text);
  return (
    <div className="db-rowbar" role="note" aria-label="데이터베이스 항목">
      <button className="db-rowbar-back" title="데이터베이스로 돌아가기" onClick={() => void ws.openById(info.parentId)}>
        ← {info.parentTitle} · <b>{info.dbTitle}</b>
      </button>
      {props.length > 0 && (
        <dl className="db-rowbar-props">
          {props.map((p) => <div key={p.name}><dt>{p.name}</dt><dd>{p.text}</dd></div>)}
        </dl>
      )}
    </div>
  );
}
