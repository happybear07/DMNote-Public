// 표 머리 켜고 끄기 (노션 단순 표 '머리 행 · 머리 열' · 워드 표 스타일 '머리글 행 · 첫째 열'):
// 머리 행 = 열 이름 줄(기본 보임 — 끄면 noHeader), 머리 열 = 첫 열 칸을 머리 모양으로(headerCol). 실행 취소 한 번.
import type { Engine, TxResult } from './engine';
import type { Id } from './model';
import { isTableContent, type TableData } from './rich';

export type TableHead = 'row' | 'col';

export function tableHeadOn(t: Pick<TableData, 'noHeader' | 'headerCol'>, which: TableHead): boolean {
  return which === 'row' ? !t.noHeader : !!t.headerCol;
}

export function setTableHead(engine: Engine, contentId: Id, which: TableHead, on: boolean): TxResult<void> {
  return engine.transact((tx) => {
    const t = engine.getContent(contentId);
    if (!isTableContent(t)) return tx.fail('표가 아님');
    tx.set('content', contentId, which === 'row' ? { noHeader: on ? undefined : true } : { headerCol: on ? true : undefined });
  }, { origin: 'user', label: which === 'row' ? '표 머리 행' : '표 머리 열' });
}
