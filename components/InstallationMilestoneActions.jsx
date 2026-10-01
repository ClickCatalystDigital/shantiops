'use client';

// Site Installation and Commissioning have no data anywhere else in the app to auto-detect
// completion from (no site-visit log, no commissioning record) — unlike Production/QC/Dispatch's
// milestones, which lib/milestone-auto.js infers from job cards/QC records/packing status. This is
// the explicit substitute: a real, standardized action instead of the generic milestone-status
// drawer, same shortcut pattern as Design's "Approve Design" button (DesignPanel.jsx).
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { CheckIcon, CameraIcon, ChevronDownIcon } from 'lucide-react';

// Progress photos load only when the section is opened (the card is on every project page).
function PhotosSection({ projectId, count }) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState(null);
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && photos === null) {
      try { setPhotos(await api(`/api/installation-photos?project_id=${projectId}`)); } catch (err) { showToast(err.message, 'error'); setPhotos([]); }
    }
  }
  return (
    <div className="flex flex-col gap-2 px-4 py-2.5 text-sm">
      <button type="button" onClick={toggle} className="flex items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2 font-medium"><CameraIcon className="size-4 text-muted-foreground" />Progress photos{count ? ` (${count})` : ''}</span>
        <ChevronDownIcon className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (photos === null ? <p className="text-xs text-muted-foreground">Loading…</p>
        : photos.length === 0 ? <p className="text-xs text-muted-foreground">No photos yet. Add them from Installation → Progress Photos.</p> : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
          {photos.map(p => (
            <Link key={p.id} href={`/installation?tab=photos`} className="relative aspect-square overflow-hidden rounded-lg border bg-muted" title={[p.stage, p.remarks].filter(Boolean).join(' — ')}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/installation-photos/${p.id}/image`} alt="" loading="lazy" className="size-full object-cover" />
              {p.stage && <span className="absolute left-1 top-1 rounded bg-background/85 px-1 text-[10px]">{p.stage}</span>}
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function InstallationMilestoneActions({ projectId, milestones = [], canMark = false, summary = null }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState(null);
  const targets = milestones.filter(m => m.milestone_key === 'site_installation' || m.milestone_key === 'commissioning');
  if (!targets.length) return null;

  async function markComplete(m) {
    setBusyId(m.id);
    try {
      await api(`/api/milestones/${m.id}`, { method: 'PATCH', body: { status: 'done' } });
      showToast(`${m.milestone_label} marked complete`);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  const isDone = m => !!(m.actual_end || m.status === 'done');

  return (
    <Card>
      <CardHeader><CardTitle>Installation Progress</CardTitle></CardHeader>
      <CardContent className="flex flex-col divide-y p-0">
        {summary && (
          <div className="flex flex-col gap-1.5 px-4 py-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">Site visits</span>
              <span className="text-xs text-muted-foreground">{summary.done} of {summary.planned} done · {Math.max(summary.planned - summary.done, 0)} remaining</span>
            </div>
            {summary.reports.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {summary.reports.map(r => (
                  <a key={r.id} href={`/api/installation-reports/${r.id}/pdf`} target="_blank" rel="noreferrer" className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted">
                    {r.report_no} · {r.call_type}
                  </a>
                ))}
              </div>
            )}
            <a href="/installation" className="w-fit text-xs text-primary hover:underline">Open Installation →</a>
          </div>
        )}
        {summary && <PhotosSection projectId={projectId} count={summary.photos} />}
        {targets.map(m => (
          <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm font-medium">{m.milestone_label}</span>
            {isDone(m) ? (
              <span className="flex items-center gap-1 text-xs text-success"><CheckIcon className="size-3.5" />Complete</span>
            ) : canMark ? (
              <Button size="sm" variant="outline" disabled={busyId === m.id} onClick={() => markComplete(m)}>
                {busyId === m.id ? 'Marking…' : 'Mark complete'}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">Not yet complete</span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
