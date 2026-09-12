import React, { useState, useRef, useEffect } from 'react';
import {
  Link2,
  Sparkles,
  Upload,
  ArrowRight,
  FileImage,
  AlertCircle,
  HelpCircle,
  Check,
  Zap,
} from 'lucide-react';
import { SAMPLE_DESIGNS } from '../data/sampleDesigns';
import { SampleDesign } from '../types';

interface CanvaInputSectionProps {
  onConvertUrl: (url: string) => void;
  onConvertFile: (file: File) => void;
  onSelectSample: (sample: SampleDesign) => void;
  isLoading: boolean;
  blockedNotice?: string | null;
  onOpenHelp: () => void;
}

export const CanvaInputSection: React.FC<CanvaInputSectionProps> = ({
  onConvertUrl,
  onConvertFile,
  onSelectSample,
  isLoading,
  blockedNotice,
  onOpenHelp,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle submit URL
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    onConvertUrl(inputValue.trim());
  };

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (
        file.type.startsWith('image/') ||
        file.type === 'application/pdf' ||
        file.type.includes('pdf') ||
        file.name.toLowerCase().endsWith('.pdf')
      ) {
        onConvertFile(file);
      }
    }
  };

  // Handle manual file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onConvertFile(e.target.files[0]);
    }
  };

  // Listen for global clipboard paste (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // If user pasted an image from clipboard
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        const file = e.clipboardData.files[0];
        if (file.type.startsWith('image/')) {
          onConvertFile(file);
          return;
        }
      }

      // If user pasted text into window when input is not focused
      const text = e.clipboardData?.getData('text/plain');
      if (text && (text.includes('canva.com') || text.includes('canva.link') || text.includes('<iframe')) && document.activeElement !== document.querySelector('input')) {
        setInputValue(text.trim());
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [onConvertFile]);

  return (
    <section className="w-full max-w-4xl mx-auto px-4 py-8">
      {/* Title & value prop */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Canva Link & Shortlink Reverse-Engineering Engine</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Convert Canva Links into Editable PSD
        </h2>
        <p className="mt-2.5 text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">
          Paste any Canva share link (including <span className="text-indigo-300 font-mono text-xs bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-800/40">canva.link/*</span> and <span className="text-indigo-300 font-mono text-xs bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-800/40">canva.com/design/*</span>), embed code, or exported graphic. Our AI deconstructs the canvas into native Photoshop text layers, vector shapes, and discrete assets.
        </p>
      </div>

      {/* Primary URL Input Form */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xl backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-stretch gap-2.5">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Link2 className="w-5 h-5 text-indigo-400" />
            </div>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Paste Canva link (e.g. https://canva.link/v92m6dsuhpaqabs or canva.com/design/...)"
              disabled={isLoading}
              className="w-full pl-11 pr-4 py-3.5 bg-slate-950 border border-slate-700/80 rounded-xl text-slate-100 text-sm placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all disabled:opacity-50"
            />
            {inputValue && (
              <button
                type="button"
                onClick={() => setInputValue('')}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs text-slate-500 hover:text-slate-300"
              >
                Clear
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading}
            className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white text-sm font-semibold shadow-lg shadow-indigo-600/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span>Decompiling...</span>
              </>
            ) : (
              <>
                <span>Convert to PSD</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Quick Sample Selector */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 flex items-center gap-1 font-medium">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            Try Samples:
          </span>
          {SAMPLE_DESIGNS.map((sample) => (
            <button
              key={sample.id}
              type="button"
              disabled={isLoading}
              onClick={() => {
                setInputValue(sample.url);
                onSelectSample(sample);
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/60 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <span>{sample.title.split(' ')[0]} {sample.title.split(' ')[1]}</span>
              <span className="text-slate-500 text-[10px]">({sample.dimensions.split(' ')[0]})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Cloudflare / Bot Notice with Helpful Guidance */}
      {blockedNotice && (
        <div className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-3 animate-in fade-in">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <p className="font-semibold text-amber-300">Canva Direct Link Notice</p>
            <p className="text-slate-300 leading-relaxed">{blockedNotice}</p>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={onOpenHelp}
                className="underline font-medium text-amber-300 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                View 3-step guide to get embed code or exported image
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alternative File Dropzone */}
      <div className="mt-6">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer ${
            isDragOver
              ? 'border-indigo-400 bg-indigo-500/10'
              : 'border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900/70'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="w-12 h-12 rounded-xl bg-slate-800 text-indigo-400 flex items-center justify-center mx-auto mb-3">
            <Upload className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-slate-200">
            Have an exported Canva file or screenshot?
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Drag & drop PNG, JPG, or PDF here, or click to browse (or paste with <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px]">Ctrl+V</kbd>)
          </p>
          <div className="mt-3 flex items-center justify-center gap-4 text-[11px] text-slate-500">
            <span>✓ Generates true Photoshop Type layers</span>
            <span>✓ Automatic color extraction</span>
            <span>✓ Shape separation</span>
          </div>
        </div>
      </div>
    </section>
  );
};
