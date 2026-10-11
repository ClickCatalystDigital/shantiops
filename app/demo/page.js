// Public demo entry (DEMO_MODE=1 only): a short form, then the visitor picks a department to enter as.
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { DEMO_ROLES } from '@/lib/demo-roles';
import DemoEntry from '@/components/DemoEntry';

export const metadata = {
  title: 'Boiler Manufacturing ERP: Live Demo | SB Ops by Ahrom Labs',
  description: 'Try SB Ops, the ERP built for boiler and pressure-vessel manufacturers: enquiry to dispatch, BOM, procurement, stores, production job cards, IBR documents, GST accounts and service.',
  robots: { index: true, follow: true },
};

export default async function DemoPage() {
  if (process.env.DEMO_MODE !== '1') notFound();
  const hasLead = (await cookies()).get('demo_lead')?.value === '1';
  return <DemoEntry roles={DEMO_ROLES} hasLead={hasLead} />;
}
