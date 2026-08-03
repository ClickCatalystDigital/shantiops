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
  const containerRef = useRef(null);
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

        const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';
        // Available render width = the scroll container's own width, minus its horizontal padding.
        const targetWidth = (container.clientWidth || 800) - 32;
        const dpr = window.devicePixelRatio || 1;

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = (targetWidth / baseViewport.width) * dpr;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${targetWidth}px`;
          canvas.className = 'mx-auto h-auto rounded-md border shadow-sm';
          container.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          if (cancelled) return;
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
        <div className="-mx-4 flex min-h-0 flex-1 flex-col overflow-y-auto border-y bg-muted/30 px-4 py-4">
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
