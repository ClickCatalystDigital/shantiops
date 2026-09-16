import { getProjectsWithStatus, getCustomers, getSaleOrders, groupProjectsByMaster, getScopeOfSupply } from '@/lib/data';
import { getFreshSessionUser, isDesignHead, canAccessDepartment } from '@/lib/auth';
import NewProjectForm from '@/components/NewProjectForm';
import ConvertSaleOrderButton from '@/components/ConvertSaleOrderButton';
import PageHeader from '@/components/PageHeader';
import ProjectsListTable from '@/components/ProjectsListTable';
import ScopeOfSupplySection from '@/components/ScopeOfSupplySection';

export const dynamic = 'force-dynamic';

export default async function Projects({ searchParams }) {
  const user = await getFreshSessionUser();
  const canCreate = isDesignHead(user);
  // Project View redesign, Part 4 — full Scope-of-Supply editing relocated here from the project
  // page. /projects has no department gate of its own (any internal user can already view the bare
  // list), so this section needs its OWN new visibility gate — the same boolean that already
  // correctly gates SoS editing on the project page, just applied to the section's mere presence
  // too, not only its edit controls.
  const canEditScope = canAccessDepartment(user, 'Design') || canAccessDepartment(user, 'Engineering');
  const sp = await searchParams;
  const scopeProjectId = canEditScope && sp?.project ? Number(sp.project) : null;
  const [projects, customers, saleOrders, scopeOfSupply] = await Promise.all([
    getProjectsWithStatus(), canCreate ? getCustomers() : [], canCreate ? getSaleOrders() : [],
    scopeProjectId ? getScopeOfSupply(scopeProjectId) : [],
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

      {canEditScope && (
        <ScopeOfSupplySection projects={projects} scopeOfSupply={scopeOfSupply} canEdit
          initialProject={sp?.project} />
      )}
    </main>
  );
}
