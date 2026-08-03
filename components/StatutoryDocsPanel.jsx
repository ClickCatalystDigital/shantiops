'use client';

// Statutory Documents (QC-CHANGES.md) — sits below the existing QcPanel on the project's QC tab.
// qc_records is a pass/fail test log; this is the per-boiler statutory paperwork, a different job
// (see QC-CHANGES.md §4), so it's a second card rather than folded into the first.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { PlusIcon, ChevronRightIcon, Trash2Icon } from 'lucide-react';

const EMPTY = {
  doc_id: '', makers_no: '', year_of_make: '', boiler_type: '', length_overall: '',
  internal_diameter: '', design_pressure: '', hydro_test_pressure: '', heating_surface: '',
  evaporation_capacity: '', steam_temp: '', drawing_no: '',
};

// V1 covers the SF series only (QC-CHANGES.md §4/§7) — no series picker, since building one for
// series we haven't seen a sample of yet would be inventing requirements.
function NewDocumentSheet({ open, onOpenChange, projectId, router }) {
  const [form, setForm] = useState(EMPTY);
  const [docIdTouched, setDocIdTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  function set(field) {
    return e => {
      const v = e.target.value;
      setForm(f => {
        const next = { ...f, [field]: v };
        // Suggest a doc ID from the maker's number until the user edits it themselves — a starting
        // point, not an enforced format (QC V1 plan §8 assumption 1: we don't know the full encoding).
        if (field === 'makers_no' && !docIdTouched) {
          const digits = v.replace(/\D/g, '');
          next.doc_id = digits ? `SBH-${digits}-SF-` : '';
        }
        return next;
      });
    };
  }

  async function submit() {
    if (!form.doc_id.trim()) return showToast('Document ID is required', 'error');
    if (!form.makers_no.trim()) return showToast("Maker's No. is required", 'error');
    setBusy(true);
    try {
      const res = await api('/api/qc-documents', { method: 'POST', body: { project_id: projectId, ...form } });
      showToast('Document created — 54 Form IV A parts seeded from the SF template');
      onOpenChange(false);
      setForm(EMPTY);
      setDocIdTouched(false);
      router.push(`/projects/${projectId}/qc/${res.id}`);
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New statutory document — SF series</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-3 overflow-y-auto px-4">
          <div className="flex flex-col gap-1.5">
            <Label>Maker's No.</Label>
            <Input value={form.makers_no} onChange={set('makers_no')} placeholder="SB-1037" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Document ID</Label>
            <Input value={form.doc_id} onChange={e => { setDocIdTouched(true); set('doc_id')(e); }} placeholder="SBH-1037-SF-WB-300-17" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Year of Make</Label>
              <Input value={form.year_of_make} onChange={set('year_of_make')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Drawing No.</Label>
              <Input value={form.drawing_no} onChange={set('drawing_no')} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Boiler Type</Label>
            <Input value={form.boiler_type} onChange={set('boiler_type')} placeholder="HORIZONTAL MULTITUBULAR SHELL TYPE SMOKE TUBE WET BACK BOILER" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Length Overall</Label>
              <Input value={form.length_overall} onChange={set('length_overall')} placeholder="3673 mm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Internal Dia</Label>
              <Input value={form.internal_diameter} onChange={set('internal_diameter')} placeholder="2450 mm (ID)" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Design Pressure</Label>
              <Input value={form.design_pressure} onChange={set('design_pressure')} placeholder="17.00 Kg/cm² (g)" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Hydro Test Pressure</Label>
              <Input value={form.hydro_test_pressure} onChange={set('hydro_test_pressure')} placeholder="25.50 Kg/cm² (g)" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Heating Surface</Label>
              <Input value={form.heating_surface} onChange={set('heating_surface')} placeholder="105.24 Sq.mtrs." />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Evaporation Cap.</Label>
              <Input value={form.evaporation_capacity} onChange={set('evaporation_capacity')} placeholder="3000 Kg./hr." />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Steam Outlet Temp.</Label>
            <Input value={form.steam_temp} onChange={set('steam_temp')} placeholder="195° C" />
          </div>
        </div>
        <SheetFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create document'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default function StatutoryDocsPanel({ projectId, documents = [], canEdit = false }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function remove(d) {
    if (!window.confirm(`Delete "${d.doc_id}"? This removes the document and all its certificate links — can't be undone.`)) return;
    try {
      await api(`/api/qc-documents/${d.id}`, { method: 'DELETE' });
      showToast('Document deleted');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Statutory Documents</CardTitle>
        {canEdit && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <PlusIcon data-icon="inline-start" />New document
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {documents.length === 0 && (
          <p className="text-sm text-muted-foreground">No statutory documents filed yet.</p>
        )}
        {documents.map(d => (
          <div key={d.id} className="flex w-full items-center gap-1 py-2.5 text-sm hover:bg-muted/50">
            <button onClick={() => router.push(`/projects/${projectId}/qc/${d.id}`)}
              className="flex flex-1 items-center gap-2 text-left">
              <div className="flex flex-col">
                <span className="font-medium">{d.doc_id}</span>
                <span className="text-xs text-muted-foreground">
                  {d.series} series · Form IV A · {d.linked_parts} of {d.total_parts} parts linked
                </span>
              </div>
              <ChevronRightIcon className="ml-auto size-4 text-muted-foreground" />
            </button>
            {canEdit && (
              <Button size="icon-sm" variant="ghost" aria-label="Delete document" onClick={() => remove(d)}>
                <Trash2Icon className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
      {canEdit && <NewDocumentSheet open={open} onOpenChange={setOpen} projectId={projectId} router={router} />}
    </Card>
  );
}
