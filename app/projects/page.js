import { getProjectsWithStatus, getCustomers, getSaleOrders, groupProjectsByMaster } from '@/lib/data';
import { getFreshSessionUser, isDesignHead } from '@/lib/auth';
import NewProjectForm from '@/components/NewProjectForm';
import ConvertSaleOrderButton from '@/components/ConvertSaleOrderButton';
import PageHeader from '@/components/PageHeader';
import ProjectsListTable from '@/components/ProjectsListTable';

export const dynamic = 'force-dynamic';

export default async function Projects() {
  const user = await getFreshSessionUser();
  const canCreate = isDesignHead(user);
  const [projects, customers, saleOrders] = await Promise.all([
    getProjectsWithStatus(), canCreate ? getCustomers() : [], canCreate ? getSaleOrders() : [],
  ]);
  const openSaleOrders = saleOrders.filter(so => !so.project_id && so.item_count > 0);
  // Multi-unit split — a master's real children (master_project_id set) are grouped under their
  // master here instead of appearing as N+1 separate top-level rows; a project with no children is
  // completely unaffected (childSummary null, children []).
  const grouped = groupProjectsByMaster(projects);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Projects" description="Every customer order, design → commissioning">
        {canCreate && <ConvertSaleOrderButton saleOrders={openSaleOrders} />}
        {canCreate && <NewProjectForm customers={customers} />}
      </PageHeader>

      <ProjectsListTable projects={grouped} />
    </main>
  );
}
