'use client';

// Installation → Progress Photos. On a phone: tap the camera button, take the photo, and a details
// sheet opens straight away (project, stage, visit, remarks). Photos are compressed in the browser
// before upload. Gallery per project with stage filter; tap a photo to view / edit / delete.
import { useEffect, useRef, useState, useCallback } from 'react';
import { CameraIcon, ImagePlusIcon, TrashIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import SearchableSelect from '@/components/SearchableSelect';
import { projectOptions } from '@/components/InstallationVisits';
import { compressImage as compress } from '@/lib/image-compress';
import { PHOTO_STAGES } from '@/lib/installation-photo-stages.mjs';

const LAST_KEY = 'installation_last_project';
const lastProject = () => { try { return localStorage.getItem(LAST_KEY) || ''; } catch { return ''; } };

function StageChips({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PHOTO_STAGES.map(s => (
        <Button key={s} type="button" size="sm" className="h-8" variant={value === s ? 'default' : 'outline'} onClick={() => onChange(value === s ? '' : s)}>{s}</Button>
      ))}
    </div>
  );
}

function VisitSelect({ projectId, value, onChange }) {
  const [visits, setVisits] = useState([]);
  useEffect(() => {
    if (!projectId) return setVisits([]);
    api(`/api/installation-visits?project_id=${projectId}`).then(r => setVisits(r.rows)).catch(() => setVisits([]));
  }, [projectId]);
  return (
    <Select value={value ? String(value) : 'none'} onValueChange={v => onChange(v === 'none' ? '' : v)}>
      <SelectTrigger className="w-full"><SelectValue placeholder="Not linked to a visit" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Not linked to a visit</SelectItem>
        {visits.map(v => <SelectItem key={v.id} value={String(v.id)}>{v.seq}. {v.description}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function CaptureSheet({ file, takenAt, projects, defaultProject, onClose, onSaved }) {
  const [preview, setPreview] = useState('');
  const [f, setF] = useState({ project_id: defaultProject, visit_id: '', stage: '', remarks: '' });
  const [saving, setSaving] = useState(false);
  // Created in an effect (not state init) so React strict-mode's mount/unmount/mount doesn't revoke the live URL.
  useEffect(() => { const u = URL.createObjectURL(file); setPreview(u); return () => URL.revokeObjectURL(u); }, [file]);
  async function save() {
    if (!f.project_id) return showToast('Pick a project', 'error');
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('taken_at', takenAt);
      for (const k of ['project_id', 'visit_id', 'stage', 'remarks']) fd.append(k, f[k] || '');
      await api('/api/installation-photos', { method: 'POST', body: fd });
      try { localStorage.setItem(LAST_KEY, f.project_id); } catch { /* private mode */ }
      showToast('Photo saved');
      onSaved(f.project_id);
    } catch (err) { showToast(err.message, 'error'); setSaving(false); }
  }
  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-md">
        <SheetHeader><SheetTitle>Photo details</SheetTitle></SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="New site photo" className="max-h-56 w-full rounded-xl border object-contain bg-muted" />
          <p className="text-xs text-muted-foreground">Taken {new Date(takenAt).toLocaleString('en-IN')} · stamped automatically</p>
          <div className="grid gap-1.5"><Label>Project</Label>
            <SearchableSelect value={f.project_id} onChange={v => setF(x => ({ ...x, project_id: v, visit_id: '' }))} placeholder="Search a project…" options={projectOptions(projects)} />
          </div>
          <div className="grid gap-1.5"><Label>Stage</Label><StageChips value={f.stage} onChange={v => setF(x => ({ ...x, stage: v }))} /></div>
          <div className="grid gap-1.5"><Label>Visit (optional)</Label><VisitSelect projectId={f.project_id} value={f.visit_id} onChange={v => setF(x => ({ ...x, visit_id: v }))} /></div>
          <div className="grid gap-1.5"><Label>Remarks</Label><Textarea rows={3} value={f.remarks} onChange={e => setF(x => ({ ...x, remarks: e.target.value }))} placeholder="What does this show?" /></div>
        </div>
        <SheetFooter className="flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Discard</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Uploading…' : 'Save photo'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ViewSheet({ photo, onClose, onChanged }) {
  const [f, setF] = useState({ stage: photo.stage || '', remarks: photo.remarks || '', visit_id: photo.visit_id || '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api(`/api/installation-photos/${photo.id}`, { method: 'PATCH', body: f }); showToast('Saved'); onChanged(); }
    catch (err) { showToast(err.message, 'error'); setBusy(false); }
  }
  async function remove() {
    if (!window.confirm('Delete this photo?')) return;
    setBusy(true);
    try { await api(`/api/installation-photos/${photo.id}`, { method: 'DELETE' }); onChanged(); } catch (err) { showToast(err.message, 'error'); setBusy(false); }
  }
  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader><SheetTitle>{photo.project_no}</SheetTitle>
          <p className="text-xs text-muted-foreground">{new Date(photo.taken_at || photo.created_at).toLocaleString('en-IN')} · {photo.taken_by}</p></SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/installation-photos/${photo.id}/image`} alt="" className="w-full rounded-xl border bg-muted object-contain" />
          <div className="grid gap-1.5"><Label>Stage</Label><StageChips value={f.stage} onChange={v => setF(x => ({ ...x, stage: v }))} /></div>
          <div className="grid gap-1.5"><Label>Visit</Label><VisitSelect projectId={photo.project_id} value={f.visit_id} onChange={v => setF(x => ({ ...x, visit_id: v }))} /></div>
          <div className="grid gap-1.5"><Label>Remarks</Label><Textarea rows={3} value={f.remarks} onChange={e => setF(x => ({ ...x, remarks: e.target.value }))} /></div>
        </div>
        <SheetFooter className="flex-row justify-between gap-2">
          <Button variant="ghost" onClick={remove} disabled={busy}><TrashIcon data-icon="inline-start" />Delete</Button>
          <Button onClick={save} disabled={busy}>Save</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default function InstallationPhotos({ projects, team = [] }) {
  const [projectId, setProjectId] = useState('');
  const [stage, setStage] = useState('');
  const [photos, setPhotos] = useState(null);
  const [capture, setCapture] = useState(null); // { file, takenAt }
  const [viewing, setViewing] = useState(null);
  const camRef = useRef(null);
  const galRef = useRef(null);
  const names = Object.fromEntries(team.map(u => [u.username, u.display_name || u.username]));

  useEffect(() => { setProjectId(lastProject()); }, []);
  const load = useCallback(async () => {
    try { setPhotos(await api(`/api/installation-photos${projectId ? `?project_id=${projectId}` : ''}`)); } catch (err) { showToast(err.message, 'error'); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function picked(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { setCapture({ file: await compress(file), takenAt: new Date().toISOString() }); }
    catch { showToast('Could not read that photo', 'error'); }
  }
  const shown = (photos || []).filter(p => !stage || p.stage === stage);

  return (
    <div className="flex flex-col gap-4">
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={picked} />
      <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={picked} />
      {/* Picker sits outside the Card (overflow-hidden would clip its list). */}
      <div className="max-w-2xl"><SearchableSelect value={projectId} onChange={setProjectId} placeholder="All projects — or search one…" options={projectOptions(projects)} /></div>
      <Card>
        <CardHeader>
          <CardTitle>Progress photos</CardTitle>
          <CardAction>
            <div className="hidden gap-2 md:flex">
              <Button size="sm" variant="outline" onClick={() => galRef.current.click()}><ImagePlusIcon data-icon="inline-start" />Upload</Button>
              <Button size="sm" onClick={() => camRef.current.click()}><CameraIcon data-icon="inline-start" />Take photo</Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {PHOTO_STAGES.map(s => <Button key={s} size="sm" className="h-7" variant={stage === s ? 'default' : 'outline'} onClick={() => setStage(stage === s ? '' : s)}>{s}</Button>)}
          </div>
          {photos === null ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
            : shown.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No photos yet. Tap the camera to add one.</p> : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map(p => (
                <button key={p.id} type="button" onClick={() => setViewing(p)} className="group overflow-hidden rounded-xl border text-left">
                  <div className="relative aspect-square bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/installation-photos/${p.id}/image`} alt="" loading="lazy" className="size-full object-cover" />
                    {p.stage && <Badge className="absolute left-1.5 top-1.5" variant="secondary">{p.stage}</Badge>}
                  </div>
                  <div className="p-2 text-xs">
                    <div className="truncate font-medium">{p.project_no}{p.visit_seq ? ` · Visit ${p.visit_seq}` : ''}</div>
                    <div className="truncate text-muted-foreground">{p.remarks || '—'}</div>
                    <div className="text-muted-foreground">{new Date(p.taken_at || p.created_at).toLocaleDateString('en-IN')} · {names[p.taken_by] || p.taken_by}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {/* Phone: floating camera button, above the bottom tab bar. */}
      <div className="fixed bottom-20 right-4 z-30 flex items-center gap-3 md:hidden">
        <Button size="icon" variant="secondary" className="size-12 rounded-full border shadow-lg" onClick={() => galRef.current.click()} aria-label="Choose from gallery"><ImagePlusIcon className="size-5" /></Button>
        <Button size="icon" className="size-14 rounded-full shadow-lg" onClick={() => camRef.current.click()} aria-label="Take photo"><CameraIcon className="size-6" /></Button>
      </div>
      {capture && <CaptureSheet file={capture.file} takenAt={capture.takenAt} projects={projects} defaultProject={projectId || lastProject()}
        onClose={() => setCapture(null)} onSaved={(pid) => { setCapture(null); if (projectId && projectId !== pid) setProjectId(pid); else load(); }} />}
      {viewing && <ViewSheet photo={viewing} onClose={() => setViewing(null)} onChanged={() => { setViewing(null); load(); }} />}
    </div>
  );
}
