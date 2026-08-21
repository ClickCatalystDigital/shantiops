// components/QcDocumentEditor.jsx

'use client';

// Document editor (/projects/[id]/qc/[docId]) — Form IV A only in V1. The right column of every
// part row is display-only, populated from whatever certificate is linked and nothing else: the
// literal implementation of "it should fetch from the TC data only" (QC-CHANGES.md §1). Preview PDF
// stays disabled while any part is unlinked — the server route re-asserts this, this is just the UX
// echo of that gate.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ChevronLeftIcon, AlertTriangleIcon, SearchIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import CertPicker from './CertPicker';
import PdfPreview from './PdfPreview';

const HEADER_FIELDS = [
  ['company', 'Company'], ['makers_no', "Maker's No."], ['year_of_make', 'Year of Make'],
  ['design_pressure', 'Design Pressure'], ['hydro_test_pressure', 'Hydro Test Pressure'],
  ['boiler_type', 'Boiler Type'], ['length_overall', 'Length Overall'],
  ['internal_diameter', 'Internal Dia'], ['heating_surface', 'Heating Surface'],
  ['evaporation_capacity', 'Evaporation Cap.'], ['steam_temp', 'Steam Outlet Temp.'],
  ['drawing_no', 'Drawing No.'], ['doc_id', 'Document ID'],
  // Full-folder fields (QC-FOLDER-DESIGN.md) — label, covering letter, Form II(1).
  ['working_pressure', 'Working Pressure'], ['drawing_no_from', 'Drawing No. From'],
  ['drawing_no_to', 'Drawing No. To'], ['label_model_code', 'Label Model Code'],
  ['submission_date', 'Submission Date'], ['signer_name', 'Signed By (QC)'],
  ['recipient_name', 'Recipient (blank = Director)'], ['recipient_address', 'Recipient Address'],
];

// V2-CHANGES.md Group 2 — same two companies as StatutoryDocsPanel.jsx's NewDocumentSheet; this
// sheet only needs the plain names (doc-ID prefix derivation is a creation-time concern, not an
// edit-time one — changing a document's company later doesn't retroactively rewrite its doc_id).
const COMPANIES = ['Shanti Boilers', 'Shanti Techno Fab'];

function sizeText(p) {
  return [p.size_t, p.size_w, p.size_l].filter(Boolean).join(' × ') || '—';
}

