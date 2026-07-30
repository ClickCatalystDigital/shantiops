import './globals.css';
import Nav from '@/components/Nav';
import DeviceSetupGate from '@/components/DeviceSetupGate';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getSessionUser, isInternal, needsDeviceEnrollment, isDemoUser } from '@/lib/auth';
import { getMyMachine } from '@/lib/data';

export const metadata = {
  title: `${process.env.BRAND_PREFIX || 'SB'} Ops — Shanti Boilers`,
  description: 'Project SLA tracking & dispatch',
};

// Set the theme before first paint so there's no light→dark flash.
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default async function RootLayout({ children }) {
  const user = getSessionUser();
  // Functional heads, plus any self-registered "Project Manager" account (see
  // needsDeviceEnrollment) — the bootstrap admin/manager/executive seed accounts stay
  // unblocked so someone can always register machines / approve people.
  const gated = needsDeviceEnrollment(user);
  const machine = gated ? await getMyMachine(user.id) : null;
  const needsDeviceSetup = gated && !isDemoUser(user) && !(machine?.enrolled_at || machine?.last_seen);

  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInit }} /></head>
      <body className="min-h-screen bg-background text-foreground">
        <TooltipProvider delayDuration={200}>
          {isInternal(user) && !needsDeviceSetup && <Nav user={user} />}
          {/* Extra bottom padding on mobile so content clears the fixed bottom tab bar (internal only). */}
          <div className={isInternal(user) ? 'pb-20 md:pb-0' : ''}>
            {needsDeviceSetup ? <DeviceSetupGate machine={machine} /> : children}
          </div>
        </TooltipProvider>
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
