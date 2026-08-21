//  components/PdfInlinePreview.jsx

'use client';

// V3-CHANGES.md — full multi-page preview for CertForm's SOURCE PDF panel, now that the panel
// gets real screen real estate (70% width). Rendering approach borrowed directly from PdfPreview.jsx
// (one canvas per page, painted via 2D context, canvases mounted/unmounted only by the numPages-
// driven map below — never touched with innerHTML/appendChild) so the same "never desync React's
// fiber tree from the real DOM" guarantee holds here. On top of that we keep the click-to-upload /
// replace affordance the old thumbnail version had, since this is still the live drop target for a
// new file, not just a viewer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadIcon, FileTextIcon, SparklesIcon } from 'lucide-react';

export default function PdfInlinePreview({ file, url, onPick, extracting, replaceLabel = 'Replace' }) {
  const scrollRef = useRef(null);
  const pdfRef = useRef(null);
  const canvasRefs = useRef([]);
  const renderTasksRef = useRef([]); // in-flight pdf.js RenderTask per page, so a second paint pass can cancel it
  const inputRef = useRef(null);
  const [status, setStatus] = useState(file || url ? 'loading' : 'empty'); // empty | loading | ready | error
  const [error, setError] = useState(null);
  const [numPages, setNumPages] = useState(0);

  // Paint into each page's own canvas — mutates width/height/pixels only, never the DOM tree.
  const renderPages = useCallback(async () => {
    const pdf = pdfRef.current;
    const scroller = scrollRef.current;
    if (!pdf || !scroller) return;
    const availW = Math.max(160, scroller.clientWidth - 24);
    const dpr = window.devicePixelRatio || 1;
    for (let i = 1; i <= pdf.numPages; i++) {
      const canvas = canvasRefs.current[i - 1];
      if (!canvas) continue;
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const cssScale = availW / base.width;
      const viewport = page.getViewport({ scale: cssScale * dpr });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${base.width * cssScale}px`;
      canvas.style.height = `${base.height * cssScale}px`;

      // pdf.js throws "Cannot use the same canvas during multiple render() operations" if a second
      // render() starts before the first finishes — which happens for real under StrictMode's
      // double-invoked effects, and again on any resize that fires mid-paint. Cancel whatever's
      // already running on this canvas before claiming it.
      renderTasksRef.current[i - 1]?.cancel();
      const task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      renderTasksRef.current[i - 1] = task;
      try {
        await task.promise;
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') throw err;
      }
    }
  }, []);

  // Fetch + parse only — no DOM work here.
  useEffect(() => {
    if (!file && !url) { setStatus('empty'); return; }
    let cancelled = false;
    setStatus('loading');
    setError(null);
    pdfRef.current = null;
    canvasRefs.current = [];
    renderTasksRef.current = [];
    setNumPages(0);

    (async () => {
      try {
        const buf = file ? await file.arrayBuffer() : await (await fetch(url)).arrayBuffer();
        if (cancelled) return;

        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        setStatus('ready');
      } catch (e) {
        if (!cancelled) { setError(e.message || 'Could not render PDF'); setStatus('error'); }
      }
    })();

    return () => { cancelled = true; };
  }, [file, url]);

  // Paint once canvases exist, and repaint on resize — decoupled from fetching so a resize never refetches.
  useEffect(() => {
    if (status !== 'ready' || !numPages || !scrollRef.current) return;
    let t;
    renderPages();
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(renderPages, 80); });
    ro.observe(scrollRef.current);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [status, numPages, renderPages]);

  function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onPick?.(f);
  }

  const hasContent = status !== 'empty';

  return (
    <div className="group relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border bg-muted/10">
      <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={pick} />

      {!hasContent && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
        >
          <UploadIcon className="size-6" />
          <span className="text-sm font-medium">Upload PDF</span>
          <span className="text-xs text-muted-foreground/70">Click to attach, or drop it here</span>
        </button>
      )}

      {hasContent && (
        <>
          <div
            ref={scrollRef}
            className="flex min-h-0 flex-1 snap-y snap-mandatory flex-col items-center gap-3 overflow-y-auto bg-muted/30 p-3"
          >
            {status === 'loading' && <p className="py-12 text-center text-sm text-muted-foreground">Rendering PDF…</p>}
            {status === 'error' && <p className="py-12 text-center text-sm text-destructive">{error}</p>}
            {Array.from({ length: numPages }).map((_, i) => (
              <canvas
                key={i}
                ref={el => { canvasRefs.current[i] = el; }}
                className="shrink-0 rounded-md border bg-white shadow-sm"
                style={{ scrollSnapAlign: 'start' }}
              />
            ))}
          </div>

          {status === 'ready' && numPages > 1 && (
            <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
              {numPages} pages
            </span>
          )}

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent py-3 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          >
            <FileTextIcon className="size-3.5" />{replaceLabel}
          </button>
        </>
      )}

      {extracting && (
        <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
          <SparklesIcon className="size-3 animate-pulse" />Reading…
        </span>
      )}
    </div>
  );
}