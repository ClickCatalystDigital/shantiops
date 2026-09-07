'use client';

// components/DrawingsWorkspace.jsx — Drawings' own top-level page (SYSTEM.md §5au's shared-picker
// idiom, e.g. BomStructureWorkspace/EngineeringWorkspace): one searchable project dropdown instead
// of a "pick a project" landing grid + a second page per project. Switching the dropdown just
// re-fetches this project's drawings client-side; DrawingsPanel itself (CalcWorkspace.jsx) is
// unchanged, reused exactly as the Calc Sheets workspace's own Drawings sidebar tab already does.
import { useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Card, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import SearchableSelect from '@/components/SearchableSelect';
import { DrawingsPanel } from '@/components/CalcWorkspace';

export default function DrawingsWorkspace({ projects, designTeam, user }) {
  const [projectId, setProjectId] = useState('');
  const [drawings, setDrawings] = useState(null);

  function load(pid) {
    return api(`/api/calc-drawings?project_id=${pid}`).then((d) => setDrawings(d.drawings)).catch((err) => showToast(err.message, 'error'));
  }

  useEffect(() => {
    if (!projectId) { setDrawings(null); return; }
    setDrawings(null);
    load(projectId);
  }, [projectId]);

  // DrawingsPanel/DrawingCard only ever call `router.refresh()` after a mutation — this stand-in
  // just re-fetches the one project's own drawing list instead, since there's no server-rendered
  // page here to refresh.
  const router = { refresh: () => projectId && load(projectId) };

  const selectedProject = projects.find((p) => String(p.id) === projectId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project</CardTitle>
        <CardDescription>
          {selectedProject ? (
            <span className="flex items-center gap-1.5">
              {selectedProject.project_no} · {selectedProject.customer_name}
              {selectedProject.series && <Badge variant="outline" className="text-[10px] font-normal">{selectedProject.series}</Badge>}
            </span>
          ) : (
            'Search for a project to view its drawing checklist.'
          )}
        </CardDescription>
        <CardAction>
          <SearchableSelect
            className="w-72"
            value={projectId} onChange={setProjectId}
            placeholder="Search project…"
            options={projects.map((p) => ({ value: String(p.id), label: `${p.project_no} · ${p.customer_name}` }))}
            displayValue={selectedProject ? `${selectedProject.project_no} · ${selectedProject.customer_name}` : undefined}
          />
        </CardAction>
      </CardHeader>

      {!projectId ? (
        <p className="px-6 pb-6 text-center text-xs text-muted-foreground">Pick a project above to see its drawings.</p>
      ) : !drawings ? (
        <div className="px-6 pb-6"><Skeleton className="h-40 w-full rounded-md" /></div>
      ) : (
        <div className="px-6 pb-6">
          <DrawingsPanel drawings={drawings} projectId={Number(projectId)} router={router} user={user} designTeam={designTeam} />
        </div>
      )}
    </Card>
  );
}
