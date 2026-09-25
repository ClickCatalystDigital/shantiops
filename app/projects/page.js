import { getProjectsWithStatus, getCustomers, groupProjectsByMaster } from '@/lib/data';
import { getFreshSessionUser, isDesignHead } from '@/lib/auth';
import NewProjectForm from '@/components/NewProjectForm';
import PageHeader from '@/components/PageHeader';
import ProjectsListTable from '@/components/ProjectsListTable';

export const dynamic = 'force-dynamic';

export default async function Projects() {
  const user = await getFreshSessionUser();
  const canCreate = isDesignHead(user);
  // Scope of Supply editing lived here (Project View redesign, Part 4) until 2026-09-18, when it
  // moved entirely to Sales' own workspace (components/SalesWorkspace.jsx's "Scope of Supply" tab,
  // components/ScopeOfSupplySection.jsx reused verbatim) — pricing is Sales' business, and once
  // Design/Engineering's own copy of it had to hide money anyway, there was nothing left here that
  // Sales' full copy didn't already cover. See app/projects/[id]/page.js's ProjectDesignRow for the
  // read-only, money-gated download-link card that replaces it on the project detail page.
  // Sale Orders aren't preloaded: the form's SaleOrderPicker searches the API (1,000+ orders).
  const [projects, customers] = await Promise.all([
    getProjectsWithStatus(), [] /* customers: CustomerPicker searches the API */,
  ]);
  // Multi-unit split — a master's real children (master_project_id set) are grouped under their
  // master here instead of appearing as N+1 separate top-level rows; a project with no children is
  // completely unaffected (childSummary null, children []).
  const grouped = groupProjectsByMaster(projects);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Projects" description="Every customer order, design → commissioning">
        {canCreate && <NewProjectForm customers={customers} />}
      </PageHeader>

      <ProjectsListTable projects={grouped} />
    </main>
  );
}
