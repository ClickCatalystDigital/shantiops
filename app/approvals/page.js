import { redirect } from 'next/navigation';
import { getSessionUser, isCustomer, isHead, isPM, roleHome } from '@/lib/auth';
import { getUsbDashboard, getBrowserDashboard, getFunctionalHeads, getPeopleDashboard } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import DevicesPanel from '@/components/DevicesPanel';
import BrowserPanel from '@/components/BrowserPanel';
import PeoplePanel from '@/components/PeoplePanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

function ComingSoon({ text }) {
  return <Card><CardContent className="py-10 text-center text-muted-foreground">{text}</CardContent></Card>;
}

export default async function ApprovalsPage() {
  const user = getSessionUser();
  if (isCustomer(user) || isHead(user)) redirect(roleHome(user));

  const [data, browser] = await Promise.all([getUsbDashboard(user), getBrowserDashboard(user)]);
  const employees = isPM(user) ? await getFunctionalHeads() : null;
  const people = isPM(user) ? await getPeopleDashboard() : null;

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Approvals"
        description={isPM(user)
          ? 'Everything waiting on manager sign-off — devices, browser, and mail'
          : 'Status of your pending approval requests'} />

      <Tabs defaultValue="devices" className="flex-col gap-4">
        <div className="overflow-x-auto border-b">
          <TabsList variant="line" className="w-max justify-start px-0">
            <TabsTrigger value="devices" className="flex-none px-3 py-2">Devices</TabsTrigger>
            <TabsTrigger value="browser" className="flex-none px-3 py-2">Browser</TabsTrigger>
            {isPM(user) && <TabsTrigger value="people" className="flex-none px-3 py-2">People</TabsTrigger>}
            <TabsTrigger value="mail" className="flex-none px-3 py-2">Mail</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="devices">
          <DevicesPanel user={user} initial={data} employees={employees} />
        </TabsContent>
        <TabsContent value="browser">
          <BrowserPanel user={user} initial={browser} />
        </TabsContent>
        {isPM(user) && (
          <TabsContent value="people">
            <PeoplePanel user={user} initial={people} />
          </TabsContent>
        )}
        <TabsContent value="mail">
          <ComingSoon text="Zoho mail attachment approvals — coming soon. External emails with attachments will need manager sign-off here." />
        </TabsContent>
      </Tabs>
    </main>
  );
}
