// 파괴적 동작 확인 다이얼로그 (MESSAGES 1절: 버튼에 사라지는 것을 쓰고, 초기 포커스는 취소).
import { useEffect, useRef } from 'react';
import { useEscape } from './hooks';

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** 두 번째 선택지 (예: 폴더 삭제 — 노트는 위로 옮기기) */
  alt?: { label: string; onConfirm: () => void };
}

export function ConfirmDialog({ req, onClose }: { req: ConfirmRequest; onClose: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, [onClose]);
  useEscape(onClose);

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="dlg-title">{req.title}</h2>
        <p>{req.body}</p>
        <div className="dialog-actions">
          <button ref={cancelRef} className="btn" onClick={onClose}>취소</button>
          {req.alt && <button className="btn" onClick={() => { req.alt!.onConfirm(); onClose(); }}>{req.alt.label}</button>}
          <button className="btn danger" onClick={() => { req.onConfirm(); onClose(); }}>{req.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
