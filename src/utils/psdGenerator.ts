import { writePsdUint8Array, initializeCanvas, Layer, Psd } from 'ag-psd';
import { CanvaDesignAnalysis, DesignLayer } from '../types';
import { preloadDesignFonts } from './visualAssetExtractor';

// Photoshop ColorMode enum values: Bitmap=0, Grayscale=1, Indexed=2, RGB=3, CMYK=4
const COLOR_MODE_RGB = 3;

// Initialize canvas provider for ag-psd in browser environment
let canvasInitialized = false;
export function setupPsdCanvas() {
  if (canvasInitialized) return;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    initializeCanvas(
      (width: number, height: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        return canvas;
      },
      (width: number, height: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        const ctx = canvas.getContext('2d');
        return ctx?.createImageData(width, height) || new ImageData(width, height);
      }
    );
    canvasInitialized = true;
  }
}

// Convert hex color (#RRGGBB or #RGB or rgb/rgba) to { r, g, b, a }
export function parseColor(colorStr: string): { r: number; g: number; b: number; a: number } {
  if (!colorStr) return { r: 255, g: 255, b: 255, a: 1 };

  let str = colorStr.trim();

  // Handle #RRGGBB or #RGB
  if (str.startsWith('#')) {
    let hex = str.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16) || 0;
      const g = parseInt(hex.slice(2, 4), 16) || 0;
      const b = parseInt(hex.slice(4, 6), 16) || 0;
      let a = 1;
      if (hex.length === 8) {
        a = (parseInt(hex.slice(6, 8), 16) || 255) / 255;
      }
      return { r, g, b, a };
    }
  }

  // Handle rgb(...) / rgba(...)
  const rgbaMatch = str.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1], 10),
      g: parseInt(rgbaMatch[2], 10),
      b: parseInt(rgbaMatch[3], 10),
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
    };
  }

  return { r: 255, g: 255, b: 255, a: 1 };
}

// Render text layer to a transparent canvas for visual preview fallback
function renderTextToCanvas(
  layer: DesignLayer,
  canvasWidth: number,
  canvasHeight: number
): HTMLCanvasElement {
  const w = Math.max(2, Math.round(layer.bounds.width));
  const rawH = Math.max(2, Math.round(layer.bounds.height));

  if (!layer.text) {
    const emptyCanvas = document.createElement('canvas');
    emptyCanvas.width = w;
    emptyCanvas.height = rawH;
    return emptyCanvas;
  }

  const {
    content,
    fontFamily,
    fontSize,
    fontWeight,
    color,
    alignment,
    lineHeight,
    textTransform,
    strokeColor,
    strokeWidth = 0,
    textShadow,
    letterSpacing,
  } = layer.text;

  let finalContent = content;
  if (textTransform === 'uppercase') {
    finalContent = content.toUpperCase();
  } else if (textTransform === 'lowercase') {
    finalContent = content.toLowerCase();
  }

  const lines = finalContent.split('\n');
  const lineH = lineHeight ? fontSize * lineHeight : fontSize * 1.25;

  // Extra height buffer for descenders (g, y, p, q) and soft drop shadows
  const extraShadowBlur = textShadow ? Math.abs(textShadow.blur) * 2 + Math.abs(textShadow.offsetY || 0) : 0;
  const neededH = Math.ceil(lines.length * lineH + extraShadowBlur + (strokeWidth || 0) * 2);
  const h = Math.max(rawH, neededH);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';

  const weight = fontWeight || 'bold';
  const family = fontFamily ? `"${fontFamily}", sans-serif` : 'Montserrat, sans-serif';
  ctx.font = `${weight} ${fontSize}px ${family}`;

  if (letterSpacing && (ctx as any).letterSpacing !== undefined) {
    (ctx as any).letterSpacing = `${letterSpacing}px`;
  }

  if (textShadow) {
    ctx.shadowColor = textShadow.color;
    ctx.shadowBlur = textShadow.blur;
    ctx.shadowOffsetX = textShadow.offsetX;
    ctx.shadowOffsetY = textShadow.offsetY;
  }

  lines.forEach((line, index) => {
    let xPos = 0;
    if (alignment === 'center') {
      ctx.textAlign = 'center';
      xPos = w / 2;
    } else if (alignment === 'right') {
      ctx.textAlign = 'right';
      xPos = w;
    } else {
      ctx.textAlign = 'left';
      xPos = 0;
    }

    const yPos = index * lineH;

    if (strokeColor && strokeWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.strokeText(line, xPos, yPos);
    }

    ctx.fillText(line, xPos, yPos);
  });

  return canvas;
}

