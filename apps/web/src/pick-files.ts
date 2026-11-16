// 숨은 파일 입력으로 고르기 창 띄우기 — 가져오기 · 동기화 파일 · 노트 커버 · 표지 그림 · 데이터베이스 파일 속성이 같이 쓴다.
// 문서에 붙여 둬야 폴더 고르기 · Safari에서 change가 확실히 온다. 고르지 않고 닫으면 null.
export function pickFiles(accept: string, opts: { multiple?: boolean; folder?: boolean } = {}): Promise<File[] | null> {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !!opts.multiple;
    if (opts.folder) input.setAttribute('webkitdirectory', '');
    else input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => { done([...(input.files ?? [])]); input.remove(); });
    input.addEventListener('cancel', () => { done(null); input.remove(); });
    input.click();
  });
}
