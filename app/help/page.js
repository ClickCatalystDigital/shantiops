import Link from 'next/link';
import { getFreshSessionUser, isPM, isHead, isCustomer, headDepartments } from '@/lib/auth';
import { CUSTOMER_GUIDE } from '@/components/help-content';
import { DEPARTMENT_HELP_ORDER } from '@/components/department-help-content';
import PageHeader from '@/components/PageHeader';
import LogoutButton from '@/components/LogoutButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DepartmentHelpWorkspace from '@/components/DepartmentHelpWorkspace';

export const dynamic = 'force-dynamic';

function GuideSection({ title, icon: Icon, steps }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Icon className="size-4 text-primary" />{title}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <div key={s.title} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{i + 1}</span>
            <div>
              <div className="text-sm font-medium">{s.title}</div>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default async function HelpPage() {
  const user = await getFreshSessionUser();

  if (isCustomer(user)) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-muted/40 to-background">
        <header className="border-b bg-background/80 backdrop-blur">
          <div className="container flex h-14 items-center justify-between">
            <div className="text-base font-bold tracking-tight">SHANTI<span className="text-primary">BOILERS</span></div>
            <LogoutButton />
          </div>
        </header>
        <main className="container flex max-w-3xl flex-col gap-4 py-8">
          <Link href="/portal" className="text-sm text-muted-foreground hover:underline">← My Orders</Link>
          <h1 className="text-2xl font-bold tracking-tight">Help</h1>
          <div className="grid gap-4 sm:grid-cols-2">
            {CUSTOMER_GUIDE.map(s => <GuideSection key={s.title} {...s} />)}
          </div>
        </main>
      </div>
    );
  }

  const departments = isPM(user) ? DEPARTMENT_HELP_ORDER : isHead(user) ? headDepartments(user) : [];
  if (!departments.length) {
    return (
      <main className="container flex flex-col gap-6 py-8">
        <PageHeader title="Help" description="Your department guides" />
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          No departments assigned yet — contact your PM for a guide to your work.
        </CardContent></Card>
      </main>
    );
  }

  return <DepartmentHelpWorkspace departments={departments} />;
}