// Render shape layer to a transparent canvas
function renderShapeToCanvas(layer: DesignLayer): HTMLCanvasElement {
  const w = Math.max(2, Math.round(layer.bounds.width));
  const h = Math.max(2, Math.round(layer.bounds.height));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx || !layer.shape) return canvas;

  const {
    shapeType,
    fillColor,
    gradientColors,
    gradientAngle,
    strokeColor,
    strokeWidth = 0,
    borderRadius = 0,
    opacity = 1,
    boxShadow,
  } = layer.shape;

  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = opacity;

  // Drop shadow
  if (boxShadow) {
    ctx.shadowColor = boxShadow.color;
    ctx.shadowBlur = boxShadow.blur;
    ctx.shadowOffsetX = boxShadow.offsetX;
    ctx.shadowOffsetY = boxShadow.offsetY;
  }

  // Fill gradient or solid color
  if (gradientColors && gradientColors.length >= 2) {
    const angleRad = ((gradientAngle ?? 135) * Math.PI) / 180;
    const x1 = Math.round(w / 2 - (Math.cos(angleRad) * w) / 2);
    const y1 = Math.round(h / 2 - (Math.sin(angleRad) * h) / 2);
    const x2 = Math.round(w / 2 + (Math.cos(angleRad) * w) / 2);
    const y2 = Math.round(h / 2 + (Math.sin(angleRad) * h) / 2);

    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    const step = 1 / (gradientColors.length - 1);
    gradientColors.forEach((col, idx) => grad.addColorStop(idx * step, col));
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = fillColor || '#3B82F6';
  }

  const halfStroke = strokeWidth / 2;
  const drawW = Math.max(1, w - strokeWidth);
  const drawH = Math.max(1, h - strokeWidth);

  if (shapeType === 'circle' || (shapeType === 'badge' && Math.abs(w - h) < 20)) {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - halfStroke, 0, Math.PI * 2);
    ctx.fill();
    if (strokeColor && strokeWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  } else if (shapeType === 'rounded-rectangle' || borderRadius > 0) {
    const r = Math.min(borderRadius, w / 2, h / 2);
    ctx.beginPath();
    ctx.roundRect(halfStroke, halfStroke, drawW, drawH, r);
    ctx.fill();
    if (strokeColor && strokeWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  } else if (shapeType === 'line') {
    ctx.strokeStyle = fillColor || strokeColor || '#000000';
    ctx.lineWidth = Math.max(1, h);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  } else {
    // Standard rectangle
    ctx.fillRect(halfStroke, halfStroke, drawW, drawH);
    if (strokeColor && strokeWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.strokeRect(halfStroke, halfStroke, drawW, drawH);
    }
  }

  return canvas;
}

