// 번들러(Vite · Vitest)가 글자 그대로 읽어 주는 파일 — 슬래시 메뉴 원본 docs/SLASH-COMMANDS.md
declare module '*.md?raw' {
  const text: string;
  export default text;
}
