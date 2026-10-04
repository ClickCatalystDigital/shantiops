'use client';

// Crop a logo before it is saved, with a live preview of the purchase order header. No library:
// the crop box is four fractions of the image (x, y, w, h), dragged by its body or corners; the
// preview is the same <img> shifted and clipped with CSS, sized by the PDF's own rule (logoBox).
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { logoBox } from '@/lib/logo-box.mjs';

const FULL = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.05;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const CORNERS = { nw: 'left-0 top-0 cursor-nwse-resize', ne: 'right-0 top-0 cursor-nesw-resize', sw: 'left-0 bottom-0 cursor-nesw-resize', se: 'right-0 bottom-0 cursor-nwse-resize' };

export default function LogoCropDialog({ file, name, busy, onCancel, onSave }) {
  const [url, setUrl] = useState(null);
  const [nat, setNat] = useState(null); // natural size of the picked image
  const [crop, setCrop] = useState(FULL);
  const boxRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u); setNat(null); setCrop(FULL);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  function start(e, mode) {
    e.preventDefault(); e.stopPropagation();
    drag.current = { mode, x0: e.clientX, y0: e.clientY, c: crop, r: boxRef.current.getBoundingClientRect() };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e) {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.x0) / d.r.width, dy = (e.clientY - d.y0) / d.r.height;
    let { x, y, w, h } = d.c;
    if (d.mode === 'move') { x = clamp(x + dx, 0, 1 - w); y = clamp(y + dy, 0, 1 - h); }
    else {
      let x2 = x + w, y2 = y + h;
      if (d.mode.includes('w')) x = clamp(x + dx, 0, x2 - MIN); else x2 = clamp(x2 + dx, x + MIN, 1);
      if (d.mode.includes('n')) y = clamp(y + dy, 0, y2 - MIN); else y2 = clamp(y2 + dy, y + MIN, 1);
      w = x2 - x; h = y2 - y;
    }
    setCrop({ x, y, w, h });
  }
  const handlers = mode => ({ onPointerDown: e => start(e, mode), onPointerMove: move, onPointerUp: () => { drag.current = null; } });

  // Preview: 1 px = 1 pt of the printed page.
  const box = nat ? logoBox(nat.w * crop.w, nat.h * crop.h) : null;
  const k = box ? box.width / (nat.w * crop.w) : 1;
  const [first, ...rest] = String(name || '').toUpperCase().split(/\s+/);

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onCancel(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Crop logo</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex justify-center rounded-md border bg-[repeating-conic-gradient(#e5e7eb_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2">
            <div ref={boxRef} className="relative inline-block touch-none select-none overflow-hidden">
              {url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" draggable={false} className="block max-h-72 max-w-full"
                  onLoad={e => setNat({ w: e.currentTarget.naturalWidth || e.currentTarget.clientWidth, h: e.currentTarget.naturalHeight || e.currentTarget.clientHeight })} />
              )}
              {nat && (
                <div {...handlers('move')} className="absolute cursor-move border border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
                  style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}>
                  {Object.entries(CORNERS).map(([m, cls]) => (
                    <span key={m} {...handlers(m)} className={`absolute size-4 border-2 border-white bg-primary ${cls}`} />
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Drag the box or its corners to keep only the part you want.</span>
            <Button size="sm" variant="ghost" onClick={() => setCrop(FULL)}>Reset</Button>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Purchase order header preview</p>
            <div className="overflow-x-auto rounded-md border bg-white p-5 text-black">
              <div style={{ width: 539 }}>
                <div className="mb-1 flex items-center">
                  {box && (
                    <div style={{ width: box.width, height: box.height, overflow: 'hidden', flexShrink: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" draggable={false}
                        style={{ display: 'block', maxWidth: 'none', width: nat.w * k, height: nat.h * k, transform: `translate(${-crop.x * nat.w * k}px, ${-crop.y * nat.h * k}px)` }} />
                    </div>
                  )}
                  {box && !box.wide && (
                    <div className="ml-2.5 text-[22px] font-bold leading-none tracking-wide text-[#0F2A4D]">
                      <div>{first}</div>{rest.length ? <div>{rest.join(' ')}</div> : null}
                    </div>
                  )}
                </div>
                <div className="mt-1 border-y border-black py-1 text-center text-[13px] font-bold tracking-wider">PURCHASE ORDER</div>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button disabled={busy || !nat} onClick={() => onSave(crop)}>{busy ? 'Saving…' : 'Save logo'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