function BoilerDetailsSheet({ open, onOpenChange, document, router }) {
  const [form, setForm] = useState(() => Object.fromEntries(HEADER_FIELDS.map(([k]) => [k, document[k] || ''])));
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!form.doc_id.trim()) return showToast('Document ID cannot be empty', 'error');
    setBusy(true);
    try {
      await api(`/api/qc-documents/${document.id}`, { method: 'PATCH', body: form });
      showToast('Boiler details updated');
      onOpenChange(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader><SheetTitle>Edit boiler details</SheetTitle></SheetHeader>
        <div className="grid grid-cols-2 gap-3 overflow-y-auto px-4">
          {HEADER_FIELDS.map(([k, label]) => (
            <div key={k} className="flex flex-col gap-1.5">
              <Label>{label}</Label>
              {k === 'company' ? (
                <Select value={form.company} onValueChange={v => setForm(f => ({ ...f, company: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COMPANIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
              )}
            </div>
          ))}
        </div>
        <SheetFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save changes'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function PartRow({ part, selected, onToggle, onOpenPicker, onRemove, canEdit }) {
  const linked = !!part.test_certificate_id;
  return (
    <div className="flex items-start gap-3 py-2.5 text-sm">
      <Checkbox className="mt-0.5" checked={selected} onCheckedChange={() => onToggle(part.id)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{part.part_no}. {part.part_name}</span>
        <span className="text-xs text-muted-foreground">{sizeText(part)} · qty {part.qty}</span>
      </div>
      <button onClick={() => onOpenPicker([part.id])} className="flex min-w-0 flex-1 flex-col items-end text-right hover:opacity-80">
        {linked ? (
          <>
            <span className="font-medium">{part.certificate_no} · {part.tc_cast_no}{part.tc_plate_no ? ` · ${part.tc_plate_no}` : ''}</span>
            <span className="text-xs text-muted-foreground">{part.material_spec} · {part.steel_maker}</span>
            <span className="text-xs text-muted-foreground">
              C {part.chem_c} Mn {part.chem_mn} … Y.S {part.ys} UTS {part.uts}
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1 text-warning">
            <AlertTriangleIcon className="size-3.5" />No certificate — Link…
          </span>
        )}
      </button>
      {canEdit && (
        <button
          aria-label="Remove part"
          onClick={() => onRemove(part)}
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// V2-CHANGES.md Group 2 — manage per-document exceptions (client point 1): the SF template's 54
// parts are the default, but a specific boiler may need one added or removed. Deliberately a small
// Dialog, not a full Sheet — this is a handful of short fields, not the boiler-details form.
function AddPartDialog({ open, onOpenChange, documentId, router }) {
  const EMPTY = { part_no: '', part_name: '', size_t: '', size_w: '', size_l: '', qty: '' };
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  async function submit() {
    if (!form.part_name.trim()) return showToast('Part name is required', 'error');
    setBusy(true);
    try {
      await api(`/api/qc-documents/${documentId}/parts`, { method: 'POST', body: form });
      showToast('Part added — link it to a certificate before the PDF can be previewed');
      setForm(EMPTY);
      onOpenChange(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) setForm(EMPTY); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add part</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Part No.</Label>
              <Input value={form.part_no} onChange={set('part_no')} placeholder="55" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Qty</Label>
              <Input value={form.qty} onChange={set('qty')} placeholder="1" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Part Name</Label>
            <Input value={form.part_name} onChange={set('part_name')} placeholder="e.g. INSPECTION DOOR" autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Size (mm)</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input value={form.size_t} onChange={set('size_t')} placeholder="T" />
              <Input value={form.size_w} onChange={set('size_w')} placeholder="W" />
              <Input value={form.size_l} onChange={set('size_l')} placeholder="L" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy} onClick={submit}>{busy ? 'Adding…' : 'Add part'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Mountings & fittings list editor (QC-FOLDER-DESIGN.md §4.2) — a small editable table, saved whole
// via the bulk-replace endpoint. serial_numbers is free text (one description can have several).
const MOUNT_COLS = [['description', 'Description'], ['size', 'Size'], ['moc', 'MOC'],
  ['serial_numbers', 'Serial No(s)'], ['make', 'Make'], ['qty', 'Qty']];
const EMPTY_MOUNT = { description: '', size: '', moc: '', serial_numbers: '', make: '', qty: '' };

function MountingsCard({ documentId, mountings, canEdit, router }) {
  const [rows, setRows] = useState(() => mountings.map(m => ({ ...m })));
  const [busy, setBusy] = useState(false);
  const setCell = (i, k) => e => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));

  async function save() {
    setBusy(true);
    try {
      await api(`/api/qc-documents/${documentId}/mountings`, { method: 'POST', body: { rows } });
      showToast('Mountings saved');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mountings &amp; Fittings</CardTitle>
        {canEdit && (
          <CardAction>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => setRows(rs => [...rs, { ...EMPTY_MOUNT }])}>
                <PlusIcon data-icon="inline-start" />Add row
              </Button>
              <Button size="sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
            </div>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 && <p className="py-4 text-sm text-muted-foreground">No mountings listed yet.</p>}
        {rows.length > 0 && (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                {MOUNT_COLS.map(([, l]) => <th key={l} className="px-1 pb-2 font-medium">{l}</th>)}
                {canEdit && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  {MOUNT_COLS.map(([k]) => (
                    <td key={k} className="px-1 py-1">
                      <Input value={r[k] || ''} onChange={setCell(i, k)} disabled={!canEdit} className="h-8" />
                    </td>
                  ))}
                  {canEdit && (
                    <td className="px-1 py-1">
                      <Button size="icon-sm" variant="ghost" aria-label="Remove row"
                        onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

export default function QcDocumentEditor({ project, document, parts, certificates, mountings = [], canEdit }) {
  const router = useRouter();
  // parts comes straight from the server prop, no local copy — router.refresh() after linking
  // re-fetches it server-side and flows the new value straight back in, same as QcPanel does for
  // qc_records. A local useState(initialParts) would freeze at mount and never see the update.
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTargets, setPickerTargets] = useState([]);
  const [boilerOpen, setBoilerOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [addPartOpen, setAddPartOpen] = useState(false);

  const unlinked = parts.filter(p => !p.test_certificate_id);
  const byFilter = filter === 'unlinked' ? unlinked : parts;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? byFilter.filter(p => [p.part_no, p.part_name, p.certificate_no, p.tc_cast_no, p.tc_plate_no, p.material_spec, p.steel_maker]
        .some(v => v && String(v).toLowerCase().includes(needle)))
    : byFilter;
  const usedIds = useMemo(() => new Set(parts.filter(p => p.test_certificate_id).map(p => p.test_certificate_id)), [parts]);
  const allShownSelected = shown.length > 0 && shown.every(p => selected.has(p.id));

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // Selects/deselects every part currently visible under the active search + All/Unlinked filter —
  // not literally all 54 rows — so a narrowed search ("GUSSET") plus one click bulk-links just that
  // result set.
  function toggleSelectShown() {
    const ids = shown.map(p => p.id);
    setSelected(s => {
      const n = new Set(s);
      ids.forEach(id => (allShownSelected ? n.delete(id) : n.add(id)));
      return n;
    });
  }

  function openPicker(partIds) {
    setPickerTargets(partIds);
    setPickerOpen(true);
  }

  async function link(certId) {
    try {
      await api(`/api/qc-documents/${document.id}/link-parts`, {
        method: 'POST', body: { part_ids: pickerTargets, test_certificate_id: certId },
      });
      showToast(`Linked ${pickerTargets.length} part${pickerTargets.length === 1 ? '' : 's'}`);
      setSelected(new Set());
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function removePart(part) {
    if (!window.confirm(`Remove "${part.part_name}" from this document?`)) return;
    try {
      await api(`/api/qc-documents/${document.id}/parts/${part.id}`, { method: 'DELETE' });
      showToast('Part removed');
      setSelected(s => { const n = new Set(s); n.delete(part.id); return n; });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <main className="container flex flex-col gap-6 py-8">
      <div className="flex items-center gap-3">
        <Link href={`/projects/${project.id}?dept=QC`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeftIcon className="size-4" />QC
        </Link>
        <h1 className="text-xl font-bold tracking-tight">{document.doc_id}</h1>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Draft</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{document.company}</span>
        <div className="ml-auto flex items-center gap-2">
          {unlinked.length > 0 && (
            <span className="text-xs text-warning">{unlinked.length} part{unlinked.length === 1 ? '' : 's'} still need a certificate</span>
          )}
          <Button disabled={unlinked.length > 0} onClick={() => setPdfOpen(true)}>Preview PDF</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Boiler details</CardTitle>
          {canEdit && (
            <CardAction><Button size="sm" variant="ghost" onClick={() => setBoilerOpen(true)}>Edit</Button></CardAction>
          )}
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Maker's No. {document.makers_no || '—'} · Year {document.year_of_make || '—'} ·
            {' '}Design {document.design_pressure || '—'} · Hydro {document.hydro_test_pressure || '—'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Form IV A — Material Test Certificates</CardTitle>
          <CardAction>
            <div className="flex items-center gap-1">
              <Button size="xs" variant={filter === 'all' ? 'secondary' : 'ghost'} onClick={() => setFilter('all')}>All ({parts.length})</Button>
              <Button size="xs" variant={filter === 'unlinked' ? 'secondary' : 'ghost'} onClick={() => setFilter('unlinked')}>
                Unlinked ({unlinked.length})
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search part name, number, or certificate" className="pl-8" />
            </div>
            <Button size="sm" variant="outline" disabled={shown.length === 0} onClick={toggleSelectShown}>
              {allShownSelected ? 'Deselect all' : 'Select all'}
            </Button>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setAddPartOpen(true)}>
                <PlusIcon data-icon="inline-start" />Add part
              </Button>
            )}
          </div>
          <div className="flex flex-col divide-y">
            {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No matches.</p>}
            {shown.map(p => (
              <PartRow key={p.id} part={p} selected={selected.has(p.id)} onToggle={toggle} onOpenPicker={openPicker}
                onRemove={removePart} canEdit={canEdit} />
            ))}
          </div>
        </CardContent>
      </Card>

      <MountingsCard documentId={document.id} mountings={mountings} canEdit={canEdit} router={router} />

      {selected.size > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between rounded-xl bg-popover p-3 text-sm shadow-lg ring-1 ring-foreground/10">
          <span>{selected.size} selected</span>
          <Button size="sm" onClick={() => openPicker([...selected])}>Link to certificate…</Button>
        </div>
      )}

      <CertPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={`Link certificate — ${pickerTargets.length} part${pickerTargets.length === 1 ? '' : 's'}`}
        certificates={certificates}
        project={project}
        usedIds={usedIds}
        onPick={link}
      />
      <BoilerDetailsSheet open={boilerOpen} onOpenChange={setBoilerOpen} document={document} router={router} />
      <AddPartDialog open={addPartOpen} onOpenChange={setAddPartOpen} documentId={document.id} router={router} />
      <PdfPreview
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        url={`/api/qc-documents/${document.id}/pdf`}
        title={`${document.doc_id} — Statutory Folder`}
        filename={`${document.doc_id.replace(/\//g, '-')}.pdf`}
      />
    </main>
  );
}
