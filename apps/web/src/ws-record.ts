// 음성 녹음 (FR-043): 노트에서 바로 녹음 → 끝내면 녹음 파일 블록(재생 · 탐색 · 배속, 첨부 저장소 · 50MB 상한은 FR-052와 같다).
// 녹음기는 노트 화면이 아니라 워크스페이스에 있다 — 다른 노트로 옮겨 다녀도 녹음은 이어지고, 끝내면 시작한 노트로 돌아가 그 자리에 붙인다.
// 마이크 권한이 없거나 녹음할 수 없는 브라우저는 안내만. 녹음 중에 창을 닫으려 하면 브라우저가 한 번 묻는다.
import { formatDuration, screenToWorld, type Vec2 } from '@dn/engine-core';
import { MAX_FILE } from './ws-notes';
import { download } from './export';
import { SyncLayer } from './ws-sync';
import type { RecordingInfo } from './ws-model';
import type { SttLang } from './stt';

/** 녹음 파일 상한보다 조금 일찍 끊는다 (마지막 조각이 넘지 않게) */
const STOP_AT = MAX_FILE - 512 * 1024;
const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

interface Rec {
  mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; bytes: number;
  noteId: string; at: Vec2; startedAt: number; pausedMs: number; pauseAt: number | null; timer: ReturnType<typeof setInterval>;
  cancel: boolean;
}

export abstract class RecordLayer extends SyncLayer {
  private rec: Rec | null = null;

