// components/FloatingPdfPanel.jsx

'use client';

import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

// Floats a panel to the left of a Sheet's own frame instead of embedding it inline — portaled
// straight to <body>, positioned above the Sheet's own dim/blur overlay (z-[60] beats the overlay's
// z-50), reusing the exact glass/ring/blur tokens SheetContent itself uses so it reads as part of
// the same system rather than a bolted-on extra. It has no open/close animation or focus trap of
// its own — it's a passive companion; the Sheet still owns Escape and overlay-click-to-close.
// Extracted out of CertForm.jsx (its own Test Certificate source-PDF panel), which documents the
// two real bugs a *sibling* portal — not a child of the Sheet's own Dialog.Content — runs into:
// 1. Radix's modal Dialog sets `document.body.style.pointerEvents = 'none'` while open, to block
//    interaction with anything outside its own content — this panel is a <body> child too, so it
//    silently inherits that and swallows every click. `pointer-events-auto` here overrides it.
// 2. Once clicks reach it again, Radix's DismissableLayer still treats a click landing here as an
//    "outside" pointer-down and closes the Sheet — `[data-pdf-panel]` here is what a caller's own
//    `onPointerDownOutside={e => { if (e.target.closest('[data-pdf-panel]')) e.preventDefault(); }}`
//    on its <SheetContent> needs to match against. Both fixes are required together.
export default function FloatingPdfPanel({ open, className, children }) {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div data-pdf-panel className={cn(
      'pointer-events-auto fixed inset-y-6 left-6 z-[60] flex w-[min(52vw,820px)] flex-col gap-2 overflow-hidden rounded-xl border bg-popover/85 p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 backdrop-blur-xl',
      className,
    )}>
      {children}
    </div>,
    document.body
  );
}
