// app/market/page.js — Marketing's own top-level route (2026-09-24), split off from /sales.
// Same PageHeader + <main> shape as app/pipeline/page.js: one panel doesn't need a
// WorkspaceSidebar's search/collapse/groups. Marketing-only gate, deliberately not
// Sales-or-Marketing — Sales lives at its own /sales route now.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getCampaigns } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import MarketingWorkspace from '@/components/MarketingWorkspace';

export const dynamic = 'force-dynamic';

export default async function MarketPage() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Marketing')) redirect(roleHome(user));

  const campaigns = await getCampaigns();

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Marketing" description="Campaigns" />
      <MarketingWorkspace campaigns={campaigns} />
    </main>
  );
}
