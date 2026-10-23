import './globals.css';
import Nav from '@/components/Nav';
import AssistantWidget from '@/components/AssistantWidget';
import DeviceSetupGate from '@/components/DeviceSetupGate';
import DemoAnalytics from '@/components/DemoAnalytics';
import DemoWhatsApp from '@/components/DemoWhatsApp';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getFreshSessionUser, isInternal, needsDeviceEnrollment, isDemoUser, hasSafePass } from '@/lib/auth';
import { getMyMachine } from '@/lib/data';
import { REPORT_DEPARTMENTS } from '@/lib/reports/catalog';
import { clientCompanies } from '@/lib/company-profiles';
import { cookies } from 'next/headers';
import { isOwnerPass } from '@/lib/demo-leads';

export function generateMetadata() {
  return {
    title: `${process.env.BRAND_PREFIX || 'SB'} Ops`,
    description: 'Project SLA tracking & dispatch',
    // Public demo: only /demo (which sets its own robots) should be indexed.
    ...(process.env.DEMO_MODE === '1' ? { robots: { index: false, follow: false } } : {}),
  };
}

// Set the theme before first paint so there's no light→dark flash.
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

function companiesInit() {
  const list = clientCompanies();
  const json = JSON.stringify({ names: list.map(c => c.company), profiles: Object.fromEntries(list.map(c => [c.company, c])) }).replace(/</g, '\\u003c');
  return `globalThis.__sbCompanies=${json};`;
}

export default async function RootLayout({ children }) {
  const user = await getFreshSessionUser();
  // Public demo: the owner-pass browser edits the saved copy (kept); every other browser's changes go at the nightly reset.
  const demoOwner = process.env.DEMO_MODE === '1' && isOwnerPass((await cookies()).get('demo_lead')?.value);
  // Functional heads, plus any self-registered "Project Manager" account (see
  // needsDeviceEnrollment) — the bootstrap admin/manager/executive seed accounts stay
  // unblocked so someone can always register machines / approve people.
  const gated = needsDeviceEnrollment(user);
  const machine = gated ? await getMyMachine(user.id) : null;
  const needsDeviceSetup = gated && !isDemoUser(user) && !hasSafePass(user) && !(machine?.enrolled_at || machine?.last_seen);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {/* The company list for client components (lib/company-profiles.js reads this global). Staff only. */}
        {isInternal(user) && <script dangerouslySetInnerHTML={{ __html: companiesInit() }} />}
      </head>
      <body className="min-h-screen bg-background text-foreground">
        <TooltipProvider delayDuration={200}>
          {isInternal(user) && !needsDeviceSetup && <Nav user={user} reportDepartments={REPORT_DEPARTMENTS} />}
          {process.env.DEMO_MODE === '1' && isInternal(user) && (
            <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur md:bottom-4 print:hidden">
              {demoOwner
                ? <span className="font-medium text-primary">Owner mode<span className="hidden sm:inline"> · changes saved</span></span>
                : <>Demo<span className="hidden sm:inline"> · resets nightly</span></>} ·{' '}
              <a href="/demo" className="font-medium text-foreground underline-offset-2 hover:underline">Switch role</a> ·{' '}
              <DemoWhatsApp />
            </div>
          )}
          {/* Extra bottom padding on mobile so content clears the fixed bottom tab bar (internal only). */}
          <div className={isInternal(user) ? 'pb-20 md:pb-0' : ''}>
            {needsDeviceSetup ? <DeviceSetupGate machine={machine} /> : children}
            <footer className="container print:hidden">
              <div className="mt-10 border-t py-4 text-right text-[11px] text-muted-foreground/80">
                SB Ops — an{' '}
                <a href="https://ahromlabs.com" target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">ahromlabs.com</a>
                {' '}product · © {new Date().getFullYear()} Ahrom Labs
              </div>
            </footer>
          </div>
        </TooltipProvider>
        {isInternal(user) && !needsDeviceSetup && <AssistantWidget demo={process.env.DEMO_MODE === '1'} />}
        <Toaster position="top-center" richColors />
        {process.env.DEMO_MODE === '1' && <DemoAnalytics />}
      </body>
    </html>
  );
}
