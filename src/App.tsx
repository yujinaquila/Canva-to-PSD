import React, { useState } from 'react';
import { Header } from './components/Header';
import { CanvaInputSection } from './components/CanvaInputSection';
import { PsdWorkspace } from './components/PsdWorkspace';
import { CanvaHelpModal } from './components/CanvaHelpModal';
import { ConversionProgressModal } from './components/ConversionProgressModal';
import { CanvaDesignAnalysis, SampleDesign } from './types';
import { SAMPLE_ANALYSES } from './data/sampleDesigns';
import { renderAnalysisToDataUrl } from './utils/sampleCanvasRenderer';
import { renderPdfPageToDataUrl } from './utils/pdfRenderer';
import { enrichAnalysisWithVisualAssets } from './utils/visualAssetExtractor';

export default function App() {
  const [analysis, setAnalysis] = useState<CanvaDesignAnalysis | null>(null);
  const [originalImageBase64, setOriginalImageBase64] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepMessage, setStepMessage] = useState('');
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [canvaDocInfo, setCanvaDocInfo] = useState<{
    url?: string;
    totalPages?: number;
    currentPage?: number;
    author?: string;
  } | null>(null);
  const [currentPdfBuffer, setCurrentPdfBuffer] = useState<{
    name: string;
    buffer: ArrayBuffer;
  } | null>(null);

  // Convert Canva URL
  const handleConvertUrl = async (url: string, pageIndex: number = 0) => {
    setIsLoading(true);
    setBlockedNotice(null);
    setCurrentStep(0);
    setStepMessage('Connecting to Canva & resolving design links...');

    try {
      // Step 1: Check if URL matches any of our instant samples (only on initial load)
      if (pageIndex === 0) {
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
      }

      // Step 2: Fetch via backend proxy with redirect resolution and S3 fallback extraction
      setCurrentStep(1);
      setStepMessage('Extracting canvas resolution, metadata & slide preview...');

      const fetchRes = await fetch('/api/canva/fetch-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, pageIndex }),
      });

      const fetchData = await fetchRes.json();

      if (fetchData.success && fetchData.imageBase64) {
        setOriginalImageBase64(fetchData.imageBase64);
        setCanvaDocInfo({
          url: fetchData.url || url,
          totalPages: fetchData.totalPages,
          currentPage: fetchData.currentPage,
          author: fetchData.author,
        });

        // Step 3: Analyze with Gemini AI
        setCurrentStep(2);
        setStepMessage('Gemini Flash analyzing typography, vectors, badges & layout...');

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
          setStepMessage('Extracting visual cutouts, typography & smart background...');
          const enriched = await enrichAnalysisWithVisualAssets(
            analyzeData.analysis,
            fetchData.imageBase64
          );

          setCurrentStep(4);
          setStepMessage('Finalizing Adobe Photoshop document...');
          await new Promise((r) => setTimeout(r, 400));

          setAnalysis(enriched);
        } else {
          throw new Error(analyzeData.message || 'AI layer extraction failed');
        }
      } else if (fetchData.canvaBlocked) {
        setBlockedNotice(
          fetchData.message ||
            'Canva protected this design behind an authentication or bot check. You can paste the Canva embed HTML code, or upload/drop your exported Canva image or PDF below for instant editable PSD decomposition.'
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

  // Convert specific page of imported PDF
  const handleConvertPdfPage = async (
    pageNum: number,
    customPdf?: { name: string; buffer: ArrayBuffer }
  ) => {
    const pdfData = customPdf || currentPdfBuffer;
    if (!pdfData) return;

    setIsLoading(true);
    setBlockedNotice(null);
    setCurrentStep(0);
    setStepMessage(`Rendering PDF page ${pageNum}...`);

    try {
      setCurrentStep(1);
      setStepMessage(`Rasterizing vector graphics & typography for Page ${pageNum}...`);

      const rendered = await renderPdfPageToDataUrl(pdfData.buffer, pageNum, 2.0);
      setOriginalImageBase64(rendered.dataUrl);

      setCanvaDocInfo({
        totalPages: rendered.totalPages,
        currentPage: rendered.pageNumber,
        author: 'Imported Canva PDF',
      });

      setCurrentStep(2);
      setStepMessage('Gemini AI decomposing PDF layout into editable text & shapes...');

      const baseName = pdfData.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      const cleanTitle = rendered.totalPages > 1 ? `${baseName} (Page ${rendered.pageNumber})` : baseName;

      const analyzeRes = await fetch('/api/canva/analyze-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: rendered.dataUrl,
          title: cleanTitle,
          dimensions: { width: rendered.width, height: rendered.height },
        }),
      });

      const analyzeData = await analyzeRes.json();

      if (analyzeData.success && analyzeData.analysis) {
        setCurrentStep(3);
        setStepMessage('Extracting PDF visual cutouts, typography & background...');
        const enriched = await enrichAnalysisWithVisualAssets(
          analyzeData.analysis,
          rendered.dataUrl
        );

        setCurrentStep(4);
        setStepMessage('Generating Photoshop Document (.PSD)...');
        await new Promise((r) => setTimeout(r, 400));

        setAnalysis(enriched);
      } else {
        throw new Error(analyzeData.message || 'Failed to decompose PDF page');
      }
    } catch (err: any) {
      console.error('PDF decomposition error:', err);
      alert('Error decomposing PDF: ' + (err.message || 'Unable to process PDF page'));
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
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        const arrayBuffer = await file.arrayBuffer();
        const pdfItem = { name: file.name, buffer: arrayBuffer };
        setCurrentPdfBuffer(pdfItem);
        await handleConvertPdfPage(1, pdfItem);
        return;
      }

      // Handle standard image files (PNG, JPG, WEBP, etc.)
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setOriginalImageBase64(base64);

      // Measure dimensions for precision layer mapping
      const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || 1080, height: img.naturalHeight || 1080 });
        img.onerror = () => resolve({ width: 1080, height: 1080 });
        img.src = base64;
      });

      setCurrentStep(2);
      setStepMessage('Gemini AI decomposing design into editable text & shapes...');

      const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

      const analyzeRes = await fetch('/api/canva/analyze-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          title: cleanTitle,
          dimensions,
        }),
      });

      const analyzeData = await analyzeRes.json();

      if (analyzeData.success && analyzeData.analysis) {
        setCurrentStep(3);
        setStepMessage('Extracting visual cutouts, typography & smart background...');
        const enriched = await enrichAnalysisWithVisualAssets(
          analyzeData.analysis,
          base64
        );

        setCurrentStep(4);
        setStepMessage('Generating Photoshop Document (.PSD)...');
        await new Promise((r) => setTimeout(r, 400));

        setAnalysis(enriched);
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
        const enriched = await enrichAnalysisWithVisualAssets(copy, dataUrl);
        setAnalysis(enriched);
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
    setCanvaDocInfo(null);
    setCurrentPdfBuffer(null);
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
            docInfo={
              canvaDocInfo && canvaDocInfo.totalPages && canvaDocInfo.totalPages > 1
                ? {
                    totalPages: canvaDocInfo.totalPages,
                    currentPage: canvaDocInfo.currentPage,
                    onSelectPage: (targetPageNum) => {
                      if (currentPdfBuffer) {
                        handleConvertPdfPage(targetPageNum);
                      } else if (canvaDocInfo.url) {
                        handleConvertUrl(canvaDocInfo.url, targetPageNum - 1);
                      }
                    },
                  }
                : undefined
            }
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