// Render background canvas
async function renderBackgroundCanvas(
  analysis: CanvaDesignAnalysis
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = analysis.width;
  canvas.height = analysis.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // 1. If we have a clean background (text removed), use it
  if (analysis.cleanBackgroundUrl) {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject();
        img.src = analysis.cleanBackgroundUrl!;
      });
      ctx.drawImage(img, 0, 0, analysis.width, analysis.height);
      return canvas;
    } catch {
      // Fall back to gradient/solid
    }
  }

  // 2. Dedicated background image
  if (analysis.backgroundImageUrl) {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject();
        img.src = analysis.backgroundImageUrl!;
      });
      ctx.drawImage(img, 0, 0, analysis.width, analysis.height);
      return canvas;
    } catch {
      // Fall back to gradient/solid
    }
  }

  // 3. Mathematical CSS gradient
  if (analysis.backgroundType === 'gradient' && analysis.gradientColors && analysis.gradientColors.length >= 2) {
    const angleRad = ((analysis.gradientAngle || 135) * Math.PI) / 180;
    const x1 = Math.round(canvas.width / 2 - (Math.cos(angleRad) * canvas.width) / 2);
    const y1 = Math.round(canvas.height / 2 - (Math.sin(angleRad) * canvas.height) / 2);
    const x2 = Math.round(canvas.width / 2 + (Math.cos(angleRad) * canvas.width) / 2);
    const y2 = Math.round(canvas.height / 2 + (Math.sin(angleRad) * canvas.height) / 2);

    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    const step = 1 / (analysis.gradientColors.length - 1);
    analysis.gradientColors.forEach((color, i) => {
      grad.addColorStop(i * step, color);
    });
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = analysis.backgroundColor || '#0F172A';
  }

  ctx.fillRect(0, 0, analysis.width, analysis.height);
  return canvas;
}

