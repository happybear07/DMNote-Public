// 날짜 멘션 (FR-133): '@내일' · '@금요일' · '@10월 7일' 같은 말을 날짜로 읽고, 화면에는 오늘 기준 상대 표기로.
// 저장은 'YYYY-MM-DD'(기기 시간대의 그날) — 시간대가 바뀌어도 같은 날로 남는다.

export const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const p2 = (n: number) => String(n).padStart(2, '0');

export function isoDate(d: Date): string { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }

/** 'YYYY-MM-DD' → 그날 0시 (형식이 틀리거나 없는 날짜면 null) */
export function fromIso(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isoDate(d) === s ? d : null;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** 두 날 사이 날 수 (b - a) */
function dayDiff(a: Date, b: Date): number { return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000); }

/** 화면 표기: 오늘 · 내일 · 모레 · 어제 · 그 밖은 '10월 7일 (화)', 다른 해면 '2027년 1월 3일 (일)' */
export function dateLabel(iso: string, now = new Date()): string {
  const d = fromIso(iso);
  if (!d) return iso;
  const diff = dayDiff(now, d);
  const rel = ({ 0: '오늘', 1: '내일', 2: '모레', [-1]: '어제' } as Record<number, string>)[diff];
  if (rel) return rel;
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}년 ${md}`;
}

/** 지난날 · 오늘 · 앞날 (색 표시용) */
export function dateTense(iso: string, now = new Date()): 'past' | 'today' | 'future' {
  const d = fromIso(iso);
  const diff = d ? dayDiff(now, d) : 0;
  return diff < 0 ? 'past' : diff === 0 ? 'today' : 'future';
}

/**
 * 검색어 → 날짜 ('YYYY-MM-DD') — 못 읽으면 null.
 * 오늘 · 내일 · 모레 · 글피 · 어제 · 그제 · N일 뒤/후 · N주 뒤 · (이번|다음|다다음) 주 X요일 · X요일(오늘 포함 가장 가까운) ·
 * M월 D일 · M/D · M.D · YYYY-MM-DD · YYYY.M.D · YYYY년 M월 D일 · today · tomorrow · yesterday
 */
export function parseDateQuery(q: string, now = new Date()): string | null {
  const s = q.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const today = startOfDay(now);
  const word: Record<string, number> = { 오늘: 0, today: 0, 내일: 1, tomorrow: 1, 모레: 2, 글피: 3, 어제: -1, yesterday: -1, 그제: -2, 그저께: -2 };
  if (s in word) return isoDate(addDays(today, word[s]!));
  let m = /^(\d{1,3})(일|주)(뒤|후)$/.exec(s);
  if (m) return isoDate(addDays(today, Number(m[1]) * (m[2] === '주' ? 7 : 1)));
  m = /^(이번주|다음주|다다음주)?([일월화수목금토])(요일)?$/.exec(s);
  if (m && (m[1] || m[3])) {
    const want = WEEK.indexOf(m[2]!);
    if (!m[1]) { const k = (want - today.getDay() + 7) % 7; return isoDate(addDays(today, k)); }
    // 주는 월요일부터: 이번 주 월요일 + 요일 + 주 수
    const monday = addDays(today, -((today.getDay() + 6) % 7));
    const weeks = m[1] === '이번주' ? 0 : m[1] === '다음주' ? 1 : 2;
    return isoDate(addDays(monday, weeks * 7 + ((want + 6) % 7)));
  }
  const ymd = (y: number, mo: number, d: number) => { const iso = `${y}-${p2(mo)}-${p2(d)}`; return fromIso(iso) ? iso : null; };
  m = /^(\d{4})[-./년](\d{1,2})[-./월](\d{1,2})일?$/.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})(?:월|[./])(\d{1,2})일?$/.exec(s);
  if (m) {
    // 연도 없이: 올해 그날, 이미 두 달 넘게 지났으면 내년 (12월에 '1월 3일'을 쓰는 경우)
    const mo = Number(m[1]), d = Number(m[2]);
    const thisYear = ymd(today.getFullYear(), mo, d);
    if (thisYear && dayDiff(today, fromIso(thisYear)!) < -60) return ymd(today.getFullYear() + 1, mo, d);
    return thisYear;
  }
  return null;
}
