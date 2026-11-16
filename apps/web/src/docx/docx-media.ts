// docx 그림: 사진은 PNG · JPEG · GIF면 그대로, 그 밖(WebP · AVIF · SVG …)은 PNG로 바꾼다(워드가 못 여는 형식이 있다).
// 그래프 · 손글씨(SVG)는 2배로 그려 PNG로. 문서에는 글자 줄 안 그림(wp:inline)으로 넣는다.
import { esc, px2emu } from './ooxml';

export interface Media { readonly data: Uint8Array; readonly ext: 'png' | 'jpeg' | 'gif'; readonly w: number; readonly h: number }

const KEEP: Record<string, Media['ext']> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' };

async function toPng(src: CanvasImageSource, w: number, h: number, scale: number): Promise<Uint8Array | null> {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const g = c.getContext('2d');
  if (!g) return null;
  g.drawImage(src, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** 첨부 사진 → docx 그림 (모르는 형식이면 PNG로, 못 읽으면 null) */
export async function imageMedia(blob: Blob): Promise<Media | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const { width: w, height: h } = bmp;
    const keep = KEEP[blob.type];
    const data = keep ? new Uint8Array(await blob.arrayBuffer()) : await toPng(bmp, w, h, 1);
    bmp.close();
    return data ? { data, ext: keep ?? 'png', w, h } : null;
  } catch { return null; }
}

/** SVG 글 → PNG 그림 (그래프 · 손글씨). 2배로 그려 인쇄에서도 또렷하게 */
export async function svgMedia(svg: string, w: number, h: number): Promise<Media | null> {
  try {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const data = await toPng(img, w, h, 2);
    return data ? { data, ext: 'png', w, h } : null;
  } catch { return null; }
}

/** 글자 줄 안 그림 — wPx × hPx(화면 px)로, alt는 대체 텍스트 */
export function drawingXml(relId: string, n: number, wPx: number, hPx: number, alt: string): string {
  const cx = px2emu(wPx), cy = px2emu(hPx), d = esc(alt);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
    + `<wp:docPr id="${n}" name="그림 ${n}" descr="${d}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}" descr="${d}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