// Render complete composite preview canvas matching website preview 1:1
export async function renderCompositePreviewCanvas(
  analysis: CanvaDesignAnalysis
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = analysis.width;
  canvas.height = analysis.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // 1. Draw Background
  const bgImgUrl = analysis.cleanBackgroundUrl || analysis.backgroundImageUrl;
  let bgDrawn = false;
  if (bgImgUrl) {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject();
        img.src = bgImgUrl;
      });
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        bgDrawn = true;
      }
    } catch {
      bgDrawn = false;
    }
  }

  if (!bgDrawn) {
    if (analysis.backgroundType === 'gradient' && analysis.gradientColors && analysis.gradientColors.length >= 2) {
      const angleRad = ((analysis.gradientAngle || 135) * Math.PI) / 180;
      const x1 = Math.round(canvas.width / 2 - (Math.cos(angleRad) * canvas.width) / 2);
      const y1 = Math.round(canvas.height / 2 - (Math.sin(angleRad) * canvas.height) / 2);
      const x2 = Math.round(canvas.width / 2 + (Math.cos(angleRad) * canvas.width) / 2);
      const y2 = Math.round(canvas.height / 2 + (Math.sin(angleRad) * canvas.height) / 2);

      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      const step = 1 / (analysis.gradientColors.length - 1);
      analysis.gradientColors.forEach((col, idx) => grad.addColorStop(idx * step, col));
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = analysis.backgroundColor || '#0F172A';
    }
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // 2. Render Layers in ascending z-index order
  for (const layer of analysis.layers) {
    if (!layer.visible || layer.type === 'background') continue;

    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    const { x, y, width: w, height: h } = layer.bounds;

    // A. Shape / Badge
    if (layer.shape) {
      const {
        shapeType,
        fillColor,
        gradientColors,
        gradientAngle,
        strokeColor,
        strokeWidth = 0,
        borderRadius = 0,
        boxShadow,
      } = layer.shape;

      if (boxShadow) {
        ctx.shadowColor = boxShadow.color;
        ctx.shadowBlur = boxShadow.blur;
        ctx.shadowOffsetX = boxShadow.offsetX;
        ctx.shadowOffsetY = boxShadow.offsetY;
      }

      if (gradientColors && gradientColors.length >= 2) {
        const angleRad = ((gradientAngle ?? 135) * Math.PI) / 180;
        const x1 = Math.round(x + w / 2 - (Math.cos(angleRad) * w) / 2);
        const y1 = Math.round(y + h / 2 - (Math.sin(angleRad) * h) / 2);
        const x2 = Math.round(x + w / 2 + (Math.cos(angleRad) * w) / 2);
        const y2 = Math.round(y + h / 2 + (Math.sin(angleRad) * h) / 2);

        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        const step = 1 / (gradientColors.length - 1);
        gradientColors.forEach((col, idx) => grad.addColorStop(idx * step, col));
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = fillColor || '#3B82F6';
      }

      const halfStroke = strokeWidth / 2;
      const drawW = Math.max(1, w - strokeWidth);
      const drawH = Math.max(1, h - strokeWidth);

      if (shapeType === 'circle' || (shapeType === 'badge' && Math.abs(w - h) < 20)) {
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2 - halfStroke, 0, Math.PI * 2);
        ctx.fill();
        if (strokeColor && strokeWidth > 0) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.stroke();
        }
      } else if (shapeType === 'rounded-rectangle' || borderRadius > 0) {
        const r = Math.min(borderRadius, w / 2, h / 2);
        ctx.beginPath();
        ctx.roundRect(x + halfStroke, y + halfStroke, drawW, drawH, r);
        ctx.fill();
        if (strokeColor && strokeWidth > 0) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.stroke();
        }
      } else if (shapeType === 'line') {
        ctx.strokeStyle = fillColor || strokeColor || '#FFFFFF';
        ctx.lineWidth = Math.max(1, h);
        ctx.beginPath();
        ctx.moveTo(x, y + h / 2);
        ctx.lineTo(x + w, y + h / 2);
        ctx.stroke();
      } else {
        ctx.fillRect(x + halfStroke, y + halfStroke, drawW, drawH);
        if (strokeColor && strokeWidth > 0) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.strokeRect(x + halfStroke, y + halfStroke, drawW, drawH);
        }
      }
    }

    // B. Visual Cutout / Image
    if (layer.imageDataUrl) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = layer.imageDataUrl!;
        });
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, x, y, w, h);
        }
      } catch {
        // Skip cutout error
      }
    }

    // C. Text Rendering
    if (layer.text) {
      const {
        content,
        fontFamily,
        fontSize,
        fontWeight,
        color,
        alignment,
        lineHeight,
        textTransform,
        textShadow,
        strokeColor,
        strokeWidth = 0,
        letterSpacing,
      } = layer.text;

      ctx.fillStyle = color;
      ctx.textBaseline = 'top';

      const weight = fontWeight || 'bold';
      const family = fontFamily ? `"${fontFamily}", sans-serif` : 'Montserrat, sans-serif';
      ctx.font = `${weight} ${fontSize}px ${family}`;

      if (letterSpacing && (ctx as any).letterSpacing !== undefined) {
        (ctx as any).letterSpacing = `${letterSpacing}px`;
      }

      if (textShadow) {
        ctx.shadowColor = textShadow.color;
        ctx.shadowBlur = textShadow.blur;
        ctx.shadowOffsetX = textShadow.offsetX;
        ctx.shadowOffsetY = textShadow.offsetY;
      }

      let finalContent = content;
      if (textTransform === 'uppercase') {
        finalContent = content.toUpperCase();
      } else if (textTransform === 'lowercase') {
        finalContent = content.toLowerCase();
      }

      const lines = finalContent.split('\n');
      const lineH = lineHeight ? fontSize * lineHeight : fontSize * 1.25;

      lines.forEach((line, index) => {
        let xPos = x;
        if (alignment === 'center') {
          ctx.textAlign = 'center';
          xPos = x + w / 2;
        } else if (alignment === 'right') {
          ctx.textAlign = 'right';
          xPos = x + w;
        } else {
          ctx.textAlign = 'left';
          xPos = x;
        }

        const yPos = y + index * lineH;

        if (strokeColor && strokeWidth > 0) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.strokeText(line, xPos, yPos);
        }

        ctx.fillText(line, xPos, yPos);
      });
    }

    ctx.restore();
  }

  return canvas;
}

