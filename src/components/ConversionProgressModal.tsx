import React from 'react';
import { Sparkles, Layers, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';

interface ConversionProgressModalProps {
  currentStep: number;
  stepMessage: string;
}

const STEPS = [
  { title: 'Resolving Canva Link', desc: 'Validating URL & extracting design ID' },
  { title: 'Fetching Visual Assets', desc: 'Downloading high-resolution canvas' },
  { title: 'Gemini AI Decomposition', desc: 'Analyzing typography, styles, & bounding boxes' },
  { title: 'Layer Synthesis', desc: 'Separating shapes, text, & background' },
  { title: 'Compiling .PSD Document', desc: 'Writing Photoshop binary with ag-psd' },
];

export const ConversionProgressModal: React.FC<ConversionProgressModalProps> = ({
  currentStep,
  stepMessage,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-6 shadow-2xl text-slate-100">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Converting Canva to PSD</h3>
            <p className="text-xs text-slate-400">Deconstructing canvas into editable Photoshop layers</p>
          </div>
        </div>

        {/* Step List */}
        <div className="space-y-3 my-6">
          {STEPS.map((step, idx) => {
            const isCompleted = currentStep > idx;
            const isCurrent = currentStep === idx;
            const isPending = currentStep < idx;

            return (
              <div
                key={step.title}
                className={`flex items-start gap-3 p-2.5 rounded-xl transition-all ${
                  isCurrent
                    ? 'bg-indigo-500/10 border border-indigo-500/30'
                    : isCompleted
                    ? 'bg-slate-800/40 opacity-80'
                    : 'opacity-40'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-slate-600 flex items-center justify-center text-[9px] text-slate-400">
                      {idx + 1}
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <p className={`text-xs font-semibold ${isCurrent ? 'text-indigo-300' : 'text-slate-200'}`}>
                    {step.title}
                  </p>
                  <p className="text-[11px] text-slate-400">{step.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Live status line */}
        <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-slate-300 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
          <span className="truncate">{stepMessage || 'Processing...'}</span>
        </div>
      </div>
    </div>
  );
};
