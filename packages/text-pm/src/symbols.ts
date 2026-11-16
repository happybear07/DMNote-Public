// 기호 · 특수 문자 · 이모지 (워드 삽입 › 기호, 노션 /emoji · ':' 입력). 글자로 들어가는 것이라 UI 선 아이콘 규칙과 별개다.
// 이모지는 자주 쓰는 것만 골라 한글 · 영어 검색어를 붙였다 — 앱 크기를 늘리지 않으려고 전체 목록은 싣지 않는다.

export interface SymbolGroup { readonly name: string; readonly items: string }

/** 기호 묶음 — items는 글자들을 이어 쓴 것 (한 글자씩) */
export const SYMBOL_GROUPS: readonly SymbolGroup[] = [
  { name: '화살표', items: '→←↑↓↔↕⇒⇐⇔⇑⇓↗↘↙↖⟶⟵⟹⟸↦↺↻⤴⤵' },
  { name: '수학', items: '±×÷≠≈≡≤≥≪≫∞√∛∑∏∫∂∆∇∈∉⊂⊃⊆⊇∪∩∅∀∃¬∧∨⊕⊗∝∠⊥∥°′″' },
  { name: '논리 · 구조', items: '∴∵※•·…‥◦▪▫■□▲△▼▽◆◇○●◎★☆✓✗' },
  { name: '그리스 문자', items: 'αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ' },
  { name: '첨자 · 분수', items: '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ₀₁₂₃₄₅₆₇₈₉₊₋½⅓⅔¼¾⅛' },
  { name: '문장 부호', items: '「」『』《》〈〉【】〔〕‘’“”—–‐§¶†‡‰' },
  { name: '단위 · 통화', items: '₩$€£¥¢℃℉㎜㎝㎞㎎㎏㎖㎗ℓ㎡㎥%‰№™©®' },
  { name: '원 · 괄호 숫자', items: '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮㉠㉡㉢㉣㉤㉥㉦㉧ⓐⓑⓒⓓ⑴⑵⑶⑷⑸' },
];

export interface EmojiItem { readonly e: string; readonly k: readonly string[] }

const E = (e: string, ...k: string[]): EmojiItem => ({ e, k });

