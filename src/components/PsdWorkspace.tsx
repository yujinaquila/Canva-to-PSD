import React, { useState, useRef, useEffect } from 'react';
import {
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Type,
  Square,
  Image as ImageIcon,
  Folder,
  FolderOpen,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sliders,
  Palette,
  ArrowLeft,
  Check,
  Copy,
  Sparkles,
  Layers,
  FileImage,
  RefreshCw,
  Columns2,
} from 'lucide-react';
import { CanvaDesignAnalysis, DesignLayer } from '../types';
import { generatePsdUint8Array, downloadPsdFile, openInPhotopea } from '../utils/psdGenerator';

interface PsdWorkspaceProps {
  initialAnalysis: CanvaDesignAnalysis;
  originalImageBase64?: string;
  onReset: () => void;
  docInfo?: {
    totalPages?: number;
    currentPage?: number;
    onSelectPage?: (pageNumber: number) => void;
  };
}

const FONT_OPTIONS = [
  'Montserrat',
  'Poppins',
  'Plus Jakarta Sans',
  'Playfair Display',
  'Roboto',
  'Oswald',
  'Bebas Neue',
  'Inter',
  'Lato',
  'Arial',
];

export const PsdWorkspace: React.FC<PsdWorkspaceProps> = ({
  initialAnalysis,
  originalImageBase64,
  onReset,
  docInfo,
}) => {
  const [analysis, setAnalysis] = useState<CanvaDesignAnalysis>(initialAnalysis);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(
    analysis.layers.find((l) => l.type === 'text')?.id || analysis.layers[0]?.id || null
  );
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<'layers' | 'compare' | 'original'>('layers');
  const [comparePosition, setComparePosition] = useState(50); // percentage for split comparison
  const [isExporting, setIsExporting] = useState(false);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const referenceImgRef = useRef<HTMLImageElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Load original image for reference comparison
  useEffect(() => {
    if (originalImageBase64) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = originalImageBase64;
      img.onload = () => {
        referenceImgRef.current = img;
        drawCanvas();
      };
    }
  }, [originalImageBase64]);

  // Image loader helper for cutouts and backgrounds
  const getLoadedImage = (url?: string): HTMLImageElement | null => {
    if (!url) return null;
    const existing = imageCacheRef.current.get(url);
    if (existing && existing.complete && existing.naturalWidth > 0) {
      return existing;
    }
    if (!existing) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        drawCanvas();
      };
      img.src = url;
      imageCacheRef.current.set(url, img);
    }
    return null;
  };

  // Fit canvas to viewport on mount
  useEffect(() => {
    if (canvasContainerRef.current) {
      const { clientWidth, clientHeight } = canvasContainerRef.current;
      const scaleX = (clientWidth - 48) / analysis.width;
      const scaleY = (clientHeight - 48) / analysis.height;
      const initialFit = Math.min(scaleX, scaleY, 0.95);
      setZoom(Math.max(0.2, Math.min(initialFit, 1)));
    }
  }, [analysis.width, analysis.height]);

  // Redraw canvas whenever layers, viewMode, or comparePosition changes
  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = analysis.width;
    canvas.height = analysis.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // If original flat preview mode
    if (viewMode === 'original' && referenceImgRef.current?.complete) {
      ctx.drawImage(referenceImgRef.current, 0, 0, canvas.width, canvas.height);
      return;
    }

    // 1. Draw Background
    const cleanBgImg = getLoadedImage(analysis.cleanBackgroundUrl || analysis.backgroundImageUrl);
    if (cleanBgImg) {
      ctx.drawImage(cleanBgImg, 0, 0, canvas.width, canvas.height);
    } else if (analysis.backgroundType === 'gradient' && analysis.gradientColors && analysis.gradientColors.length >= 2) {
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
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = analysis.backgroundColor || '#0F172A';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 2. Render Layers in z-index order
    for (const layer of analysis.layers) {
      if (!layer.visible) continue;
      if (layer.type === 'background') continue;

      const x = layer.bounds.x;
      const y = layer.bounds.y;
      const w = layer.bounds.width;
      const h = layer.bounds.height;

      ctx.save();
      ctx.globalAlpha = layer.opacity ?? 1;

      // Draw Raster Image / Visual Cutout
      if (layer.type === 'image' && layer.imageDataUrl) {
        const cutoutImg = getLoadedImage(layer.imageDataUrl);
        if (cutoutImg) {
          ctx.drawImage(cutoutImg, x, y, w, h);
        }
      }

      // Draw Shapes
      if (layer.shape) {
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

        ctx.globalAlpha = (layer.opacity ?? 1) * opacity;

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

      // Draw Text
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

    // 3. If in split comparison mode, overlay original image on left side
    if (viewMode === 'compare' && referenceImgRef.current?.complete) {
      const splitX = Math.round((canvas.width * comparePosition) / 100);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX, canvas.height);
      ctx.clip();
      ctx.drawImage(referenceImgRef.current, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Draw divider line
      ctx.beginPath();
      ctx.moveTo(splitX, 0);
      ctx.lineTo(splitX, canvas.height);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 8;
      ctx.stroke();
    }

    // 4. Highlight selected layer bounding box
    if (selectedLayerId && viewMode === 'layers') {
      const selectedLayer = analysis.layers.find((l) => l.id === selectedLayerId);
      if (selectedLayer && selectedLayer.visible && selectedLayer.type !== 'background') {
        ctx.save();
        ctx.strokeStyle = '#06B6D4';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(
          selectedLayer.bounds.x,
          selectedLayer.bounds.y,
          selectedLayer.bounds.width,
          selectedLayer.bounds.height
        );
        ctx.restore();
      }
    }
  };

  useEffect(() => {
    drawCanvas();
  }, [analysis, selectedLayerId, viewMode, comparePosition]);

  // Click on canvas to select layer
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = analysis.width / rect.width;
    const clickX = (e.clientX - rect.left) * scale;
    const clickY = (e.clientY - rect.top) * scale;

    // Find topmost clicked layer (reverse iteration)
    const reversed = [...analysis.layers].reverse();
    const clicked = reversed.find((layer) => {
      if (!layer.visible || layer.type === 'background') return false;
      const { x, y, width, height } = layer.bounds;
      return clickX >= x && clickX <= x + width && clickY >= y && clickY <= y + height;
    });

    if (clicked) {
      setSelectedLayerId(clicked.id);
    }
  };

  // Toggle layer visibility
  const toggleLayerVisibility = (layerId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAnalysis((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === layerId ? { ...l, visible: !l.visible } : l)),
    }));
  };

  // Update selected layer property
  const updateSelectedLayer = (updater: (layer: DesignLayer) => DesignLayer) => {
    if (!selectedLayerId) return;
    setAnalysis((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === selectedLayerId ? updater(l) : l)),
    }));
  };

  // Export PSD
  const handleDownloadPsd = async () => {
    setIsExporting(true);
    try {
      const psdUint8 = await generatePsdUint8Array(analysis, referenceImgRef.current, canvasRef.current);
      downloadPsdFile(psdUint8, analysis.title);
    } catch (err: any) {
      console.error('Error generating PSD:', err);
      alert('Failed to generate PSD file: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  // Open in Photopea
  const handleOpenPhotopea = async () => {
    setIsExporting(true);
    try {
      const psdUint8 = await generatePsdUint8Array(analysis, referenceImgRef.current, canvasRef.current);
      openInPhotopea(psdUint8);
    } catch (err: any) {
      console.error('Error opening in Photopea:', err);
      alert('Could not launch Photopea: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  // Download flat PNG snapshot
  const handleDownloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${analysis.title.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}_preview.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Copy hex to clipboard
  const copyHex = (hex: string) => {
    navigator.clipboard.writeText(hex);
    setCopiedHex(hex);
    setTimeout(() => setCopiedHex(null), 2000);
  };

  // Group layers into folders
  const groups: Record<string, DesignLayer[]> = {
    Typography: analysis.layers.filter((l) => l.group === 'Typography' || l.type === 'text'),
    'Graphics & Accents': analysis.layers.filter((l) => l.group === 'Graphics & Accents' || l.type === 'shape' || l.type === 'badge'),
    'Visuals & Cutouts': analysis.layers.filter((l) => l.group === 'Visuals' || l.type === 'image'),
    Background: analysis.layers.filter((l) => l.group === 'Background' || l.type === 'background'),
  };

  const selectedLayer = analysis.layers.find((l) => l.id === selectedLayerId);

  return (
    <div className="w-full flex-1 flex flex-col bg-slate-950 text-slate-100 min-h-[calc(100vh-64px)]">
      {/* Top Workspace Toolbar */}
      <div className="h-14 border-b border-slate-800 bg-slate-900/90 px-4 flex items-center justify-between gap-3 shrink-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onReset}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Convert another Canva link"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <input
              type="text"
              value={analysis.title}
              onChange={(e) => setAnalysis((prev) => ({ ...prev, title: e.target.value }))}
              className="font-semibold text-sm text-white bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none px-1 py-0.5 rounded truncate max-w-[200px] sm:max-w-xs"
            />
            <div className="flex items-center gap-2 text-[11px] text-slate-400 px-1">
              <span>{analysis.width} × {analysis.height} px</span>
              <span>•</span>
              <span>{analysis.layers.length} Layers</span>
              <span>•</span>
              <span className="text-emerald-400 font-medium">RGB 8-bit PSD</span>
            </div>
          </div>

          {/* Multi-page / multi-slide indicator if Canva document has multiple pages */}
          {docInfo && docInfo.totalPages && docInfo.totalPages > 1 && (
            <div className="hidden md:flex items-center gap-1.5 ml-2 px-2.5 py-1 rounded-lg bg-indigo-950/60 border border-indigo-800/50 text-xs">
              <span className="text-indigo-300 font-medium text-[11px]">
                Page {docInfo.currentPage || 1} of {docInfo.totalPages}
              </span>
              {docInfo.onSelectPage && (
                <div className="flex items-center gap-1 ml-1">
                  <button
                    type="button"
                    disabled={(docInfo.currentPage || 1) <= 1}
                    onClick={() => docInfo.onSelectPage?.((docInfo.currentPage || 1) - 1)}
                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 text-[10px] cursor-pointer"
                    title="Previous page"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    disabled={(docInfo.currentPage || 1) >= docInfo.totalPages}
                    onClick={() => docInfo.onSelectPage?.((docInfo.currentPage || 1) + 1)}
                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 text-[10px] cursor-pointer"
                    title="Next page"
                  >
                    ▶
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* View Mode Switcher */}
        <div className="hidden sm:flex items-center p-1 bg-slate-950 border border-slate-800 rounded-xl text-xs">
          <button
            type="button"
            onClick={() => setViewMode('layers')}
            className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
              viewMode === 'layers' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>PSD Layers</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('compare')}
            className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
              viewMode === 'compare' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" />
            <span>Split Compare</span>
          </button>
          {referenceImgRef.current && (
            <button
              type="button"
              onClick={() => setViewMode('original')}
              className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'original' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileImage className="w-3.5 h-3.5" />
              <span>Original Flat</span>
            </button>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadPng}
            className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
            title="Download preview image"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>PNG</span>
          </button>

          <button
            type="button"
            onClick={handleOpenPhotopea}
            disabled={isExporting}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 text-xs font-medium border border-slate-700 hover:border-cyan-500/50 transition-colors cursor-pointer disabled:opacity-50"
            title="Open in Photopea Web Photoshop"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open in Photopea</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadPsd}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white text-xs font-bold shadow-md shadow-indigo-500/20 transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {isExporting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Download .PSD</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Workspace Body: Canvas on left, Photoshop Layers Panel on right */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left: Canvas Stage */}
        <div
          ref={canvasContainerRef}
          className="flex-1 bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden select-none"
        >
          {/* Zoom and Stage Controls */}
          <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1 p-1 bg-slate-900/90 border border-slate-800 rounded-xl shadow-lg backdrop-blur-sm text-xs">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="px-2 font-mono text-[11px] text-slate-400">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="px-2 py-1 rounded-lg hover:bg-slate-800 text-[11px] text-slate-300 font-medium"
              title="Reset 100%"
            >
              100%
            </button>
          </div>

          {/* Split Comparison Range Slider (when in compare mode) */}
          {viewMode === 'compare' && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 w-64 bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl shadow-xl backdrop-blur-sm">
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Original Canva</span>
                <span>Editable PSD</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={comparePosition}
                onChange={(e) => setComparePosition(parseInt(e.target.value, 10))}
                className="w-full accent-cyan-400 cursor-ew-resize"
              />
            </div>
          )}

          {/* Canvas Wrapper */}
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
              transition: 'transform 0.1s ease-out',
            }}
            className="shadow-2xl rounded-lg overflow-hidden border border-slate-800 bg-slate-900 cursor-crosshair relative"
          >
            <canvas ref={canvasRef} onClick={handleCanvasClick} className="block" />
          </div>
        </div>

        {/* Right: Photoshop-style Layers & Inspector Sidebar */}
        <div className="w-full lg:w-88 xl:w-96 bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col shrink-0 h-[480px] lg:h-auto overflow-hidden">
          {/* Sidebar Tabs / Header */}
          <div className="p-3 border-b border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                Photoshop Layers
              </span>
            </div>
            <span className="text-slate-400 text-[11px]">
              {analysis.layers.filter((l) => l.visible).length}/{analysis.layers.length} visible
            </span>
          </div>

          {/* Color Palette bar */}
          {analysis.palette && analysis.palette.length > 0 && (
            <div className="px-3 py-2 border-b border-slate-800/80 bg-slate-950/40 flex items-center justify-between text-xs">
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Palette className="w-3 h-3 text-cyan-400" />
                Palette:
              </span>
              <div className="flex items-center gap-1.5">
                {analysis.palette.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => copyHex(hex)}
                    style={{ backgroundColor: hex }}
                    className="w-5 h-5 rounded-md border border-white/20 hover:scale-110 transition-transform relative group cursor-pointer"
                    title={`Click to copy ${hex}`}
                  >
                    {copiedHex === hex && (
                      <Check className="w-3 h-3 text-white absolute inset-0 m-auto drop-shadow" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Layer Hierarchy List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-3">
            {Object.entries(groups).map(([groupName, groupLayers]) => {
              if (groupLayers.length === 0) return null;
              const isCollapsed = collapsedGroups[groupName] || false;

              return (
                <div key={groupName} className="space-y-1">
                  {/* Folder Group Header */}
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }))
                    }
                    className="w-full flex items-center justify-between px-2 py-1 rounded-md text-[11px] font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5">
                      {isCollapsed ? (
                        <Folder className="w-3.5 h-3.5 text-indigo-400" />
                      ) : (
                        <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
                      )}
                      <span>{groupName}</span>
                    </div>
                    <span className="text-[10px] text-slate-500">{groupLayers.length}</span>
                  </button>

                  {/* Layers within folder (displayed in top-down Photoshop stack order) */}
                  {!isCollapsed && (
                    <div className="pl-2 space-y-0.5 border-l border-slate-800 ml-2">
                      {[...groupLayers].reverse().map((layer) => {
                        const isSelected = layer.id === selectedLayerId;

                        return (
                          <div
                            key={layer.id}
                            onClick={() => setSelectedLayerId(layer.id)}
                            className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-600/20 text-white border border-indigo-500/40'
                                : 'text-slate-300 hover:bg-slate-800/60'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {/* Layer Type Icon */}
                              {layer.type === 'text' ? (
                                <div className="w-4 h-4 rounded bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-[10px] shrink-0">
                                  T
                                </div>
                              ) : layer.type === 'shape' || layer.type === 'badge' ? (
                                <div className="w-4 h-4 rounded bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                                  <Square className="w-2.5 h-2.5" />
                                </div>
                              ) : (
                                <div className="w-4 h-4 rounded bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                                  <ImageIcon className="w-2.5 h-2.5" />
                                </div>
                              )}

                              {/* Layer Name / Text Preview */}
                              <span className="truncate text-xs font-medium">
                                {layer.text?.content ? `"${layer.text.content.slice(0, 24)}"` : layer.name}
                              </span>
                            </div>

                            {/* Visibility Eye */}
                            <button
                              type="button"
                              onClick={(e) => toggleLayerVisibility(layer.id, e)}
                              className="p-1 text-slate-500 hover:text-slate-300 rounded shrink-0 cursor-pointer"
                              title={layer.visible ? 'Hide layer' : 'Show layer'}
                            >
                              {layer.visible ? (
                                <Eye className="w-3.5 h-3.5" />
                              ) : (
                                <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Selected Layer Properties Inspector */}
          {selectedLayer && selectedLayer.type !== 'background' && (
            <div className="p-3 border-t border-slate-800 bg-slate-950/70 text-xs space-y-3 shrink-0 max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white flex items-center gap-1 text-[11px] uppercase tracking-wider">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  Layer Inspector
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {selectedLayer.bounds.width}×{selectedLayer.bounds.height}px
                </span>
              </div>

              {/* Text Layer Controls */}
              {selectedLayer.type === 'text' && selectedLayer.text && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Text Content</label>
                    <textarea
                      rows={2}
                      value={selectedLayer.text.content}
                      onChange={(e) =>
                        updateSelectedLayer((l) => ({
                          ...l,
                          text: { ...l.text!, content: e.target.value },
                        }))
                      }
                      className="w-full p-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">Font Family</label>
                      <select
                        value={selectedLayer.text.fontFamily || 'Montserrat'}
                        onChange={(e) =>
                          updateSelectedLayer((l) => ({
                            ...l,
                            text: { ...l.text!, fontFamily: e.target.value },
                          }))
                        }
                        className="w-full p-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:outline-none"
                      >
                        {FONT_OPTIONS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">
                        Size ({selectedLayer.text.fontSize}px)
                      </label>
                      <input
                        type="range"
                        min="10"
                        max="140"
                        value={selectedLayer.text.fontSize}
                        onChange={(e) =>
                          updateSelectedLayer((l) => ({
                            ...l,
                            text: { ...l.text!, fontSize: parseInt(e.target.value, 10) },
                          }))
                        }
                        className="w-full accent-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={selectedLayer.text.color || '#FFFFFF'}
                        onChange={(e) =>
                          updateSelectedLayer((l) => ({
                            ...l,
                            text: { ...l.text!, color: e.target.value },
                          }))
                        }
                        className="w-6 h-6 rounded border border-slate-700 bg-transparent cursor-pointer"
                      />
                      <span className="font-mono text-[11px] text-slate-300">
                        {selectedLayer.text.color}
                      </span>
                    </div>

                    {/* Alignment & Transform */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      {/* Alignment buttons */}
                      <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg p-0.5">
                        {(['left', 'center', 'right'] as const).map((align) => (
                          <button
                            key={align}
                            type="button"
                            onClick={() =>
                              updateSelectedLayer((l) => ({
                                ...l,
                                text: { ...l.text!, alignment: align },
                              }))
                            }
                            className={`px-2 py-0.5 rounded capitalize text-[10px] font-medium transition-colors cursor-pointer ${
                              selectedLayer.text?.alignment === align
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {align}
                          </button>
                        ))}
                      </div>

                      {/* Text Transform */}
                      <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg p-0.5">
                        {(['none', 'uppercase', 'lowercase'] as const).map((trans) => (
                          <button
                            key={trans}
                            type="button"
                            onClick={() =>
                              updateSelectedLayer((l) => ({
                                ...l,
                                text: { ...l.text!, textTransform: trans },
                              }))
                            }
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                              (selectedLayer.text?.textTransform || 'none') === trans
                                ? 'bg-cyan-600 text-white font-bold'
                                : 'text-slate-400 hover:text-white'
                            }`}
                            title={`Text transform: ${trans}`}
                          >
                            {trans === 'none' ? 'Aa' : trans === 'uppercase' ? 'AA' : 'aa'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Image / Cutout Layer Controls */}
              {selectedLayer.type === 'image' && (
                <div className="space-y-2">
                  <span className="text-[11px] text-slate-400 block">High-Resolution Visual Asset</span>
                  {selectedLayer.imageDataUrl ? (
                    <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 flex items-center gap-3">
                      <div className="w-16 h-16 rounded border border-slate-700 bg-slate-950 flex items-center justify-center overflow-hidden shrink-0">
                        <img
                          src={selectedLayer.imageDataUrl}
                          alt="Cutout thumbnail"
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                      <div className="min-w-0 flex-1 text-[11px] text-slate-300">
                        <p className="font-semibold text-white truncate">{selectedLayer.name}</p>
                        <p className="text-slate-500 font-mono text-[10px] mt-0.5">
                          {selectedLayer.bounds.width} × {selectedLayer.bounds.height} px
                        </p>
                        <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono text-[9px]">
                          Smart Raster Cutout
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500 italic">No direct raster cutout data.</p>
                  )}
                </div>
              )}

              {/* Shape Layer Controls */}
              {selectedLayer.shape && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-slate-400">Fill Color</label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={selectedLayer.shape.fillColor || '#000000'}
                        onChange={(e) =>
                          updateSelectedLayer((l) => ({
                            ...l,
                            shape: { ...l.shape!, fillColor: e.target.value },
                          }))
                        }
                        className="w-6 h-6 rounded border border-slate-700 bg-transparent cursor-pointer"
                      />
                      <span className="font-mono text-[11px] text-slate-300">
                        {selectedLayer.shape.fillColor}
                      </span>
                    </div>
                  </div>

                  {selectedLayer.shape.gradientColors && selectedLayer.shape.gradientColors.length > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[11px] text-slate-400">Gradient Stops</span>
                      <div className="flex items-center gap-1">
                        {selectedLayer.shape.gradientColors.map((col, idx) => (
                          <div
                            key={idx}
                            style={{ backgroundColor: col }}
                            className="w-4 h-4 rounded-full border border-white/20"
                            title={col}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] text-slate-400 flex justify-between mb-1">
                      <span>Opacity</span>
                      <span>{Math.round((selectedLayer.opacity ?? 1) * 100)}%</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={selectedLayer.opacity ?? 1}
                      onChange={(e) =>
                        updateSelectedLayer((l) => ({
                          ...l,
                          opacity: parseFloat(e.target.value),
                        }))
                      }
                      className="w-full accent-indigo-500"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
