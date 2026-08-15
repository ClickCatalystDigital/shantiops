'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { MonitorSmartphoneIcon, Globe2Icon, UsersIcon, MailIcon, ShieldCheckIcon } from 'lucide-react';
import DevicesPanel from '@/components/DevicesPanel';
import BrowserPanel from '@/components/BrowserPanel';
import PeoplePanel from '@/components/PeoplePanel';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';

function ComingSoon({ text }) {
  return <Card><CardContent className="py-10 text-center text-muted-foreground">{text}</CardContent></Card>;
}

export default function ApprovalsWorkspace({ user, data, browser, employees, people, canManagePeople }) {
  const [tab, setTab] = useState('devices');
  const items = [
    { key: 'devices', label: 'Devices', icon: MonitorSmartphoneIcon },
    { key: 'browser', label: 'Browser', icon: Globe2Icon },
    ...(canManagePeople ? [{ key: 'people', label: 'People', icon: UsersIcon }] : []),
    { key: 'mail', label: 'Mail', icon: MailIcon },
  ];

  return (
    <WorkspaceSidebar title="Approvals" icon={ShieldCheckIcon} items={items} activeKey={tab} onChange={setTab}>
      {tab === 'devices' && <DevicesPanel user={user} initial={data} employees={employees} />}
      {tab === 'browser' && <BrowserPanel user={user} initial={browser} />}
      {tab === 'people' && canManagePeople && <PeoplePanel user={user} initial={people} />}
      {tab === 'mail' && <ComingSoon text="Zoho mail attachment approvals — coming soon. External emails with attachments will need manager sign-off here." />}
    </WorkspaceSidebar>
  );
}
