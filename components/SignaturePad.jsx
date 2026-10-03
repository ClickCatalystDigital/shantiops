'use client';

// Finger/mouse signature. Value is a PNG data URL (~5 KB) kept in the report JSON.
// Desktop: an inline pad. Phone: a tappable preview that opens a full-screen pad (X top-right to leave);
// what is drawn there is cropped to the ink and fitted into the same 600x180 image, so the PDF is unchanged.
import { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XIcon, PenLineIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

const W = 600, H = 180;

// Pointer handlers that draw on a canvas and track the ink's bounding box.
function useInk(ref, onStroke) {
  const drawing = useRef(false);
  const box = useRef(null);
  const pos = (e) => {
    const r = ref.current.getBoundingClientRect();
    return [(e.clientX - r.left) * (ref.current.width / r.width), (e.clientY - r.top) * (ref.current.height / r.height)];
  };
  const grow = ([x, y]) => { const b = box.current; box.current = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y]; };
  const stop = () => { if (!drawing.current) return; drawing.current = false; onStroke?.(); };
  return {
    box,
    handlers: {
      onPointerDown: (e) => { drawing.current = true; ref.current.setPointerCapture(e.pointerId); const ctx = ref.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(...pos(e)); grow(pos(e)); },
      onPointerMove: (e) => { if (!drawing.current) return; const ctx = ref.current.getContext('2d'); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; ctx.lineTo(...pos(e)); ctx.stroke(); grow(pos(e)); },
      onPointerUp: stop,
      onPointerLeave: stop,
    },
  };
}

function Inline({ value, onChange }) {
  const ref = useRef(null);
  const ink = useInk(ref, () => onChange(ref.current.toDataURL('image/png')));
  // Paint the saved signature once on mount (canvas has no controlled value).
  useEffect(() => {
    const c = ref.current; const ctx = c.getContext('2d'); ctx.lineWidth = 2;
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height); img.src = value; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); onChange(''); };
  return (
    <div className="flex flex-col gap-1.5">
      {/* Always white with dark ink, so it looks the same as on the printed PDF (also in dark mode). */}
      <canvas ref={ref} width={W} height={H} {...ink.handlers} className="h-32 w-full touch-none rounded-lg border bg-white sm:h-36" />
      <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={clear}>Clear</Button>
    </div>
  );
}

function FullScreen({ value, onClose, onChange }) {
  const wrap = useRef(null);
  const ref = useRef(null);
  const ink = useInk(ref, null);
  // Canvas pixels = screen pixels (sharp lines); the saved ink is rescaled on Done.
  useEffect(() => {
    const c = ref.current; const r = wrap.current.getBoundingClientRect();
    c.width = Math.round(r.width); c.height = Math.round(r.height);
    const ctx = c.getContext('2d'); ctx.lineWidth = 3;
    if (value) {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(c.width * 0.9 / img.width, c.height * 0.5 / img.height);
        const w = img.width * k, h = img.height * k, x = (c.width - w) / 2, y = (c.height - h) / 2;
        ctx.drawImage(img, x, y, w, h);
        ink.box.current = [x, y, x + w, y + h];
      };
      img.src = value;
    }
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); ink.box.current = null; };
  function done() {
    const b = ink.box.current;
    if (!b) { onChange(''); return onClose(); }
    const pad = 12, sx = Math.max(0, b[0] - pad), sy = Math.max(0, b[1] - pad);
    const sw = Math.min(ref.current.width - sx, b[2] - b[0] + 2 * pad), sh = Math.min(ref.current.height - sy, b[3] - b[1] + 2 * pad);
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const k = Math.min(W / sw, H / sh), w = sw * k, h = sh * k;
    out.getContext('2d').drawImage(ref.current, sx, sy, sw, sh, (W - w) / 2, (H - h) / 2, w, h);
    onChange(out.toDataURL('image/png'));
    onClose();
  }
  // Portaled to <body>: the report sheet is a transformed element, which would trap a "fixed" child inside it.
  return createPortal(
    <div className="pointer-events-auto fixed inset-0 z-[80] flex flex-col bg-background" role="dialog" aria-label="Sign here">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-medium">Sign here</span>
        <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Close without saving"><XIcon /></Button>
      </div>
      <div ref={wrap} className="relative m-3 flex-1 overflow-hidden rounded-2xl border bg-white">
        <canvas ref={ref} {...ink.handlers} className="absolute inset-0 size-full touch-none" />
        <div className="pointer-events-none absolute inset-x-6 bottom-1/3 border-b border-dashed border-neutral-300" />
      </div>
      <div className="flex gap-2 px-3 pb-4">
        <Button type="button" variant="outline" className="flex-1" onClick={clear}>Clear</Button>
        <Button type="button" className="flex-[2]" onClick={done}>Done</Button>
      </div>
    </div>, document.body);
}

export default function SignaturePad({ value, onChange }) {
  const [phone, setPhone] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 767px)');
    const f = () => setPhone(m.matches);
    f(); m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  if (!phone) return <Inline value={value} onChange={onChange} />;
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={() => setOpen(true)} className="flex h-28 w-full items-center justify-center rounded-xl border bg-white disabled:opacity-60">
        {value
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={value} alt="Signature" className="max-h-full max-w-full object-contain" />
          : <span className="flex items-center gap-2 text-sm text-neutral-500"><PenLineIcon className="size-4" />Tap to sign</span>}
      </button>
      {value && <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => onChange('')}>Clear</Button>}
      {open && <FullScreen value={value} onClose={() => setOpen(false)} onChange={onChange} />}
    </div>
  );
}
