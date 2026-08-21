//  components/PdfPreview.jsx


'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DownloadIcon } from 'lucide-react';

export default function PdfPreview({ open, onOpenChange, url, title, description, filename, actions }) {
  const scrollRef = useRef(null);
  const pdfRef = useRef(null);
  const canvasRefs = useRef([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [numPages, setNumPages] = useState(0);

  // Paints into each page's own canvas — mutates width/height/pixels only, never the DOM tree.
  // The canvases themselves are mounted/unmounted purely by the numPages-driven map in the JSX below.
  const renderPages = useCallback(async () => {
    const pdf = pdfRef.current;
    const scroller = scrollRef.current;
    if (!pdf || !scroller) return;
    const availW = Math.max(200, scroller.clientWidth - 32);
    const availH = Math.max(200, scroller.clientHeight - 16);
    const dpr = window.devicePixelRatio || 1;
    for (let i = 1; i <= pdf.numPages; i++) {
      const canvas = canvasRefs.current[i - 1];
      if (!canvas) continue;
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const cssScale = Math.min(availW / base.width, availH / base.height);
      const viewport = page.getViewport({ scale: cssScale * dpr });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${base.width * cssScale}px`;
      canvas.style.height = `${base.height * cssScale}px`;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
  }, []);

  // Fetch + parse only — no DOM work here.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);
    pdfRef.current = null;
    canvasRefs.current = [];
    setNumPages(0);

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Couldn't load the PDF (${res.status})`);
        }
        const buf = await res.arrayBuffer();
        if (cancelled) return;

        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        setStatus('ready');
      } catch (err) {
        if (!cancelled) { setError(err.message); setStatus('error'); }
      }
    })();

    return () => { cancelled = true; };
  }, [open, url]);

  // Paint once canvases exist, and repaint on resize — decoupled from fetching so a resize never refetches.
  useEffect(() => {
    if (status !== 'ready' || !numPages || !scrollRef.current) return;
    let t;
    renderPages();
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(renderPages, 80); });
    ro.observe(scrollRef.current);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [status, numPages, renderPages]);

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
          {Array.from({ length: numPages }).map((_, i) => (
            <div key={i} className="flex shrink-0 items-center justify-center" style={{ minHeight: 200, scrollSnapAlign: 'center' }}>
              <canvas ref={el => { canvasRefs.current[i] = el; }} className="rounded-md border shadow-sm bg-white" />
            </div>
          ))}
        </div>
        <DialogFooter className="flex-row justify-end gap-2">
          {actions}
          <Button variant="outline" onClick={download}><DownloadIcon data-icon="inline-start" />Download</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}