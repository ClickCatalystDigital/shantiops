'use client';

// Public demo only (app/layout.js renders it when DEMO_MODE=1). A visitor writing first through
// wa.me counts as opt-in; the "(ref: demo-boiler)" tag is parsed by the Ahrom CRM (optinSource).
// Sits above the OPS AI button (bottom-24 / md:bottom-6) and the mobile tab bar.

import { track } from './DemoAnalytics';

const TEXT = "Hi Pujan, I'm trying the boiler demo and have a question (ref: demo-boiler)";
const HREF = `https://wa.me/919426519798?text=${encodeURIComponent(TEXT)}`;

export default function DemoWhatsApp() {
  return (
    <a href={HREF} target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp"
      title="Questions? WhatsApp Pujan"
      onClick={() => track('whatsapp_click', { demo: 'boiler' })}
      className="group fixed bottom-40 right-4 z-40 flex size-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105 md:bottom-[5.5rem] md:right-6 print:hidden">
      <svg viewBox="0 0 32 32" className="size-7" fill="currentColor" aria-hidden="true">
        <path d="M16.04 3C8.86 3 3.02 8.83 3.02 16c0 2.3.6 4.54 1.75 6.52L3 29l6.64-1.74A13 13 0 0 0 16.04 29C23.2 29 29.05 23.17 29.05 16S23.2 3 16.04 3Zm0 23.8c-1.95 0-3.86-.52-5.53-1.51l-.4-.24-3.94 1.03 1.05-3.84-.26-.4A10.76 10.76 0 0 1 5.3 16c0-5.92 4.82-10.74 10.75-10.74 5.92 0 10.74 4.82 10.74 10.74 0 5.93-4.82 10.8-10.75 10.8Zm5.9-8.05c-.32-.16-1.9-.94-2.2-1.05-.3-.1-.51-.16-.73.16-.21.32-.83 1.05-1.02 1.27-.19.21-.37.24-.7.08-.32-.16-1.36-.5-2.59-1.6-.96-.85-1.6-1.9-1.79-2.22-.19-.32-.02-.5.14-.66.15-.14.32-.37.48-.56.16-.19.21-.32.32-.54.1-.21.05-.4-.03-.56-.08-.16-.72-1.74-.99-2.38-.26-.63-.53-.54-.72-.55h-.62c-.21 0-.56.08-.85.4-.3.32-1.12 1.1-1.12 2.67 0 1.58 1.15 3.1 1.31 3.32.16.21 2.26 3.45 5.47 4.84.77.33 1.36.53 1.83.68.77.24 1.47.21 2.02.13.62-.09 1.9-.78 2.17-1.53.27-.75.27-1.4.19-1.53-.08-.13-.3-.21-.62-.37Z" />
      </svg>
      <span className="pointer-events-none absolute right-14 hidden whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background shadow group-hover:block group-focus-visible:block">
        Questions? WhatsApp Pujan
      </span>
    </a>
  );
}
