//  components/PdfPreview.jsx


'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DownloadIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

// inline=true skips the Dialog/Header/Footer chrome and renders just the scrollable canvas content
// — reuses every fetch/render hook unchanged (the fetch effect already keys on [open, url], so an
// inline caller passes open={!!url}). Built for the Boiler Details drawing preview (Form II/III),
// which needs the same proven pdfjs rendering side-by-side with a form rather than as a modal.
export default function PdfPreview({ open, onOpenChange, url, title, description, filename, actions, inline = false }) {
  const scrollRef = useRef(null);
  const pdfRef = useRef(null);
  const canvasRefs = useRef([]);
  const renderingRef = useRef(false);
  const pendingRef = useRef(false);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [numPages, setNumPages] = useState(0);
  // Zoom is a multiplier on top of the page's own fit-to-container scale, not an absolute — 1
  // always means "fit," same convention every image viewer uses. Drag-to-pan (below) reads/writes
  // scrollLeft/scrollTop directly on the scroll container rather than a CSS transform, so it's just
  // native browser scrolling under the hood — no offset math to keep in sync with zoom.
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  // Paints into each page's own canvas — mutates width/height/pixels only, never the DOM tree.
  // The canvases themselves are mounted/unmounted purely by the numPages-driven map in the JSX below.
  //
  // Real bug found live: ResizeObserver.observe() fires its first callback on the next frame even
  // with no actual size change (a well-known browser-API footgun) — landing right on top of the
  // direct renderPages() call already firing once status becomes ready. For a large multi-page PDF
  // (this document's own 221-part Form IV A table), the per-page render loop below takes long enough
  // for both calls to overlap and both reach page.render() on the SAME <canvas> at once, which
  // pdf.js throws on ("Cannot use the same canvas during multiple render() operations") — the dialog
  // gets stuck on "Rendering PDF…" forever. Guarded with a simple mutex: a call that arrives while
  // one is already in flight is coalesced into a single trailing re-run once the current one
  // finishes, so a genuine resize during an in-progress render still repaints at the final size
  // rather than being silently dropped.
  const renderPages = useCallback(async () => {
    const pdf = pdfRef.current;
    const scroller = scrollRef.current;
    if (!pdf || !scroller) return;
    if (renderingRef.current) { pendingRef.current = true; return; }
    renderingRef.current = true;
    try {
      const availW = Math.max(200, scroller.clientWidth - 32);
      const availH = Math.max(200, scroller.clientHeight - 16);
      const dpr = window.devicePixelRatio || 1;
      for (let i = 1; i <= pdf.numPages; i++) {
        const canvas = canvasRefs.current[i - 1];
        if (!canvas) continue;
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const fitScale = Math.min(availW / base.width, availH / base.height);
        const cssScale = fitScale * zoomRef.current;
        const viewport = page.getViewport({ scale: cssScale * dpr });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${base.width * cssScale}px`;
        canvas.style.height = `${base.height * cssScale}px`;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      }
    } finally {
      renderingRef.current = false;
      if (pendingRef.current) { pendingRef.current = false; renderPages(); }
    }
  }, []);

  // Fetch + parse only — no DOM work here.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setZoom(1);
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

  // Repaint at the new pixel density whenever zoom changes — separate from the resize effect above
  // so a zoom click never tears down/reattaches the ResizeObserver. Re-centers the scroll position
  // on the same point it was at before, scaled by how much the content just grew/shrank — otherwise
  // zooming in would silently jump the view back to the top-left corner.
  const prevZoomRef = useRef(1);
  useEffect(() => {
    if (status !== 'ready' || !numPages || !scrollRef.current) return;
    const el = scrollRef.current;
    const ratio = zoom / prevZoomRef.current;
    const cx = (el.scrollLeft + el.clientWidth / 2) * ratio - el.clientWidth / 2;
    const cy = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
    renderPages().then(() => { el.scrollLeft = cx; el.scrollTop = cy; });
    prevZoomRef.current = zoom;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  function zoomBy(delta) {
    setZoom(z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)));
  }

  // Drag-to-pan, only meaningful once zoomed past fit — plain scrollLeft/scrollTop mutation, no
  // transform math to keep in sync. A ref (not state) tracks the in-progress drag so mousemove
  // never re-renders; `dragging` state only exists to drive the cursor style.
  function onPointerDown(e) {
    if (zoom <= 1 || e.button !== 0) return;
    const el = scrollRef.current;
    dragRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setDragging(true);
  }
  function onPointerMove(e) {
    if (!dragRef.current) return;
    const el = scrollRef.current;
    el.scrollLeft = dragRef.current.left - (e.clientX - dragRef.current.x);
    el.scrollTop = dragRef.current.top - (e.clientY - dragRef.current.y);
  }
  function endDrag() { dragRef.current = null; setDragging(false); }

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

  const content = (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-auto bg-muted/30',
          zoom <= 1 ? 'snap-y snap-mandatory' : dragging ? 'cursor-grabbing select-none' : 'cursor-grab',
          inline ? 'rounded-md border' : '-mx-4 border-y px-4',
        )}>
        {status === 'loading' && <p className="py-12 text-center text-sm text-muted-foreground">Rendering PDF…</p>}
        {status === 'error' && <p className="py-12 text-center text-sm text-destructive">{error}</p>}
        {Array.from({ length: numPages }).map((_, i) => (
          <div key={i} className="flex shrink-0 items-center justify-center p-2" style={{ minHeight: 200, scrollSnapAlign: zoom <= 1 ? 'center' : undefined }}>
            <canvas ref={el => { canvasRefs.current[i] = el; }} className="rounded-md border shadow-sm bg-white" draggable={false} />
          </div>
        ))}
      </div>
      {status === 'ready' && numPages > 0 && (
        <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md border bg-popover/90 p-0.5 shadow-sm backdrop-blur-xs">
          <Button size="icon-sm" variant="ghost" disabled={zoom <= ZOOM_MIN} onClick={() => zoomBy(-ZOOM_STEP)} aria-label="Zoom out">
            <ZoomOutIcon className="size-3.5" />
          </Button>
          <button type="button" onClick={() => setZoom(1)} className="w-11 text-center text-xs text-muted-foreground hover:text-foreground">
            {Math.round(zoom * 100)}%
          </button>
          <Button size="icon-sm" variant="ghost" disabled={zoom >= ZOOM_MAX} onClick={() => zoomBy(ZOOM_STEP)} aria-label="Zoom in">
            <ZoomInIcon className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );

  if (inline) {
    return <div className="flex h-full min-h-0 flex-1 flex-col">{content}</div>;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[96vw] max-w-6xl flex-col sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {content}
        <DialogFooter className="flex-row justify-end gap-2">
          {actions}
          <Button variant="outline" onClick={download}><DownloadIcon data-icon="inline-start" />Download</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}