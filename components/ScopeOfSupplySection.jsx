'use client';

// Project View redesign, Part 4 — the full Scope-of-Supply editor's new home, relocated off the
// Project View page. Reuses ScopeOfSupplyPanel.jsx entirely unmodified; this is just the project
// picker shell around it, matching the ?project=-driven pattern already proven at /procurement and
// /qc (URL-synced selection, server refetches getScopeOfSupply on change via router.refresh()/
// navigation — ScopeOfSupplyPanel's own mutations already call router.refresh(), so this just needs
// to make picking a different project also be a real navigation, not local-only state).
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SearchableSelect from './SearchableSelect';
import ScopeOfSupplyPanel from './ScopeOfSupplyPanel';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';

export default function ScopeOfSupplySection({ projects = [], scopeOfSupply = [], canEdit = false, canSeeMoney = false, initialProject }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initProject = initialProject && projects.some(p => String(p.id) === String(initialProject)) ? Number(initialProject) : null;
  const [projectId, setProjectId] = useState(initProject);

  function pickProject(id) {
    setProjectId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id == null) params.delete('project'); else params.set('project', String(id));
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scope of Supply</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SearchableSelect
          options={projects.map(p => ({ value: p.id, label: p.customer_name ? `${p.project_no} — ${p.customer_name}` : p.project_no }))}
          value={projectId} onChange={pickProject} placeholder="Search a project to edit its Scope of Supply…" className="w-96" />
        {projectId == null ? (
          <p className="text-sm text-muted-foreground">Pick a project above to view or edit its Scope of Supply.</p>
        ) : (
          <ScopeOfSupplyPanel projectId={projectId} scopeOfSupply={scopeOfSupply} canEdit={canEdit} canSeeMoney={canSeeMoney} />
        )}
      </CardContent>
    </Card>
  );
}
