import { createRoot } from 'react-dom/client';
import { setDefaultTextCodec, setDevChecks } from '@dn/engine-core';
import { pmCodec } from '@dn/text-pm';
import './tokens.css';
import '@dn/engine-dom/canvas.css';
import '@dn/engine-dom/db.css';
import '@dn/engine-dom/web.css';
import '@dn/engine-dom/caption.css';
import '@dn/text-pm/text.css';
import './styles.css';
import './side.css';
import './menus.css';
import './panels.css';
import './book.css';
import './calendar.css';
import './me.css';
import './ink.css';
import './doc-word.css';
import './mobile.css';
import './lock.css';
import './insert.css';
import './font-controls.css';
import './login.css';
import './export-dialog.css';
import './qa.css';
import './legal.css';
import './theme-dark.css';
import './canvas-settings.css';
import { applyTheme, storedTheme } from './theme';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';

// 첫 그리기 전에 테마 적용 (FR-086 — 어두운 테마에서 흰 화면이 번쩍이지 않게)
applyTheme(storedTheme());

// 텍스트 Op(ProseMirror 스텝)를 적용할 코덱 — 노트를 열기 전에 등록해야 로그 재생이 된다
setDefaultTextCodec(pmCodec);
// 개발 빌드에서만 엔진 레코드를 얼려 직접 변이 실수를 바로 잡는다 (ENGINE 2.4)
setDevChecks(import.meta.env.DEV);

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
