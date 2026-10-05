import './globals.css';
import Nav from '@/components/Nav';
import AssistantWidget from '@/components/AssistantWidget';
import DeviceSetupGate from '@/components/DeviceSetupGate';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getFreshSessionUser, isInternal, isAdmin, needsDeviceEnrollment, isDemoUser, hasSafePass } from '@/lib/auth';
import { getMyMachine } from '@/lib/data';
import { REPORT_DEPARTMENTS } from '@/lib/reports/catalog';
import { clientCompanies } from '@/lib/company-profiles';

export const metadata = {
  title: `${process.env.BRAND_PREFIX || 'SB'} Ops`,
  description: 'Project SLA tracking & dispatch',
};

// Set the theme before first paint so there's no light→dark flash.
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

function companiesInit() {
  const list = clientCompanies();
  const json = JSON.stringify({ names: list.map(c => c.company), profiles: Object.fromEntries(list.map(c => [c.company, c])) }).replace(/</g, '\\u003c');
  return `globalThis.__sbCompanies=${json};`;
}

export default async function RootLayout({ children }) {
  const user = await getFreshSessionUser();
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
        {isAdmin(user) && !needsDeviceSetup && <AssistantWidget />}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
