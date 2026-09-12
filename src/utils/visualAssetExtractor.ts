import { CanvaDesignAnalysis, DesignLayer } from '../types';

/**
 * Dynamically load Google Fonts used by the design so that canvas rendering
 * matches the exact typography of Canva.
 */
const loadedFontFamilies = new Set<string>();

export async function preloadDesignFonts(fontFamilies: string[]): Promise<void> {
  if (typeof document === 'undefined') return;

  const validFonts = fontFamilies
    .map((f) => f.trim())
    .filter(
      (f) =>
        f &&
        !['sans-serif', 'serif', 'monospace', 'system-ui', 'Arial', 'Helvetica', 'Times New Roman'].includes(f)
    );

  const newFonts = validFonts.filter((f) => !loadedFontFamilies.has(f));
  if (newFonts.length === 0) return;

  try {
    const formattedFonts = newFonts.map(
      (font) => `family=${encodeURIComponent(font)}:wght@400;500;600;700;800;900`
    );
    const href = `https://fonts.googleapis.com/css2?${formattedFonts.join('&')}&display=swap`;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);

    newFonts.forEach((f) => loadedFontFamilies.add(f));

    // Wait for fonts to finish loading
    if ('fonts' in document) {
      await (document as any).fonts.ready;
    }
  } catch (err) {
    console.warn('Font preloading notice:', err);
  }
}

/**
 * Load an image data URL or URL into an HTMLImageElement
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Failed to load image for extraction'));
    img.src = src;
  });
}

/**
 * Extract a high-resolution cutout slice from the source image for a given bounding box.
 * If borderRadius or shapeType is circular, applies a smooth antialiased clipping mask.
 */
