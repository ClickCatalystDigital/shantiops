'use client';

// In-app PDF preview, rendered to <canvas> via PDF.js rather than an embedded <iframe>/browser
// plugin — the native iframe approach depends on the browser's own PDF viewer being enabled, and
// some browsers/settings download instead of showing it inline. Canvas rendering works the same
// way regardless of the viewer's PDF/download configuration.
//
// Centered, large modal rather than a side drawer — a dense statutory table (18 columns on Form
// IV A) needs real width to read, and a ~500px-wide side panel isn't enough. Sizes itself off the
// viewport (`w-[96vw] max-w-6xl h-[90vh]`), which on a phone-width screen is already near-fullscreen
// with no separate mobile layout needed. Render scale is computed from the actual container width
// (× devicePixelRatio) rather than a fixed constant, so the page stays crisp at whatever size the
// modal ends up — a fixed scale that looked fine in a narrow drawer would look soft blown up this
// much bigger.
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DownloadIcon } from 'lucide-react';

export default function PdfPreview({ open, onOpenChange, url, title, description, filename, actions }) {
  const containerRef = useRef(null); // canvases mount here; never given JSX children, see note below
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Couldn't load the PDF (${res.status})`);
        }
        const buf = await res.arrayBuffer();
        if (cancelled) return;

        // legacy/ build (not build/) — the modern build leans on syntax some bundler pipelines
        // can't parse. The worker is served as a plain static file from public/ (kept in sync by
        // scripts/copy-pdf-worker.js on every `npm install`) rather than resolved through
        // webpack's asset-module bundling (`new URL(..., import.meta.url)`) — Next's production
        // Terser pass doesn't recognize that bundled copy as an ES module and fails with
        // "'import'/'export' cannot be used outside module code". A static /public file is never
        // parsed or minified by webpack at all, so neither failure mode applies.
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;

        const container = containerRef.current;
        // Fit each page to CONTAIN within the visible area (both width and height) so one whole page
        // shows at a time — portrait A4 is taller than wide, so fitting to width alone cut pages off.
        // Each page sits in a full-viewport-height slide with scroll-snap, so scrolling lands on the
        // next complete page.
        const availW = Math.max(200, container.clientWidth - 32);
        const availH = Math.max(200, container.clientHeight - 16);
        const dpr = window.devicePixelRatio || 1;
        container.innerHTML = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const cssScale = Math.min(availW / base.width, availH / base.height);
          const viewport = page.getViewport({ scale: cssScale * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${base.width * cssScale}px`;
          canvas.style.height = `${base.height * cssScale}px`;
          canvas.className = 'rounded-md border shadow-sm bg-white';
          const slide = document.createElement('div');
          slide.className = 'flex shrink-0 items-center justify-center';
          slide.style.minHeight = `${availH}px`;
          slide.style.scrollSnapAlign = 'start';
          slide.appendChild(canvas);
          container.appendChild(slide);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        }
        if (!cancelled) setStatus('ready');
      } catch (err) {
        if (!cancelled) { setError(err.message); setStatus('error'); }
      }
    })();

    return () => { cancelled = true; };
  }, [open, url]);

  async function download() {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
    } catch { /* the on-screen error state already covers a failed fetch */ }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[96vw] max-w-6xl flex-col sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="-mx-4 flex min-h-0 flex-1 snap-y snap-mandatory flex-col overflow-y-auto border-y bg-muted/30 px-4">
          {status === 'loading' && <p className="py-12 text-center text-sm text-muted-foreground">Rendering PDF…</p>}
          {status === 'error' && <p className="py-12 text-center text-sm text-destructive">{error}</p>}
          {/* React never gives this div JSX children, so it never tries to reconcile/remove the
              canvases the effect below appends imperatively — mixing the two on one node risks
              React trying to remove a DOM node that manual innerHTML/appendChild already touched. */}
          <div ref={containerRef} className="flex flex-col gap-4" />
        </div>
        <DialogFooter className="flex-row justify-end gap-2">
          {actions}
          <Button variant="outline" onClick={download}><DownloadIcon data-icon="inline-start" />Download</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
