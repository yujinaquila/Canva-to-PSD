import { CanvaDesignAnalysis } from '../types';
import { SAMPLE_ANALYSES } from '../data/sampleDesigns';

// Generate a high-resolution canvas snapshot of any CanvaDesignAnalysis
export function renderAnalysisToDataUrl(analysis: CanvaDesignAnalysis): string {
  const canvas = document.createElement('canvas');
  canvas.width = analysis.width;
  canvas.height = analysis.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 1. Background
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
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Render Layers bottom-to-top
  for (const layer of analysis.layers) {
    if (!layer.visible) continue;
    if (layer.type === 'background') continue; // already drawn

    const x = layer.bounds.x;
    const y = layer.bounds.y;
    const w = layer.bounds.width;
    const h = layer.bounds.height;

    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;

    if (layer.shape) {
      const { shapeType, fillColor, strokeColor, strokeWidth = 0, borderRadius = 0, opacity = 1 } = layer.shape;
      ctx.globalAlpha = (layer.opacity ?? 1) * opacity;
      ctx.fillStyle = fillColor;

      const halfStroke = strokeWidth / 2;
      const drawW = w - strokeWidth;
      const drawH = h - strokeWidth;

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

    if (layer.text) {
      const { content, fontFamily, fontSize, fontWeight, color, alignment, lineHeight } = layer.text;
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';

      const weight = fontWeight || 'bold';
      const family = fontFamily ? `"${fontFamily}", sans-serif` : 'Montserrat, sans-serif';
      ctx.font = `${weight} ${fontSize}px ${family}`;

      const lines = content.split('\n');
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
        ctx.fillText(line, xPos, y + index * lineH);
      });
    }

    ctx.restore();
  }

  return canvas.toDataURL('image/png');
}

// Get or generate sample preview images
export function getSamplePreviewImage(sampleId: string): string {
  const analysis = SAMPLE_ANALYSES[sampleId];
  if (!analysis) return '';
  if (!analysis.previewUrl) {
    analysis.previewUrl = renderAnalysisToDataUrl(analysis);
  }
  return analysis.previewUrl;
}