  /** 녹음 시작. `at`: 녹음 블록을 놓을 월드 좌표 (없으면 지금 화면 가운데) */
  async startRecording(at?: Vec2): Promise<void> {
    if (this.rec) { this.toast('이미 녹음하는 중이에요.'); return; }
    const o = this.open;
    if (!o || !this.canWrite(o)) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { this.toast('이 브라우저에서는 녹음할 수 없어요.'); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      this.toast(denied ? '마이크를 쓸 수 없어요 — 주소창 왼쪽의 사이트 권한에서 마이크를 허용해 주세요.' : '마이크를 찾지 못했어요. 연결을 확인해 주세요.');
      return;
    }
    if (this.rec || this.open !== o) { stream.getTracks().forEach((t) => t.stop()); return; }
    const mimeType = MIME.find((t) => MediaRecorder.isTypeSupported(t));
    const mr = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined);
    const v = o.view;
    const spot = at ?? screenToWorld(v.camera, { x: v.root.clientWidth / 2 - 180, y: v.root.clientHeight / 2 - 56 });
    const rec: Rec = {
      mr, stream, chunks: [], bytes: 0, noteId: o.engine.note.id, at: spot, startedAt: Date.now(), pausedMs: 0, pauseAt: null, cancel: false,
      timer: setInterval(() => this.publishRecording(), 500),
    };
    mr.addEventListener('dataavailable', (e) => {
      if (!e.data.size) return;
      rec.chunks.push(e.data);
      rec.bytes += e.data.size;
      if (rec.bytes >= STOP_AT && mr.state !== 'inactive') { this.toast('녹음 파일이 50MB에 가까워 녹음을 마쳤어요.'); void this.stopRecording(); }
    });
    // 기기가 마이크를 끊으면(다른 앱이 마이크를 가져감 · 앱이 오래 뒤로 감 등) 거기까지 저장하고 알린다 — 조용히 빈 녹음이 되지 않게
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (this.rec !== rec) return;
      void this.finishRecording('마이크가 끊겨 녹음을 마쳤어요 — ');
    });
    mr.start(1000);
    this.rec = rec;
    window.addEventListener('beforeunload', this.warnRecording);
    this.publishRecording();
  }

  pauseRecording(): void {
    const r = this.rec;
    if (!r || r.mr.state !== 'recording') return;
    r.mr.pause();
    r.pauseAt = Date.now();
    this.publishRecording();
  }

  resumeRecording(): void {
    const r = this.rec;
    if (!r || r.mr.state !== 'paused') return;
    r.mr.resume();
    if (r.pauseAt) r.pausedMs += Date.now() - r.pauseAt;
    r.pauseAt = null;
    this.publishRecording();
  }

  /** 녹음을 버린다 (블록을 만들지 않음) */
  cancelRecording(): void {
    const r = this.rec;
    if (!r) return;
    r.cancel = true;
    void this.finishRecording();
  }

  /** 녹음을 마치고 시작한 노트에 녹음 블록으로 붙인다 */
  stopRecording(): Promise<void> { return this.finishRecording(); }

  /** why: 사용자가 끝낸 게 아니면 그 까닭 (안내 앞에 붙인다) */
  private async finishRecording(why = ''): Promise<void> {
    const r = this.rec;
    if (!r) return;
    this.rec = null;
    clearInterval(r.timer);
    const elapsed = elapsedOf(r);
    // 창 닫기 확인은 녹음을 노트에 붙이거나 버릴 때까지 둔다
    try { await this.attachRecording(r, elapsed, why); } finally { window.removeEventListener('beforeunload', this.warnRecording); }
  }

  private async attachRecording(r: Rec, elapsed: number, why: string): Promise<void> {
    const done = new Promise<void>((res) => { if (r.mr.state === 'inactive') res(); else r.mr.addEventListener('stop', () => res(), { once: true }); });
    if (r.mr.state !== 'inactive') r.mr.stop();
    await done;
    r.stream.getTracks().forEach((t) => t.stop());
    this.set({ recording: null });
    if (r.cancel) { this.toast('녹음을 버렸어요.'); return; }
    const type = (r.mr.mimeType || r.chunks[0]?.type || 'audio/webm').split(';')[0]!;
    const blob = new Blob(r.chunks, { type });
    if (!blob.size) { this.toast('녹음된 소리가 없어요.'); return; }
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    const d = new Date(r.startedAt);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const file = new File([blob], `녹음 ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${ext}`, { type });
    // 다른 노트로 옮겼으면 시작한 노트로 돌아가서 붙인다 (지워졌으면 지금 노트에)
    const back = this.state.currentId !== r.noteId && this.state.notes.some((n) => n.id === r.noteId);
    if (back) await this.openById(r.noteId);
    const o = this.open;
    const ids = o && this.canWrite(o) ? await this.addFiles([file], r.at, { duration: elapsed / 1000 }) : [];
    if (ids.length) { this.toast(`${why}${back ? '녹음을 시작한 노트에 ' : ''}녹음(${formatDuration(elapsed / 1000)})을 붙였어요.`, { label: '글로 받아쓰기', run: () => this.transcribe(ids[0]!) }); return; }
    // 붙이지 못했다 (보기 전용 · 잠긴 노트 · 노트 없음) — 녹음을 버리지 않고 파일로 저장할 수 있게
    this.toast('녹음을 노트에 붙이지 못했어요 (보기 전용이거나 잠긴 노트). 파일로 저장해 두세요.', { label: '파일로 저장', run: () => download(file.name, file, file.type) });
  }

  get isRecording(): boolean { return !!this.rec; }

  /** 녹음 블록을 글로 받아쓰기 (FR-044, stt-flow.ts — workspace.ts가 잇는다) */
  abstract transcribe(blockId: string, lang?: SttLang): void;

  private publishRecording(): void {
    const r = this.rec;
    if (!r) return;
    const title = this.state.notes.find((n) => n.id === r.noteId)?.title || '제목 없음';
    const info: RecordingInfo = { noteId: r.noteId, title, elapsedMs: elapsedOf(r), paused: r.mr.state === 'paused', bytes: r.bytes };
    this.set({ recording: info });
  }

  private warnRecording = (e: BeforeUnloadEvent): void => { e.preventDefault(); e.returnValue = ''; };

  /** 앱을 닫을 때 (dispose): 녹음은 버린다 — 저장할 노트 화면이 사라진다 */
  protected stopRecorderOnDispose(): void {
    const r = this.rec;
    if (!r) return;
    this.rec = null;
    clearInterval(r.timer);
    window.removeEventListener('beforeunload', this.warnRecording);
    if (r.mr.state !== 'inactive') r.mr.stop();
    r.stream.getTracks().forEach((t) => t.stop());
  }
}

function elapsedOf(r: Rec): number {
  return Date.now() - r.startedAt - r.pausedMs - (r.pauseAt ? Date.now() - r.pauseAt : 0);
}
