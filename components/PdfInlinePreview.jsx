//  components/PdfInlinePreview.jsx

'use client';

// V2-CHANGES.md Group 1 — inline PDF preview + click-to-upload/replace, for CertForm's SOURCE PDF
// column. The canvas is a real React-owned node (`<canvas ref={canvasRef} />`, always present in
// JSX) — we only ever mutate its pixels/width/height via the 2D context, never insert or remove DOM
// nodes imperatively. That's the actual fix for the "removeChild: not a child of this node" crash:
// the old version did `container.innerHTML = ''` / `container.appendChild(canvas)` on a node React
// also tracked, which silently desynced React's fiber tree from the real DOM. It only surfaced once
// an ancestor (CertForm's Sheet, closing right after upload) tried to unmount that subtree and React
// went to remove children that were no longer where it expected.
import { useEffect, useRef, useState } from 'react';
import { UploadIcon, FileTextIcon, SparklesIcon } from 'lucide-react';

export default function PdfInlinePreview({ file, url, onPick, extracting, replaceLabel = 'Replace' }) {
  const canvasRef = useRef(null);
  const inputRef = useRef(null);
  const [status, setStatus] = useState(file || url ? 'loading' : 'empty'); // empty | loading | ready | error
  const [error, setError] = useState(null);
  const [pageCount, setPageCount] = useState(null);

  useEffect(() => {
    if (!file && !url) { setStatus('empty'); return; }
    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      try {
        const buf = file ? await file.arrayBuffer() : await (await fetch(url)).arrayBuffer();
        if (cancelled) return;

        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);

        const page = await pdf.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return; // component unmounted mid-fetch — nothing to draw into

        const targetWidth = Math.max(160, Math.round(canvas.parentElement.clientWidth));
        const dpr = window.devicePixelRatio || 1;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = (targetWidth / baseViewport.width) * dpr;
        const viewport = page.getViewport({ scale });

        // Only ever touch this canvas's own attributes/pixels — never its position in the tree.
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (cancelled) return;
        setStatus('ready');
      } catch (e) {
        if (!cancelled) { setError(e.message || 'Could not render PDF'); setStatus('error'); }
      }
    })();

    return () => { cancelled = true; };
  }, [file, url]);

  function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onPick?.(f);
  }

  const hasContent = status !== 'empty';

  return (
    <div className="group relative flex aspect-[3/4] w-full flex-col overflow-hidden rounded-xl border bg-muted/20 transition-colors hover:border-muted-foreground/30">
      <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={pick} />

      {!hasContent && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <UploadIcon className="size-5" />
          <span className="text-xs font-medium">Upload PDF</span>
          <span className="text-[11px] text-muted-foreground/70">Click to attach</span>
        </button>
      )}

      {hasContent && (
        <>
          <div className="relative flex flex-1 items-center justify-center p-2">
            <canvas ref={canvasRef} className="max-h-full max-w-full rounded-md shadow-sm" style={{ width: status === 'ready' ? '100%' : 0, height: 'auto' }} />
            {status === 'loading' && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/40">
                <span className="text-xs text-muted-foreground">Rendering…</span>
              </div>
            )}
            {status === 'error' && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/40 p-3 text-center">
                <span className="text-xs text-destructive">{error}</span>
              </div>
            )}
          </div>

          {status === 'ready' && pageCount > 1 && (
            <span className="absolute right-2 top-2 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
              1 / {pageCount}
            </span>
          )}

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent py-2.5 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          >
            <FileTextIcon className="size-3.5" />{replaceLabel}
          </button>
        </>
      )}

      {extracting && (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-medium text-white">
          <SparklesIcon className="size-3 animate-pulse" />Reading…
        </span>
      )}
    </div>
  );
}