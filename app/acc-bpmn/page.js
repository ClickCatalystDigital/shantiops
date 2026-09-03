// app/acc-bpmn/page.js — the Accounts workflow audit + BPMN drawing guide. Static reference
// content, no live data. Deliberately public (added to middleware.js's PUBLIC_PATHS) — explicit
// product decision, not an oversight: reachable without a login, same as /d-login.
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import AccBpmnAtlas from '@/components/AccBpmnAtlas';

const fraunces = Fraunces({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-fraunces' });
const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-plex-sans' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-mono' });

export default function AccBpmnPage() {
  return (
    <div className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <AccBpmnAtlas />
    </div>
  );
}