// Generate the complete Photoshop PSD Uint8Array
export async function generatePsdUint8Array(
  analysis: CanvaDesignAnalysis,
  referenceImageElement?: HTMLImageElement | null,
  livePreviewCanvas?: HTMLCanvasElement | null
): Promise<Uint8Array> {
  setupPsdCanvas();

  const width = Math.max(10, Math.round(analysis.width));
  const height = Math.max(10, Math.round(analysis.height));

  // 1. Preload any Google Fonts in design so canvas rasterization uses correct typography
  const fontFamilies = analysis.layers
    .map((l) => l.text?.fontFamily)
    .filter((f): f is string => Boolean(f));
  if (fontFamilies.length > 0) {
    try {
      await preloadDesignFonts(fontFamilies);
    } catch {
      // Font preload non-blocking fallback
    }
  }

  // 2. Generate composite canvas matching website preview 1:1
  let compositeCanvas: HTMLCanvasElement;
  if (livePreviewCanvas && livePreviewCanvas.width > 0 && livePreviewCanvas.height > 0) {
    compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = width;
    compositeCanvas.height = height;
    const cCtx = compositeCanvas.getContext('2d');
    if (cCtx) {
      cCtx.drawImage(livePreviewCanvas, 0, 0, width, height);
    }
  } else {
    compositeCanvas = await renderCompositePreviewCanvas(analysis);
  }

  const typographyChildren: Layer[] = [];
  const graphicsChildren: Layer[] = [];
  const visualsChildren: Layer[] = [];
  const backgroundChildren: Layer[] = [];

  // 3. Process all visible layers in ascending order (bottom-to-top)
  for (const layer of analysis.layers) {
    if (!layer.visible) continue;

    const x = Math.round(layer.bounds.x);
    const y = Math.round(layer.bounds.y);
    const w = Math.max(2, Math.round(layer.bounds.width));
    const h = Math.max(2, Math.round(layer.bounds.height));

    // A. Text Layer
    if (layer.type === 'text' && layer.text) {
      const textColor = parseColor(layer.text.color);
      const textCanvas = renderTextToCanvas(layer, width, height);

      const alignment = layer.text.alignment || 'left';
      let textOriginX = x;
      let justification: 'left' | 'center' | 'right' = 'left';
      if (alignment === 'center') {
        textOriginX = x + w / 2;
        justification = 'center';
      } else if (alignment === 'right') {
        textOriginX = x + w;
        justification = 'right';
      }

      const textOriginY = y + layer.text.fontSize;

      // Construct native Photoshop LayerTextData with proper justification and style
      const psdLayer: Layer = {
        name: layer.name,
        opacity: layer.opacity ?? 1,
        left: x,
        top: y,
        canvas: textCanvas,
        text: {
          text: layer.text.content,
          transform: [1, 0, 0, 1, textOriginX, textOriginY],
          paragraphStyle: {
            justification,
          },
          style: {
            font: { name: layer.text.fontFamily || 'Montserrat' },
            fontSize: layer.text.fontSize,
            fillColor: {
              r: textColor.r,
              g: textColor.g,
              b: textColor.b,
              a: textColor.a,
            },
            fauxBold:
              layer.text.fontWeight === 'bold' ||
              layer.text.fontWeight === '900' ||
              layer.text.fontWeight === '800',
          },
        },
      };

      typographyChildren.push(psdLayer);
    }
    // B. Visual Cutout / Image (prioritize extracted image cutout if present)
    else if (layer.imageDataUrl || layer.type === 'image') {
      const imgCanvas = document.createElement('canvas');
      imgCanvas.width = w;
      imgCanvas.height = h;
      const ctx = imgCanvas.getContext('2d');

      if (layer.imageDataUrl) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = layer.imageDataUrl!;
        });

        if (ctx && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, 0, 0, w, h);
        }
      }

      const psdLayer: Layer = {
        name: layer.name,
        opacity: layer.opacity ?? 1,
        left: x,
        top: y,
        canvas: imgCanvas,
      };
      visualsChildren.push(psdLayer);
    }
    // C. Shape / Badge Layer
    else if ((layer.type === 'shape' || layer.type === 'badge') && layer.shape) {
      const shapeCanvas = renderShapeToCanvas(layer);
      const psdLayer: Layer = {
        name: layer.name,
        opacity: layer.opacity ?? (layer.shape.opacity || 1),
        left: x,
        top: y,
        canvas: shapeCanvas,
      };
      graphicsChildren.push(psdLayer);
    }
    // D. Background Layer
    else if (layer.type === 'background') {
      const bgCanvas = await renderBackgroundCanvas(analysis);
      const psdLayer: Layer = {
        name: layer.name || 'Background Canvas',
        opacity: layer.opacity ?? 1,
        left: 0,
        top: 0,
        canvas: bgCanvas,
      };
      backgroundChildren.push(psdLayer);
    }
  }

  // Ensure there's always at least a base background canvas
  if (backgroundChildren.length === 0) {
    const bgCanvas = await renderBackgroundCanvas(analysis);
    backgroundChildren.push({
      name: 'Background Fill',
      left: 0,
      top: 0,
      canvas: bgCanvas,
      opacity: 1,
    });
  }

  // 4. Reference Layer (Hidden by default for 1:1 pixel comparison in Photoshop)
  let referenceLayer: Layer | null = null;
  if (referenceImageElement && referenceImageElement.complete) {
    const refCanvas = document.createElement('canvas');
    refCanvas.width = width;
    refCanvas.height = height;
    const refCtx = refCanvas.getContext('2d');
    if (refCtx) {
      refCtx.drawImage(referenceImageElement, 0, 0, width, height);
      referenceLayer = {
        name: 'Canva Original Flat Reference [Hidden]',
        left: 0,
        top: 0,
        canvas: refCanvas,
        hidden: true,
        opacity: 0.8,
      };
    }
  }

  // 5. Assemble Hierarchical Photoshop Document
  // In Photoshop PSD structure, Record 0 is the BOTTOM layer of the document.
  // We assemble the folders in true ascending Z-order (Background -> Visuals -> Graphics -> Typography -> Reference):
  const rootChildren: Layer[] = [];

  // Bottom folder: Background (Record 0)
  if (backgroundChildren.length > 0) {
    rootChildren.push({
      name: '📁 Background',
      opened: true,
      children: backgroundChildren, // Ascending order
    });
  }

  // Folder above Background: Visuals & Cutouts
  if (visualsChildren.length > 0) {
    rootChildren.push({
      name: '📁 Visuals & Cutouts',
      opened: true,
      children: visualsChildren, // Ascending order
    });
  }

  // Folder above Visuals: Graphics & Badges
  if (graphicsChildren.length > 0) {
    rootChildren.push({
      name: '📁 Graphics & Badges',
      opened: true,
      children: graphicsChildren, // Ascending order
    });
  }

  // Top folder: Typography (Editable Text)
  if (typographyChildren.length > 0) {
    rootChildren.push({
      name: '📁 Typography (Editable Text)',
      opened: true,
      children: typographyChildren, // Ascending order
    });
  }

  // Reference comparison overlay at the very top of the stack (hidden by default)
  if (referenceLayer) {
    rootChildren.push(referenceLayer);
  }

  const psd: Psd = {
    width,
    height,
    channels: 3,
    colorMode: COLOR_MODE_RGB as any,
    canvas: compositeCanvas,
    children: rootChildren,
  };

  // Generate PSD binary with thumbnail
  const psdUint8Array = writePsdUint8Array(psd, {
    generateThumbnail: true,
    trimImageData: false,
  });

  return psdUint8Array;
}

// Helper to trigger direct .psd file download in browser
export function downloadPsdFile(psdData: Uint8Array, filename: string) {
  const blob = new Blob([psdData], { type: 'image/vnd.adobe.photoshop' });
  const cleanName = filename.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${cleanName || 'canva_converted'}.psd`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Helper to open generated PSD directly in Photopea (Online Photoshop clone)
export function openInPhotopea(psdData: Uint8Array) {
  const blob = new Blob([psdData], { type: 'image/vnd.adobe.photoshop' });
  const reader = new FileReader();
  reader.onloadend = () => {
    const base64data = (reader.result as string).split(',')[1];
    const photopeaConfig = {
      files: [`data:image/vnd.adobe.photoshop;base64,${base64data}`],
      environment: {
        theme: 1,
        autosave: 0,
      },
    };
    const url = `https://www.photopea.com#${encodeURIComponent(JSON.stringify(photopeaConfig))}`;
    window.open(url, '_blank');
  };
  reader.readAsDataURL(blob);
}
