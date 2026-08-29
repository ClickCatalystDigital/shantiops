'use client';

// lib/use-entity-highlight.js — the "inline list row" half of the deep-link mechanism (the
// continue-the-entity-ref-tagging plan's Part B). A page reads `?highlight=CODE` from the URL and
// passes the code here; once a row carrying `data-entity-code={code}` exists in the DOM, it's
// scrolled into view and briefly flashed. The "click-to-open detail" half (Job Card, Work Order)
// doesn't use this hook at all — it just compares `highlight` to a loaded row's own code and opens
// the same detail view a click would.
//
// Silently no-ops if the row never appears (wrong tab, filtered out, code doesn't exist) — same
// graceful-degrade philosophy as an unresolved tag in free text, never an error.
import { useEffect } from 'react';

const FLASH_MS = 1600;
const RETRY_MS = 150;
const MAX_RETRIES = 10; // ~1.5s — covers a tab switch + one client-side data fetch, not more

export function useEntityHighlight(code) {
  useEffect(() => {
    if (!code) return undefined;
    let tries = 0;
    let timer;
    function attempt() {
      const el = document.querySelector(`[data-entity-code="${CSS.escape(code)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('entity-highlight-flash');
        setTimeout(() => el.classList.remove('entity-highlight-flash'), FLASH_MS);
        return;
      }
      if (tries++ < MAX_RETRIES) timer = setTimeout(attempt, RETRY_MS);
    }
    attempt();
    return () => clearTimeout(timer);
  }, [code]);
}
