import React, { useState } from 'react';
import { Header } from './components/Header';
import { CanvaInputSection } from './components/CanvaInputSection';
import { PsdWorkspace } from './components/PsdWorkspace';
import { CanvaHelpModal } from './components/CanvaHelpModal';
import { ConversionProgressModal } from './components/ConversionProgressModal';
import { CanvaDesignAnalysis, SampleDesign } from './types';
import { SAMPLE_ANALYSES } from './data/sampleDesigns';
import { renderAnalysisToDataUrl } from './utils/sampleCanvasRenderer';

export default function App() {
  const [analysis, setAnalysis] = useState<CanvaDesignAnalysis | null>(null);
  const [originalImageBase64, setOriginalImageBase64] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepMessage, setStepMessage] = useState('');
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  // Convert Canva URL
  const handleConvertUrl = async (url: string) => {
    setIsLoading(true);
    setBlockedNotice(null);
    setCurrentStep(0);
    setStepMessage('Connecting to Canva and resolving design ID...');

    try {
      // Step 1: Check if URL matches any of our instant samples
      for (const [key, sample] of Object.entries(SAMPLE_ANALYSES)) {
        if (url.includes(key) || (sample.title && url.toLowerCase().includes(sample.title.toLowerCase().replace(/[^a-z0-9]/g, '')))) {
          const sampleData = { ...sample };
          const dataUrl = renderAnalysisToDataUrl(sampleData);
          sampleData.previewUrl = dataUrl;
          setOriginalImageBase64(dataUrl);

          await simulateProgress();
          setAnalysis(sampleData);
          setIsLoading(false);
          return;
        }
      }

      // Step 2: Fetch via backend proxy
      setCurrentStep(1);
      setStepMessage('Extracting canvas metadata & design preview...');

      const fetchRes = await fetch('/api/canva/fetch-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const fetchData = await fetchRes.json();

      if (fetchData.success && fetchData.imageBase64) {
        setOriginalImageBase64(fetchData.imageBase64);

        // Step 3: Analyze with Gemini AI
        setCurrentStep(2);
        setStepMessage('Gemini 3.8 Flash analyzing typography, vectors, & layout...');

        const analyzeRes = await fetch('/api/canva/analyze-design', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: fetchData.imageBase64,
            title: fetchData.title,
            dimensions: { width: fetchData.width, height: fetchData.height },
          }),
        });

        const analyzeData = await analyzeRes.json();

        if (analyzeData.success && analyzeData.analysis) {
          setCurrentStep(3);
          setStepMessage('Structuring layer folders & preparing PSD Type Tools...');
          await new Promise((r) => setTimeout(r, 600));

          setCurrentStep(4);
          setStepMessage('Finalizing Adobe Photoshop document...');
          await new Promise((r) => setTimeout(r, 400));

          setAnalysis(analyzeData.analysis);
        } else {
          throw new Error(analyzeData.message || 'AI layer extraction failed');
        }
      } else if (fetchData.canvaBlocked) {
        setBlockedNotice(
          fetchData.message ||
            'Canva bot protection blocked automated direct access for this specific URL. You can paste the Canva embed HTML code, or upload/drop your exported Canva image or PDF below for instant layer decomposition.'
        );
      } else {
        throw new Error(fetchData.message || 'Could not fetch Canva design');
      }
    } catch (err: any) {
      console.error('Conversion error:', err);
      setBlockedNotice(
        `Notice: ${err.message || 'Unable to connect to Canva'}. You can paste Canva embed code or upload an exported Canva image/PDF below.`
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Convert uploaded Canva image or PDF file
  const handleConvertFile = async (file: File) => {
    setIsLoading(true);
    setBlockedNotice(null);
    setCurrentStep(0);
    setStepMessage(`Loading ${file.name}...`);

    try {
      // Read file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setOriginalImageBase64(base64);

      setCurrentStep(2);
      setStepMessage('Gemini 3.8 Flash decomposing design into editable text & shapes...');

      const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

      const analyzeRes = await fetch('/api/canva/analyze-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          title: cleanTitle,
        }),
      });

      const analyzeData = await analyzeRes.json();

      if (analyzeData.success && analyzeData.analysis) {
        setCurrentStep(3);
        setStepMessage('Synthesizing Photoshop typography & vector layers...');
        await new Promise((r) => setTimeout(r, 600));

        setCurrentStep(4);
        setStepMessage('Generating Photoshop Document (.PSD)...');
        await new Promise((r) => setTimeout(r, 400));

        setAnalysis(analyzeData.analysis);
      } else {
        throw new Error(analyzeData.message || 'Failed to analyze file');
      }
    } catch (err: any) {
      console.error('File conversion error:', err);
      alert('Error processing file: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Select Sample Canva Design
  const handleSelectSample = async (sample: SampleDesign) => {
    setIsLoading(true);
    setBlockedNotice(null);
    setCurrentStep(0);
    setStepMessage(`Loading sample: ${sample.title}...`);

    try {
      const sampleData = SAMPLE_ANALYSES[sample.id];
      if (sampleData) {
        const copy = JSON.parse(JSON.stringify(sampleData)) as CanvaDesignAnalysis;
        const dataUrl = renderAnalysisToDataUrl(copy);
        copy.previewUrl = dataUrl;
        setOriginalImageBase64(dataUrl);

        await simulateProgress();
        setAnalysis(copy);
      }
    } catch (e: any) {
      console.error('Error loading sample:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Helper for animated progress on sample selection
  const simulateProgress = async () => {
    setCurrentStep(1);
    setStepMessage('Extracting sample canvas assets & vector styles...');
    await new Promise((r) => setTimeout(r, 400));

    setCurrentStep(2);
    setStepMessage('Gemini 3.8 Flash deconstructing typography & shapes...');
    await new Promise((r) => setTimeout(r, 500));

    setCurrentStep(3);
    setStepMessage('Generating editable Type Tool text layers...');
    await new Promise((r) => setTimeout(r, 400));

    setCurrentStep(4);
    setStepMessage('Compiling Photoshop Document (.PSD)...');
    await new Promise((r) => setTimeout(r, 300));
  };

  const handleReset = () => {
    setAnalysis(null);
    setOriginalImageBase64(undefined);
    setBlockedNotice(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Navigation Header */}
      <Header onOpenHelp={() => setIsHelpOpen(true)} />

      {/* Main View: Either Input Section or PSD Workspace */}
      <main className="flex-1 flex flex-col">
        {!analysis ? (
          <div className="flex-1 flex flex-col justify-center">
            <CanvaInputSection
              onConvertUrl={handleConvertUrl}
              onConvertFile={handleConvertFile}
              onSelectSample={handleSelectSample}
              isLoading={isLoading}
              blockedNotice={blockedNotice}
              onOpenHelp={() => setIsHelpOpen(true)}
            />
          </div>
        ) : (
          <PsdWorkspace
            initialAnalysis={analysis}
            originalImageBase64={originalImageBase64}
            onReset={handleReset}
          />
        )}
      </main>

      {/* Progress Modal */}
      {isLoading && (
        <ConversionProgressModal currentStep={currentStep} stepMessage={stepMessage} />
      )}

      {/* Help Modal */}
      <CanvaHelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </div>
  );
}
