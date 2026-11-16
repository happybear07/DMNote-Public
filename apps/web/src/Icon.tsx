// 단색 선 아이콘 (모양은 text-pm/icons.ts 하나에서 정한다 — 콜아웃과 같은 세트).
// 선 굵기는 화면에서 약 1.25px가 되게 크기마다(24칸 기준 30 ÷ 크기 — 14px 2.1 · 16px 1.9 · 20px 1.5): 옆 글자 줄기와 같은 굵기 (DESIGN-HUMAN 3.6)
import { ICON_PATHS, type IconName } from '@dn/text-pm';

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={Math.round(300 / size) / 10} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