/** 자주 쓰는 이모지 — 검색어(한글 · 영어) */
export const EMOJI: readonly EmojiItem[] = [
  E('😀', '웃음', '미소', 'smile', 'grin', 'happy'), E('😂', '눈물', '웃김', 'joy', 'laugh', 'lol'), E('🙂', '미소', 'slight', 'smile'), E('😉', '윙크', 'wink'),
  E('😍', '하트눈', '사랑', 'love', 'heart_eyes'), E('🤔', '생각', '고민', 'think', 'thinking'), E('😅', '땀', '민망', 'sweat'), E('😢', '슬픔', '눈물', 'cry', 'sad'),
  E('😭', '울음', '통곡', 'sob'), E('😡', '화남', '분노', 'angry', 'rage'), E('😮', '놀람', 'wow', 'surprised'), E('😴', '졸림', '잠', 'sleep'),
  E('🥳', '축하', '파티', 'party'), E('😎', '멋짐', '선글라스', 'cool'), E('🤯', '충격', '머리', 'mind_blown'), E('🙏', '감사', '부탁', 'pray', 'thanks'),
  E('👍', '좋아요', '최고', 'thumbsup', 'like', 'ok'), E('👎', '싫어요', 'thumbsdown', 'dislike'), E('👏', '박수', 'clap'), E('🙌', '만세', 'hooray'),
  E('💪', '힘', '근육', 'muscle', 'strong'), E('👀', '눈', '봄', 'eyes', 'look'), E('👋', '안녕', '손', 'wave', 'hello'), E('✌️', '브이', 'victory', 'peace'),
  E('❤️', '하트', '사랑', 'heart', 'love', 'red'), E('🧡', '주황하트', 'orange_heart'), E('💛', '노랑하트', 'yellow_heart'), E('💚', '초록하트', 'green_heart'),
  E('💙', '파랑하트', 'blue_heart'), E('💜', '보라하트', 'purple_heart'), E('💔', '상처', '이별', 'broken_heart'), E('✨', '반짝', 'sparkles', 'shine'),
  E('🔥', '불', '핫', 'fire', 'hot', 'lit'), E('⭐', '별', 'star'), E('🌟', '빛나는별', 'glowing_star'), E('⚡', '번개', '빠름', 'zap', 'lightning'),
  E('💡', '전구', '아이디어', 'bulb', 'idea'), E('📌', '핀', '고정', 'pin', 'pushpin'), E('📍', '위치', '장소', 'location', 'round_pin'), E('📎', '클립', '첨부', 'paperclip'),
  E('📝', '메모', '노트', 'memo', 'note'), E('📚', '책', '공부', 'books', 'study'), E('📖', '독서', '책', 'book', 'read'), E('✏️', '연필', 'pencil'),
  E('📅', '달력', '날짜', 'calendar', 'date'), E('⏰', '알람', '시계', 'alarm', 'clock'), E('⏳', '모래시계', '기다림', 'hourglass', 'wait'), E('📊', '그래프', '차트', 'chart', 'bar'),
  E('📈', '상승', '증가', 'up', 'chart_up', 'growth'), E('📉', '하락', '감소', 'down', 'chart_down'), E('🔍', '찾기', '검색', 'search', 'find'), E('🔗', '링크', 'link'),
  E('🔒', '잠금', '자물쇠', 'lock'), E('🔑', '열쇠', '키', 'key'), E('💬', '말풍선', '대화', 'speech', 'chat'), E('📢', '공지', '확성기', 'announce', 'loud'),
  E('✅', '완료', '체크', 'done', 'check', 'ok'), E('☑️', '체크박스', 'ballot_check'), E('❌', '아니', '취소', 'x', 'no', 'cross'), E('⚠️', '주의', '경고', 'warning'),
  E('❗', '느낌표', '중요', 'exclamation', 'important'), E('❓', '물음표', '질문', 'question'), E('🚫', '금지', 'no_entry', 'forbidden'), E('⛔', '진입금지', 'stop'),
  E('🎯', '목표', '과녁', 'target', 'goal'), E('🏆', '트로피', '우승', 'trophy', 'win'), E('🎉', '축하', '파티', 'tada', 'party', 'celebrate'), E('🎁', '선물', 'gift', 'present'),
  E('🚀', '로켓', '출시', 'rocket', 'launch'), E('💯', '백점', '완벽', '100', 'perfect'), E('💰', '돈', 'money', 'bag'), E('💸', '지출', '돈날림', 'money_wings'),
  E('🛠️', '도구', '수리', 'tools', 'fix'), E('⚙️', '설정', '톱니', 'gear', 'settings'), E('🧪', '실험', '테스트', 'test', 'lab'), E('🐛', '버그', 'bug'),
  E('💻', '노트북', '컴퓨터', 'laptop', 'computer'), E('📱', '휴대폰', '폰', 'phone', 'mobile'), E('🖥️', '모니터', 'desktop'), E('⌨️', '키보드', 'keyboard'),
  E('☕', '커피', 'coffee'), E('🍕', '피자', 'pizza'), E('🍔', '햄버거', 'burger'), E('🍎', '사과', 'apple'), E('🍰', '케이크', 'cake'), E('🍺', '맥주', 'beer'),
  E('☀️', '해', '맑음', 'sun', 'sunny'), E('🌧️', '비', 'rain'), E('☁️', '구름', 'cloud'), E('❄️', '눈', '겨울', 'snow'), E('🌈', '무지개', 'rainbow'), E('🌙', '달', '밤', 'moon'),
  E('🌱', '새싹', '시작', 'seedling', 'grow'), E('🌸', '벚꽃', '꽃', 'blossom', 'flower'), E('🍀', '행운', '클로버', 'clover', 'luck'), E('🌍', '지구', '세계', 'earth', 'world'),
  E('🐶', '강아지', '개', 'dog'), E('🐱', '고양이', 'cat'), E('🐻', '곰', 'bear'), E('🐰', '토끼', 'rabbit'), E('🐧', '펭귄', 'penguin'), E('🦄', '유니콘', 'unicorn'),
  E('🏠', '집', 'home', 'house'), E('🏫', '학교', 'school'), E('🏢', '회사', '건물', 'office'), E('✈️', '비행기', '여행', 'airplane', 'travel'), E('🚗', '자동차', 'car'), E('🚌', '버스', 'bus'),
  E('⚽', '축구', 'soccer'), E('🏀', '농구', 'basketball'), E('🎵', '음악', 'music', 'note'), E('🎨', '그림', '디자인', 'art', 'design'), E('📷', '사진', '카메라', 'camera', 'photo'), E('🎬', '영화', 'movie'),
  E('1️⃣', '하나', 'one', '1'), E('2️⃣', '둘', 'two', '2'), E('3️⃣', '셋', 'three', '3'), E('🔴', '빨강', '빨간원', 'red_circle'), E('🟢', '초록', '초록원', 'green_circle'), E('🔵', '파랑', '파란원', 'blue_circle'),
  E('🟡', '노랑', '노란원', 'yellow_circle'), E('⬆️', '위', 'up'), E('⬇️', '아래', 'down'), E('➡️', '오른쪽', 'right'), E('⬅️', '왼쪽', 'left'), E('🔁', '반복', 'repeat'),
];

/** 이모지 찾기 — 검색어가 똑같은 것, 앞부분이 맞는 것, 들어 있는 것 순 */
export function findEmoji(q: string, limit = 8): EmojiItem[] {
  const t = q.trim().toLowerCase();
  if (!t) return EMOJI.slice(0, limit);
  const rank = (x: EmojiItem) => (x.k.some((k) => k.toLowerCase() === t) ? 0 : x.k.some((k) => k.toLowerCase().startsWith(t)) ? 1 : x.k.some((k) => k.toLowerCase().includes(t)) ? 2 : 3);
  return EMOJI.map((x) => [x, rank(x)] as const).filter(([, r]) => r < 3).sort((a, b) => a[1] - b[1]).map(([x]) => x).slice(0, limit);
}
