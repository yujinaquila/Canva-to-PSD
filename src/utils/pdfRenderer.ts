import * as pdfjsLib from 'pdfjs-dist';

// Use standard CDN or unpkg worker that matches exact pdfjs-dist version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface RenderedPdfResult {
  dataUrl: string;
  width: number;
  height: number;
  totalPages: number;
  pageNumber: number;
}

/**
 * Render a specific page of a PDF file to a high-resolution PNG data URL
 */
export async function renderPdfPageToDataUrl(
  pdfInput: ArrayBuffer | Uint8Array,
  pageNumber: number = 1,
  targetDpiScale: number = 2.0
): Promise<RenderedPdfResult> {
  const loadingTask = pdfjsLib.getDocument({
    data: pdfInput instanceof Uint8Array ? pdfInput : new Uint8Array(pdfInput),
    cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
  });

  const pdfDoc = await loadingTask.promise;
  const totalPages = pdfDoc.numPages;
  const validPageNum = Math.min(Math.max(1, pageNumber), totalPages);

  const page = await pdfDoc.getPage(validPageNum);

  // Unscaled viewport to determine base canvas dimensions
  const baseViewport = page.getViewport({ scale: 1.0 });
  const baseWidth = Math.round(baseViewport.width);
  const baseHeight = Math.round(baseViewport.height);

  // Scaled viewport for crisp rendering (retina scale)
  const scale = targetDpiScale;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Failed to create 2D canvas context for PDF rendering');
  }

  // White base background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const renderContext = {
    canvas,
    canvasContext: ctx,
    viewport,
  };

  await page.render(renderContext).promise;

  const dataUrl = canvas.toDataURL('image/png', 0.95);

  return {
    dataUrl,
    width: baseWidth,
    height: baseHeight,
    totalPages,
    pageNumber: validPageNum,
  };
}
