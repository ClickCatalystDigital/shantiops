'use client';

// Finger/mouse signature box. Value is a PNG data URL (~5 KB) kept in the report JSON.
import { useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function SignaturePad({ value, onChange }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  // Paint the saved signature once on mount (canvas has no controlled value).
  useEffect(() => {
    const c = ref.current;
    c.getContext('2d').lineWidth = 2;
    if (value) { const img = new Image(); img.onload = () => c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); img.src = value; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = (e) => {
    const r = ref.current.getBoundingClientRect();
    return [(e.clientX - r.left) * (ref.current.width / r.width), (e.clientY - r.top) * (ref.current.height / r.height)];
  };
  const start = (e) => { drawing.current = true; ref.current.setPointerCapture(e.pointerId); const ctx = ref.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(...pos(e)); };
  const move = (e) => { if (!drawing.current) return; const ctx = ref.current.getContext('2d'); ctx.lineCap = 'round'; ctx.strokeStyle = '#111'; ctx.lineTo(...pos(e)); ctx.stroke(); dirty.current = true; };
  const end = () => { if (!drawing.current) return; drawing.current = false; if (dirty.current) onChange(ref.current.toDataURL('image/png')); };
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); dirty.current = false; onChange(''); };

  return (
    <div className="flex flex-col gap-1.5">
      {/* Always white with dark ink, so it looks the same as on the printed PDF (also in dark mode). */}
      <canvas ref={ref} width={600} height={180} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        className="h-32 w-full touch-none rounded-lg border bg-white sm:h-36" />
      <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={clear}>Clear</Button>
    </div>
  );
}
