// 이동 경로 (GAP #17 — 노션 위쪽 경로): 노트 이름 앞에 든 폴더 · 상위 노트(데이터베이스 항목 페이지면 그 데이터베이스가 있는 노트).
// 폴더를 누르면 사이드바에서 그 폴더까지 펼쳐 보여 주고, 상위 노트를 누르면 연다. 맨 위 노트면 아무것도 그리지 않는다.
// 위 막대 높이는 그대로 — 캔버스 위 가장자리가 움직이면 좌표로 누르는 시험이 깨진다(tree.ts 메모와 같은 이유).
import { Fragment } from 'react';
import type { NoteMeta } from '@dn/storage-idb';
import { pathCrumbs } from './tree';
import { displayTitle, type Workspace, type WorkspaceState } from './workspace';

export function Breadcrumb({ ws, s, note }: { ws: Workspace; s: WorkspaceState; note: NoteMeta }) {
  const crumbs = pathCrumbs(note, s.notes, s.folders, displayTitle);
  if (!crumbs.length) return null;
  return (
    <nav className="crumbs" aria-label="이동 경로">
      {crumbs.map((c) => (
        <Fragment key={`${c.kind}:${c.id}`}>
          <button className="crumb" title={c.kind === 'folder' ? `사이드바에서 '${c.name}' 폴더 보기` : `'${c.name}' 열기`}
            onClick={() => (c.kind === 'folder' ? ws.revealFolder(c.id) : void ws.openById(c.id))}>{c.name}</button>
          <span className="crumb-sep" aria-hidden>›</span>
        </Fragment>
      ))}
    </nav>
  );
}
