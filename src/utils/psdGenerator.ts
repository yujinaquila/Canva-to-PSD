import { writePsdUint8Array, initializeCanvas, Layer, Psd } from 'ag-psd';
import { CanvaDesignAnalysis, DesignLayer } from '../types';

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
  const h = Math.max(2, Math.round(layer.bounds.height));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx || !layer.text) return canvas;

  const { content, fontFamily, fontSize, fontWeight, color, alignment, lineHeight } = layer.text;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';

  const weight = fontWeight || 'bold';
  const family = fontFamily ? `"${fontFamily}", sans-serif` : 'Montserrat, sans-serif';
  ctx.font = `${weight} ${fontSize}px ${family}`;

  const lines = content.split('\n');
  const lineH = lineHeight ? fontSize * lineHeight : fontSize * 1.25;

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

    ctx.fillText(line, xPos, index * lineH);
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

  const { shapeType, fillColor, strokeColor, strokeWidth = 0, borderRadius = 0, opacity = 1 } = layer.shape;

  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = opacity;
  ctx.fillStyle = fillColor;

  const halfStroke = strokeWidth / 2;
  const drawW = w - strokeWidth;
  const drawH = h - strokeWidth;

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
function renderBackgroundCanvas(analysis: CanvaDesignAnalysis): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = analysis.width;
  canvas.height = analysis.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

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

// Generate the complete Photoshop PSD Uint8Array
export async function generatePsdUint8Array(
  analysis: CanvaDesignAnalysis,
  referenceImageElement?: HTMLImageElement | null
): Promise<Uint8Array> {
  setupPsdCanvas();

  const width = Math.max(10, Math.round(analysis.width));
  const height = Math.max(10, Math.round(analysis.height));

  const typographyChildren: Layer[] = [];
  const graphicsChildren: Layer[] = [];
  const visualsChildren: Layer[] = [];
  const backgroundChildren: Layer[] = [];

  // 1. Process all visible layers in analysis
  for (const layer of analysis.layers) {
    if (!layer.visible) continue;

    const x = Math.round(layer.bounds.x);
    const y = Math.round(layer.bounds.y);
    const w = Math.max(2, Math.round(layer.bounds.width));
    const h = Math.max(2, Math.round(layer.bounds.height));

    if (layer.type === 'text' && layer.text) {
      const textColor = parseColor(layer.text.color);
      const textCanvas = renderTextToCanvas(layer, width, height);

      // Construct native Photoshop LayerTextData
      const psdLayer: Layer = {
        name: layer.name,
        opacity: layer.opacity ?? 1,
        left: x,
        top: y,
        canvas: textCanvas,
        text: {
          text: layer.text.content,
          transform: [1, 0, 0, 1, x, y + layer.text.fontSize],
          style: {
            font: { name: layer.text.fontFamily || 'Montserrat' },
            fontSize: layer.text.fontSize,
            fillColor: {
              r: textColor.r,
              g: textColor.g,
              b: textColor.b,
              a: textColor.a,
            },
          },
        },
      };

      typographyChildren.push(psdLayer);
    } else if ((layer.type === 'shape' || layer.type === 'badge') && layer.shape) {
      const shapeCanvas = renderShapeToCanvas(layer);
      const psdLayer: Layer = {
        name: layer.name,
        opacity: layer.opacity ?? (layer.shape.opacity || 1),
        left: x,
        top: y,
        canvas: shapeCanvas,
      };
      graphicsChildren.push(psdLayer);
    } else if (layer.type === 'image' && layer.imageDataUrl) {
      // Raster image cutout
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = layer.imageDataUrl!;
      });

      const imgCanvas = document.createElement('canvas');
      imgCanvas.width = w;
      imgCanvas.height = h;
      const ctx = imgCanvas.getContext('2d');
      if (ctx && img.complete) {
        ctx.drawImage(img, 0, 0, w, h);
      }

      const psdLayer: Layer = {
        name: layer.name,
        opacity: layer.opacity ?? 1,
        left: x,
        top: y,
        canvas: imgCanvas,
      };
      visualsChildren.push(psdLayer);
    } else if (layer.type === 'background') {
      const bgCanvas = renderBackgroundCanvas(analysis);
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
    const bgCanvas = renderBackgroundCanvas(analysis);
    backgroundChildren.push({
      name: 'Background Fill',
      left: 0,
      top: 0,
      canvas: bgCanvas,
      opacity: 1,
    });
  }

  // 2. Reference Layer (Hidden by default for 1:1 pixel comparison in Photoshop)
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

  // 3. Assemble Hierarchical Photoshop Document
  const rootChildren: Layer[] = [];

  // Top folder: Typography
  if (typographyChildren.length > 0) {
    rootChildren.push({
      name: '📁 Typography (Editable Text)',
      opened: true,
      children: typographyChildren.reverse(), // Top-down in Photoshop layer order
    });
  }

  // Middle folder: Graphics & Badges
  if (graphicsChildren.length > 0) {
    rootChildren.push({
      name: '📁 Graphics & Badges',
      opened: true,
      children: graphicsChildren.reverse(),
    });
  }

  // Lower folder: Visuals & Cutouts
  if (visualsChildren.length > 0) {
    rootChildren.push({
      name: '📁 Visuals & Cutouts',
      opened: true,
      children: visualsChildren.reverse(),
    });
  }

  // Bottom folder: Background
  rootChildren.push({
    name: '📁 Background',
    opened: true,
    children: backgroundChildren,
  });

  // Reference comparison layer (very bottom, hidden)
  if (referenceLayer) {
    rootChildren.push(referenceLayer);
  }

  const psd: Psd = {
    width,
    height,
    channels: 3,
    colorMode: COLOR_MODE_RGB as any,
    children: rootChildren,
  };

  // Generate PSD binary
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
