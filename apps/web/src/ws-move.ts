// 블록을 다른 노트로 옮기기 (GAP #16 — 노션 '옮기기' · /move to): 고른 상자를 그 노트 맨 아래에 붙이고 이 노트에서 지운다.
// 상자 사이 화살표 · 의미 · 출처(AI 표시)는 함께, 묶음 하나를 통째로 골랐으면 그 노트에서도 같은 이름의 묶음으로.
// 밖으로 이어진 화살표 · 댓글 · 묶인 손글씨는 옮기지 않는다(블록 복사와 같은 규칙, clip.ts). 다른 노트에 쓴 것은 되돌릴 수 없어
// 이 노트에서 지운 것도 실행 취소 대상에서 뺀다 — 되살리면 두 노트에 같은 상자가 생긴다. 알림에서 그 노트로 갈 수 있다.
// 층 순서: … → ws-import → 여기 → ws-todos
import { blockClip, createFromClip, deleteEntities, groupBlocks, groupMembers, groupName, type Engine } from '@dn/engine-core';
import { ImportLayer } from './ws-import';
import { displayTitle, firstLine } from './ws-model';

export abstract class MoveLayer extends ImportLayer {
  /** 노트 고르기 창 열기 (블록 메뉴 · /옮기기) */
  openMoveTo(ids: readonly string[]): void {
    if (ids.length && this.view && !this.open?.session.readonly) this.set({ moveBlocks: [...ids], blockMenu: null });
  }
  closeMoveTo(): void { if (this.state.moveBlocks) this.set({ moveBlocks: null }); }

  /** 고른 상자 → 그 노트 맨 아래. 옮겼으면 true */
  async moveBlocksTo(targetId: string, ids: readonly string[]): Promise<boolean> {
    this.closeMoveTo();
    const view = this.view, src = view?.engine;
    const target = this.state.notes.find((n) => n.id === targetId);
    const live = src ? ids.filter((id) => src.getBlock(id)) : [];
    if (!view || !src || !target || targetId === src.note.id || !live.length) return false;
    // 묶음 하나를 통째로 골랐으면 그 노트에서도 묶음으로
    const whole = [...groupMembers(src)].find(([, m]) => m.length === live.length && m.every((id) => live.includes(id)));
    const groupLabel = whole ? groupName(src, whole[0], whole[1]) : undefined;
    const clip = blockClip(src, live);
    const put = (e: Engine): number | null => {
      const bs = [...e.blocks()];
      const at = bs.length ? { x: Math.min(...bs.map((b) => b.x)), y: Math.max(...bs.map((b) => b.y + b.h)) + 60 } : { x: 0, y: 0 };
      const r = e.transact((tx) => createFromClip(e, tx, clip, at), { origin: 'user', label: '다른 노트에서 옮겨 옴' });
      if (!r.ok) return null;
      if (groupLabel !== undefined) groupBlocks(e, r.value, groupLabel);
      return r.value.length;
    };
    const n = await this.editNote(targetId, put, (e) => ({ updatedAt: Date.now(), preview: firstLine(e) }));
    if (n === 'busy') { this.toast(`'${displayTitle(target)}'을(를) 다른 탭에서 고치는 중이라 옮기지 못했어요.`); return false; }
    if (!n) { this.toast(`'${displayTitle(target)}'을(를) 열지 못해 옮기지 못했어요.`); return false; }
    src.transact(() => { deleteEntities(src, live); }, { origin: 'user', undoable: false, label: '다른 노트로 옮김' });
    view.select([]);
    this.toast(`상자 ${n}개를 '${displayTitle(target)}'(으)로 옮겼어요.`, { label: '그 노트로', run: () => void this.openById(targetId) });
    return true;
  }
}
