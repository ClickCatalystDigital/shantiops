//  components/PdfInlinePreview.jsx

'use client';

// V2-CHANGES.md Group 1 — a lighter sibling of PdfPreview.jsx: renders directly inline (no Dialog
// chrome), for the left column of CertForm's overlay rather than a popup. Same pdfjs-dist
// legacy-build + static-worker approach as PdfPreview (SYSTEM.md §5d's build-gotcha note applies
// here too), but reads bytes straight from a local File (no round-trip to the server needed before
// the certificate row even exists) or, once one's saved, from `url` (the proxied
// /api/test-certificates/[id]/pdf route). First page only — certificate scans are effectively
// always single-page; a page-count note covers the rare multi-page case rather than building a
// full pager for a narrow overlay column.
import { useEffect, useRef, useState } from 'react';

export default function PdfInlinePreview({ file, url }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [pageCount, setPageCount] = useState(null);

  useEffect(() => {
    if (!file && !url) return;
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

        const container = containerRef.current;
        if (!container) return;
        const page = await pdf.getPage(1);
        const targetWidth = Math.max(160, Math.round(container.clientWidth));
        const dpr = window.devicePixelRatio || 1;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = (targetWidth / baseViewport.width) * dpr;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        // Re-check right before touching the DOM — enough async work (fetch/import/getPage) has
        // happened since the top of this effect that CertForm's Sheet can easily have closed and
        // detached this node by now (e.g. right after a successful PDF upload), which is what threw
        // "removeChild: not a child of this node" when we mutated a container React had already
        // torn down.
        if (cancelled || !container.isConnected) return;
        container.innerHTML = '';
        container.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (cancelled) return;
        setStatus('ready');
      } catch (e) {
        if (e?.name === 'NotFoundError') return; // DOM detached mid-render — nothing left to show
        if (!cancelled) { setError(e.message || 'Could not render PDF'); setStatus('error'); }
      }
    })();

    return () => { cancelled = true; };
  }, [file, url]);

  if (!file && !url) {
    return (
      <div className="flex h-full min-h-[220px] items-center justify-center rounded-md border border-dashed text-center text-xs text-muted-foreground">
        No PDF attached yet
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={containerRef} className="min-h-[220px] overflow-hidden rounded-md border bg-muted/20">
        {status === 'loading' && <p className="p-4 text-center text-xs text-muted-foreground">Rendering…</p>}
        {status === 'error' && <p className="p-4 text-center text-xs text-danger">{error}</p>}
      </div>
      {status === 'ready' && pageCount > 1 && (
        <p className="text-center text-xs text-muted-foreground">Page 1 of {pageCount}</p>
      )}
    </div>
  );
}
