'use client';

// Calc Sheets landing page: pick a project (type to search) and/or search sheet names; every sheet is a card with its
// project. A project must be picked to add a sheet. Any sheet can be deleted from its card.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Calculator, Search, Trash2, FileText, Clock, X, Plus } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import SearchableSelect from '@/components/SearchableSelect';
import NewCalcSheetForm from '@/components/NewCalcSheetForm';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

const ALL = 'all';

export default function CalcSheetsBrowser({ projects, sheets, initialProjectId }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects.some((p) => p.id === initialProjectId) ? initialProjectId : null);
  const [query, setQuery] = useState('');
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => [
    { value: ALL, label: 'All projects' },
    ...projects.map((p) => ({ value: p.id, label: `${p.project_no} · ${p.customer_name || ''}` })),
  ], [projects]);
  const project = projects.find((p) => p.id === projectId) || null;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sheets.filter((s) => (!projectId || s.project_id === projectId)
      && (!q || `${s.name} ${s.cs_no || ''}`.toLowerCase().includes(q)));
  }, [sheets, projectId, query]);

  function pickProject(v) {
    const id = v === ALL || v == null ? null : Number(v);
    setProjectId(id);
    window.history.replaceState(null, '', id ? `/calc?project=${id}` : '/calc');
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await api(`/api/calc-sheets/${toDelete.id}`, { method: 'DELETE' });
      showToast('Calculation sheet deleted');
      setToDelete(null);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Calc Sheets</h1>
        <p className="text-sm text-muted-foreground">
          {shown.length} of {sheets.length} calculation sheet{sheets.length === 1 ? '' : 's'}
          {project ? ` · ${project.project_no}` : ''}
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border bg-card p-2 shadow-sm sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="border-0 bg-transparent pl-9 shadow-none focus-visible:ring-0" placeholder="Search sheet names…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="hidden h-6 w-px bg-border sm:block" />
        <SearchableSelect
          className="sm:w-72"
          inputClassName="border-0 bg-transparent shadow-none focus-visible:ring-0"
          value={projectId ?? ALL}
          onChange={pickProject}
          options={options}
          placeholder="Type a project number or customer…"
        />
        {(projectId || query) && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { pickProject(null); setQuery(''); }}>
            <X data-icon="inline-start" />Clear
          </Button>
        )}
        {project ? <NewCalcSheetForm projectId={project.id} /> : (
          <Button disabled title="Pick a project first"><Plus data-icon="inline-start" />New Calculation Sheet</Button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
          <Calculator className="size-8 text-muted-foreground/60" />
          <p className="text-sm font-medium">No calculation sheets {project ? `on ${project.project_no}` : 'match'} yet</p>
          <p className="text-xs text-muted-foreground">
            {project ? 'Use New Calculation Sheet above. It starts from this project’s capacity and pressure.' : 'Change the filters, or pick a project to add one.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((s) => (
            <Card key={s.id} className="group relative transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <Link href={`/calc/project/${s.project_id}/${s.id}`} className="absolute inset-0 z-0" aria-label={`Open ${s.name}`} />
              <CardContent className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Calculator className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 font-semibold leading-snug" title={s.name}>{s.name}</div>
                    {s.cs_no && <div className="mt-0.5 font-mono text-xs text-muted-foreground">{s.cs_no}</div>}
                  </div>
                  <Button
                    variant="ghost" size="icon-sm" title="Delete calculation sheet"
                    className="relative z-10 text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
                    onClick={() => setToDelete(s)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <div className="text-sm font-medium">{s.project_no}</div>
                  <div className="truncate text-xs text-muted-foreground">{s.customer_name}</div>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <FileText className="size-3.5" />
                    {s.snapshot_count ? `${s.snapshot_count} snapshot${s.snapshot_count === 1 ? '' : 's'}` : 'No snapshot yet'}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="size-3.5" />
                    {formatDate(s.last_saved || s.created_at)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this calculation sheet?</DialogTitle>
            <DialogDescription>
              {toDelete && <>“{toDelete.name}” on {toDelete.project_no}, with its inputs, {toDelete.snapshot_count || 0} saved snapshot{toDelete.snapshot_count === 1 ? '' : 's'} and drawing links, is removed for good. Drawings themselves stay.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={confirmDelete}>{busy ? 'Deleting…' : 'Delete sheet'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
