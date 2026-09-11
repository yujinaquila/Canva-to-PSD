import React from 'react';
import { X, CheckCircle2, Link2, Code, Upload, Layers, ArrowRight, ShieldCheck } from 'lucide-react';

interface CanvaHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CanvaHelpModal: React.FC<CanvaHelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl text-slate-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">How to Convert Canva to Editable PSD</h2>
              <p className="text-xs text-slate-400">Quick instructions for extracting and decompiling Canva designs</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-6 text-sm">
          {/* Section 1: Ways to import */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-400 mb-3">
              3 Easy Ways to Import Any Canva Design
            </h3>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center mb-2.5">
                  <Link2 className="w-4 h-4" />
                </div>
                <h4 className="font-semibold text-white text-xs mb-1">1. Public View Link</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  In Canva, click <strong>Share &gt; Public view link &gt; Copy</strong>. Paste the link directly.
                </p>
              </div>

              <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center mb-2.5">
                  <Code className="w-4 h-4" />
                </div>
                <h4 className="font-semibold text-white text-xs mb-1">2. Embed Code</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Click <strong>Share &gt; More &gt; Embed</strong>. Paste the snippet directly into the input bar.
                </p>
              </div>

              <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-2.5">
                  <Upload className="w-4 h-4" />
                </div>
                <h4 className="font-semibold text-white text-xs mb-1">3. Drag & Drop Export</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Download as PNG/PDF from Canva and drop the file, or paste directly with <strong>Ctrl+V</strong>.
                </p>
              </div>
            </div>
          </div>

          {/* Section 2: What makes the PSD editable */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 space-y-2.5">
            <h3 className="text-xs font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              What is included in the converted Photoshop (.PSD) file?
            </h3>
            <ul className="text-xs text-slate-300 space-y-1.5 list-none">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Native Photoshop Text Layers:</strong> Double-click to edit typography, change font family, color, and size using Photoshop's Type Tool.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Isolated Vector & Badge Shapes:</strong> Buttons, tags, badges, and frames are separated onto transparent shape layers.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Organized Layer Folders:</strong> Neatly grouped into Typography, Graphics, Visuals, and Background.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Original Reference Layer:</strong> A hidden reference layer is included at the bottom for 100% pixel-perfect verification.
                </span>
              </li>
            </ul>
          </div>

          {/* Section 3: Supported software */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800 text-xs text-slate-400">
            <span>Compatible with: Adobe Photoshop, Illustrator, Photopea, Affinity Photo</span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors cursor-pointer"
            >
              Got it, let's convert!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
