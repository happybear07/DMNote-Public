// vite.config.ts의 define — 개발 서버가 `.env.local`의 Claude 키를 프록시로 붙여 줄 때만 값이 있다(키 자체는 없음, 끝 4자리만)
declare const __DN_ENV_KEY__: { last4: string } | null;