export function extractImageCutout(
  sourceImg: HTMLImageElement,
  bounds: { x: number; y: number; width: number; height: number },
  options?: { borderRadius?: number; isCircle?: boolean }
): string {
  const sx = Math.max(0, Math.round(bounds.x));
  const sy = Math.max(0, Math.round(bounds.y));
  const sw = Math.min(Math.round(bounds.width), sourceImg.naturalWidth - sx);
  const sh = Math.min(Math.round(bounds.height), sourceImg.naturalHeight - sy);

  if (sw <= 2 || sh <= 2) return '';

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  if (options?.isCircle || (options?.borderRadius && options.borderRadius >= Math.min(sw, sh) / 2)) {
    ctx.beginPath();
    ctx.arc(sw / 2, sh / 2, Math.min(sw, sh) / 2, 0, Math.PI * 2);
    ctx.clip();
  } else if (options?.borderRadius && options.borderRadius > 0) {
    const r = Math.min(options.borderRadius, sw / 2, sh / 2);
    ctx.beginPath();
    ctx.roundRect(0, 0, sw, sh, r);
    ctx.clip();
  }

  ctx.drawImage(sourceImg, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/png', 0.95);
}

/**
 * Generate a smart inpainting / text-healed background from the original image.
 * This covers the original flat text regions so that editable text layers on top
 * do not produce blurry double-text artifacts when moved or edited.
 */
export function generateSmartCleanBackground(
  sourceImg: HTMLImageElement,
  textLayers: DesignLayer[],
  fallbackBgColor: string
): string {
  const w = sourceImg.naturalWidth;
  const h = sourceImg.naturalHeight;
  if (!w || !h) return '';

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Draw full source image
  ctx.drawImage(sourceImg, 0, 0, w, h);

  // Softly heal each text layer bounding box by sampling local background
  for (const layer of textLayers) {
    if (!layer.text || !layer.visible) continue;

    const bx = Math.max(0, Math.round(layer.bounds.x - 4));
    const by = Math.max(0, Math.round(layer.bounds.y - 4));
    const bw = Math.min(Math.round(layer.bounds.width + 8), w - bx);
    const bh = Math.min(Math.round(layer.bounds.height + 8), h - by);

    if (bw <= 0 || bh <= 0) continue;

    try {
      // Sample pixels from immediately outside the box (top edge and bottom edge)
      const sampleYTop = Math.max(0, by - 6);
      const sampleYBottom = Math.min(h - 1, by + bh + 4);
      const topPixel = ctx.getImageData(Math.min(w - 1, bx + Math.round(bw / 2)), sampleYTop, 1, 1).data;
      const bottomPixel = ctx.getImageData(Math.min(w - 1, bx + Math.round(bw / 2)), sampleYBottom, 1, 1).data;

      const topColor = `rgb(${topPixel[0]}, ${topPixel[1]}, ${topPixel[2]})`;
      const bottomColor = `rgb(${bottomPixel[0]}, ${bottomPixel[1]}, ${bottomPixel[2]})`;

      const grad = ctx.createLinearGradient(bx, by, bx, by + bh);
      grad.addColorStop(0, topColor);
      grad.addColorStop(1, bottomColor);

      ctx.save();
      ctx.fillStyle = grad;
      ctx.fillRect(bx, by, bw, bh);

      // Smooth blending blur on edges
      ctx.filter = 'blur(4px)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.restore();
    } catch {
      // If sampling fails, use fallback background color
      ctx.fillStyle = fallbackBgColor || '#0F172A';
      ctx.fillRect(bx, by, bw, bh);
    }
  }

  return canvas.toDataURL('image/png', 0.9);
}

/**
 * Enriches the raw Gemini analysis with extracted high-resolution visual assets,
 * precise coordinate scaling, font pre-loading, and smart background layers.
 */
export async function enrichAnalysisWithVisualAssets(
  rawAnalysis: CanvaDesignAnalysis,
  sourceImageBase64: string
): Promise<CanvaDesignAnalysis> {
  const analysis: CanvaDesignAnalysis = JSON.parse(JSON.stringify(rawAnalysis));

  let sourceImg: HTMLImageElement | null = null;
  try {
    sourceImg = await loadImage(sourceImageBase64);
  } catch (err) {
    console.warn('Could not load source image for cutout extraction:', err);
    return analysis;
  }

  const realWidth = sourceImg.naturalWidth || analysis.width;
  const realHeight = sourceImg.naturalHeight || analysis.height;

  // 1. Recalibrate coordinates if dimensions differ
  const scaleX = realWidth / (analysis.width || realWidth);
  const scaleY = realHeight / (analysis.height || realHeight);

  analysis.width = realWidth;
  analysis.height = realHeight;
  analysis.aspectRatio = `${realWidth}:${realHeight}`;

  if (Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01) {
    for (const layer of analysis.layers) {
      layer.bounds.x = Math.round(layer.bounds.x * scaleX);
      layer.bounds.y = Math.round(layer.bounds.y * scaleY);
      layer.bounds.width = Math.round(layer.bounds.width * scaleX);
      layer.bounds.height = Math.round(layer.bounds.height * scaleY);

      if (layer.text) {
        layer.text.fontSize = Math.round(layer.text.fontSize * scaleY);
      }
      if (layer.shape?.borderRadius) {
        layer.shape.borderRadius = Math.round(layer.shape.borderRadius * Math.min(scaleX, scaleY));
      }
    }
  }

  // 2. Extract visual cutouts for all image/photo/illustration layers
  const textLayers: DesignLayer[] = [];
  const extractedFonts: string[] = [];

  for (const layer of analysis.layers) {
    if (layer.text) {
      textLayers.push(layer);
      if (layer.text.fontFamily) {
        extractedFonts.push(layer.text.fontFamily);
      }
    }

    // Identify layers that represent visual artwork, photos, illustrations, icons, or cutouts
    const isVisual =
      layer.type === 'image' ||
      layer.group === 'Visuals' ||
      layer.isOriginalCutout ||
      (!layer.text && !layer.shape && layer.type !== 'background');

    if (isVisual) {
      layer.type = 'image';
      layer.group = 'Visuals';

      const isCircle = layer.shape?.shapeType === 'circle';
      const borderRadius = layer.shape?.borderRadius;

      const cutoutDataUrl = extractImageCutout(sourceImg, layer.bounds, {
        isCircle,
        borderRadius,
      });

      if (cutoutDataUrl) {
        layer.imageDataUrl = cutoutDataUrl;
        layer.isOriginalCutout = true;
      }
    }
  }

  // 3. Preload all Google Fonts detected in the design
  if (extractedFonts.length > 0) {
    preloadDesignFonts(extractedFonts);
  }

  // 4. Set original and smart cleaned background
  analysis.backgroundImageUrl = sourceImageBase64;
  analysis.previewUrl = sourceImageBase64;

  try {
    const cleanBg = generateSmartCleanBackground(sourceImg, textLayers, analysis.backgroundColor);
    if (cleanBg) {
      analysis.cleanBackgroundUrl = cleanBg;
    }
  } catch (err) {
    console.warn('Smart background generation notice:', err);
  }

  return analysis;
}
