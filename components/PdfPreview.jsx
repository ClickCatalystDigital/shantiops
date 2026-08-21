//  components/PdfPreview.jsx


'use client';

// In-app PDF preview, rendered to <canvas> via PDF.js rather than an embedded <iframe>/browser
// plugin — the native iframe approach depends on the browser's own PDF viewer being enabled, and
// some browsers/settings download instead of showing it inline. Canvas rendering works the same
// way regardless of the viewer's PDF/download configuration.
//
// Centered, large modal rather than a side drawer — a dense statutory table (18 columns on Form
// IV A) needs real width. One page per screen: each page is scaled to CONTAIN within the scroll
// viewport (both width and height) and sits in a slide exactly the viewport's height, with
// scroll-snap, so exactly one whole page shows and scrolling lands on the next. Re-renders on resize
// so it stays one-page-per-screen on mobile / rotation too.
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DownloadIcon } from 'lucide-react';

export default function PdfPreview({ open, onOpenChange, url, title, description, filename, actions }) {
  const scrollRef = useRef(null);     // the overflow-y-auto viewport we size pages against
  const containerRef = useRef(null);  // canvases mount here; never given JSX children (see note)
  const pdfRef = useRef(null);        // the parsed PDF, kept so a resize can re-render without refetch
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let seq = 0;      // guards against two re-renders (e.g. resize during render) interleaving
    let ro, t;
    setStatus('loading');
    setError(null);
    pdfRef.current = null;

    // Lay out every page at "one page per viewport": scale to fit inside the scroll viewport's
    // width AND height (so a whole page shows, never cut off), in a slide exactly the viewport's
    // height so only one page is visible and scroll-snap lands on the next. Measured against the
    // scroller's ACTUAL size (via ResizeObserver) so it's correct after the open animation and on
    // mobile / rotation — measuring too early gave a stale width and overflowed the page sideways.
    async function renderPages() {
      const pdf = pdfRef.current;
      const scroller = scrollRef.current;
      const container = containerRef.current;
      if (!pdf || !scroller || !container) return;
      const my = ++seq;
      const availW = Math.max(200, scroller.clientWidth - 32);
      const availH = Math.max(200, scroller.clientHeight - 16);
      const dpr = window.devicePixelRatio || 1;
      container.innerHTML = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        if (cancelled || my !== seq) return;   // a newer render superseded this one
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
        slide.style.height = `${availH}px`;
        slide.style.scrollSnapAlign = 'center';
        slide.appendChild(canvas);
        if (my !== seq) return;
        container.appendChild(slide);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      }
    }

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
        // scripts/copy-pdf-worker.js on every `npm install`).
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setStatus('ready');   // reveal the scroll viewport so it has a real size to observe

        // ResizeObserver fires once on observe (initial render) and again on every real size change.
        ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(renderPages, 80); });
        ro.observe(scrollRef.current);
      } catch (err) {
        if (!cancelled) { setError(err.message); setStatus('error'); }
      }
    })();

    return () => { cancelled = true; clearTimeout(t); ro?.disconnect(); };
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
        <div ref={scrollRef} className="-mx-4 flex min-h-0 flex-1 snap-y snap-mandatory flex-col overflow-y-auto border-y bg-muted/30 px-4">
          {status === 'loading' && <p className="py-12 text-center text-sm text-muted-foreground">Rendering PDF…</p>}
          {status === 'error' && <p className="py-12 text-center text-sm text-destructive">{error}</p>}
          {/* React never gives this div JSX children, so it never tries to reconcile/remove the
              canvases the effect appends imperatively. */}
          <div ref={containerRef} className="flex flex-col" />
        </div>
        <DialogFooter className="flex-row justify-end gap-2">
          {actions}
          <Button variant="outline" onClick={download}><DownloadIcon data-icon="inline-start" />Download</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
