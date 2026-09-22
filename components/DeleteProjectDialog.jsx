'use client';

// Delete Entire Project — PM + Design/Engineering Head only. Review, then decide, not a bare
// block: a project with real activity (POs, invoices, shared QC documents...) shows a document
// inventory with download links, and — unless it's the one genuine hard blocker (live split
// units) — a "Delete anyway" path once the reviewer types the project number to confirm they've
// actually looked at the list and mean to proceed. The one true hard block gets no such path.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangleIcon, DownloadIcon, Trash2Icon } from 'lucide-react';

function BlockerList({ blockers }) {
  return (
    <div className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1">
      {blockers.map(b => (
        <div key={b.key} className="rounded-md border p-3">
          <p className="text-sm font-medium">{b.label} <span className="text-muted-foreground">({b.count})</span></p>
          {b.items.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {b.items.map(it => (
                <li key={it.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{it.ref}{it.detail ? ` — ${it.detail}` : ''}</span>
                  {it.href && (
                    <a href={it.href} target="_blank" rel="noreferrer"
                      className="flex shrink-0 items-center gap-1 text-primary hover:underline">
                      <DownloadIcon className="size-3.5" />Download
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export default function DeleteProjectDialog({ project }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    setConfirmText('');
    api(`/api/projects/${project.id}/delete-preview`)
      .then(setPreview)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [open, project.id]);

  async function submit(confirmOverride) {
    setDeleting(true);
    setError('');
    try {
      await api(`/api/projects/${project.id}`, { method: 'DELETE', body: { confirmOverride } });
      showToast('Project deleted');
      setOpen(false);
      router.push('/projects');
    } catch (err) {
      // The server re-checks on every DELETE and may find new activity since the preview loaded —
      // reopening shows the fresh list.
      setError(err.message || 'Could not delete this project.');
    } finally { setDeleting(false); }
  }

  const hasHardBlock = preview?.hardBlockers?.length > 0;
  const needsReview = preview?.needsReview;
  const clean = preview && !hasHardBlock && !needsReview;
  const confirmMatches = confirmText.trim() === project.project_no;

  return (
    <Dialog open={open} onOpenChange={o => { if (!deleting) setOpen(o); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
          <Trash2Icon data-icon="inline-start" />Delete
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" onInteractOutside={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Delete {project.project_no}?</DialogTitle>
          {clean && (
            <DialogDescription>
              This permanently deletes the project — every milestone, the BOM tree, drawings, calc
              sheets, job cards, and every other record project-owned by it. This cannot be undone.
            </DialogDescription>
          )}
        </DialogHeader>

        {loading && <p className="py-4 text-sm text-muted-foreground">Checking for real activity on this project…</p>}

        {!loading && hasHardBlock && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p>This can&apos;t be deleted yet — resolve this first, there&apos;s nothing to review or decide here.</p>
            </div>
            <BlockerList blockers={preview.hardBlockers} />
          </div>
        )}

        {!loading && !hasHardBlock && needsReview && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p>This project has real activity — review it below. You can still delete everything, including these, if you mean to.</p>
            </div>
            <BlockerList blockers={preview.reviewItems} />
            <div className="flex flex-col gap-1.5 pt-1">
              <Label htmlFor="confirm-delete-project">Type <span className="font-mono font-medium text-foreground">{project.project_no}</span> to confirm</Label>
              <Input id="confirm-delete-project" value={confirmText} onChange={e => setConfirmText(e.target.value)}
                placeholder={project.project_no} disabled={deleting} autoComplete="off" />
            </div>
          </div>
        )}

        {!loading && clean && preview.linkedCertificates > 0 && (
          <p className="text-sm text-muted-foreground">
            {preview.linkedCertificates} test certificate{preview.linkedCertificates === 1 ? '' : 's'} are linked to this
            project — the certificate{preview.linkedCertificates === 1 ? '' : 's'} stay in the bank, only this association is removed.
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={deleting}>
            {hasHardBlock ? 'Close' : 'Cancel'}
          </Button>
          {clean && (
            <Button variant="destructive" onClick={() => submit(false)} disabled={deleting || loading}>
              {deleting ? 'Deleting…' : 'Delete project'}
            </Button>
          )}
          {!hasHardBlock && needsReview && (
            <Button variant="destructive" onClick={() => submit(true)} disabled={deleting || loading || !confirmMatches}>
              {deleting ? 'Deleting…' : 'Delete anyway'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
