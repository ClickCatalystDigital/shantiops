'use client';

// Google Analytics for the public demo only: app/layout.js renders this when DEMO_MODE=1,
// so it never loads on a client's own deployment. Same GA4 property and consent cookie as
// ahromlabs.com (ahrom-labs/docs/analytics-strategy.md), so one visitor is followed from
// the website into the demo and a visitor who answered there isn't asked again.
// ponytail: mirrors ahrom-labs/src/components/Analytics.tsx; the repos share no package.

import { useEffect, useState, useSyncExternalStore } from 'react';

const GA_ID = 'G-BC080TXMMZ';

const readConsent = () => document.cookie.match(/(?:^|; )ga_consent=([^;]*)/)?.[1] ?? null;
const noSubscribe = () => () => {};

function saveConsent(value) {
  const domain = location.hostname.endsWith('ahromlabs.com') ? '; domain=ahromlabs.com' : '';
  document.cookie = `ga_consent=${value}; path=/; max-age=31536000; SameSite=Lax${domain}`;
}

function loadGa() {
  if (document.getElementById('ga-js')) return;
  window.dataLayer = window.dataLayer || [];
  // gtag.js expects the arguments object itself, not an array.
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID);
  const s = document.createElement('script');
  s.id = 'ga-js';
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}

// No-op until the visitor accepts (gtag only exists after consent).
export function track(event, params) {
  window.gtag?.('event', event, params);
}

export default function DemoAnalytics() {
  const consent = useSyncExternalStore(noSubscribe, readConsent, () => 'pending');
  const [answered, setAnswered] = useState(false);

  useEffect(() => { if (readConsent() === 'granted') loadGa(); }, []);

  if (consent !== null || answered) return null;

  const choose = (value) => {
    saveConsent(value);
    if (value === 'granted') loadGa();
    setAnswered(true);
  };

  return (
    <div role="region" aria-label="Analytics consent"
      className="fixed inset-x-4 bottom-4 z-[60] mx-auto flex max-w-lg flex-wrap items-center gap-3 rounded-lg border bg-background p-3 text-sm text-muted-foreground shadow-md print:hidden">
      <p className="flex-[1_1_16rem]">We use Google Analytics to see which parts of the demo help. No ads, nothing sold.</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => choose('denied')} className="rounded-md border px-3 py-1.5 font-medium text-foreground">Decline</button>
        <button type="button" onClick={() => choose('granted')} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Accept</button>
      </div>
    </div>
  );
}
