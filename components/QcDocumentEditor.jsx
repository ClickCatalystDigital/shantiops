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
import TraceabilityBadges from '@/components/TraceabilityBadges';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ChevronLeftIcon, AlertTriangleIcon, SearchIcon, PlusIcon, Trash2Icon, XIcon, RefreshCwIcon } from 'lucide-react';
import CertPicker from './CertPicker';
import PdfPreview from './PdfPreview';
import QcHeaderField from './QcHeaderField';
import { suggestCertificates, suggestBomItem } from '@/lib/tc-match';
import { normalizeMaterial } from '@/lib/match-utils';
import { QC_HEADER_FIELDS } from '@/lib/qc-document-fields';
import { modelConfig } from '@/lib/qc-models';

// V2-CHANGES.md Group 2 — same two companies as StatutoryDocsPanel.jsx's NewDocumentSheet; this
// sheet only needs the plain names (doc-ID prefix derivation is a creation-time concern, not an
// edit-time one — changing a document's company later doesn't retroactively rewrite its doc_id).
const COMPANIES = ['Shanti Boilers', 'Shanti Techno Fab'];

function sizeText(p) {
  return [p.size_t, p.size_w, p.size_l].filter(Boolean).join(' × ') || '—';
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

function BoilerDetailsSheet({ open, onOpenChange, document, currentUserName, router }) {
  const [form, setForm] = useState(() => {
    const init = Object.fromEntries(QC_HEADER_FIELDS.map(f => [f.key, document[f.key] || '']));
    // "signer = QC user", "date defaults to today" (QC-FOLDER-DESIGN.md §4.3) — pre-filled on first
    // open for a document that has neither set yet, stays a normal editable field afterward.
    if (!init.submission_date) init.submission_date = todayIso();
    if (!init.signer_name && currentUserName) init.signer_name = currentUserName;
    return init;
  });
  const [busy, setBusy] = useState(false);

  async function submit() {
    const missing = QC_HEADER_FIELDS.find(f => f.required && !String(form[f.key] || '').trim());
    if (missing) return showToast(`${missing.label} is required`, 'error');
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
      <SheetContent className="w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader><SheetTitle>Edit boiler details</SheetTitle></SheetHeader>
        <div className="grid grid-cols-2 gap-3 overflow-y-auto px-4">
          {QC_HEADER_FIELDS.map(f => (
            f.kind === 'select' ? (
              <div key={f.key} className="flex flex-col gap-1.5">
                <Label>{f.label}<span className="text-danger"> *</span></Label>
                <Select value={form.company} onValueChange={v => setForm(fm => ({ ...fm, company: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COMPANIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <QcHeaderField key={f.key} field={f} value={form[f.key]}
                onChange={v => setForm(fm => ({ ...fm, [f.key]: v }))} />
            )
          ))}
        </div>
        <SheetFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save changes'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// "Link to BOM item" — minimal addition (plain native <select>, no new dialog component): what
// lib/tc-match.js needs to have a real material spec to suggest certificates against (plan Step 1).
// Unlinked stays unlinked by default — no guessing which BOM line a part means; the dropdown itself
// is untouched (every BOM line, plain list). The one addition is a fuzzy-matched hint underneath —
// suggestBomItem() (lib/tc-match.js), same idiom as the certificate suggestions below it — so linking
// isn't a blind scan through every project BOM line when there's an obvious match. Still one click to
// confirm, never auto-applied.
// Traceability badges + drawing revision (Q2, gap-closure round 2026-08-26) — QC never renders
// BomTable.jsx at all, so once a part is linked to a BOM line, this is the one place QC can see
// whether that line is MTC/heat-flagged and which drawing revision it was released against, without
// leaving this screen. Same canonical TraceabilityBadges component BomTable.jsx/ProcurementWorkspace
// use; drawing_name/drawing_revision come straight from getBomItemsForProject's own extended query.
function LinkedBomItemContext({ item }) {
  if (!item) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <TraceabilityBadges item={item} className="flex flex-wrap gap-1" />
      {item.drawing_name && (
        <span className="text-xs text-muted-foreground">
          Drg {item.drawing_name}{item.drawing_revision ? ` (${item.drawing_revision})` : ''}
        </span>
      )}
    </div>
  );
}

function BomItemLink({ part, bomItems, onLink, canEdit }) {
  const current = bomItems.find(b => b.id === part.bom_item_id);
  if (!canEdit) return current ? (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">BOM: {current.material_description}</span>
      <LinkedBomItemContext item={current} />
    </div>
  ) : null;
  const suggestion = suggestBomItem(part, bomItems);
  return (
    <div className="flex flex-col gap-0.5">
      <select
        className="w-full max-w-56 truncate rounded border bg-transparent px-1 py-0.5 text-xs text-muted-foreground"
        value={part.bom_item_id || ''}
        onChange={e => onLink(part.id, e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Link to BOM item…</option>
        {bomItems.map(b => <option key={b.id} value={b.id}>{b.material_description}</option>)}
      </select>
      {suggestion && (
        <button type="button" onClick={() => onLink(part.id, suggestion.id)}
          className="truncate text-left text-xs text-info hover:underline">
          Suggested: {suggestion.material_description}
        </button>
      )}
      <LinkedBomItemContext item={current} />
    </div>
  );
}

function PartRow({ part, selected, onToggle, onOpenPicker, onRemove, onUnlink, onLinkBomItem, bomItems, canEdit }) {
  const linked = !!part.test_certificate_id;
  // A real named part (Design's breakdown, components/PrWorkspace.jsx's NamedPartsEditor) is any
  // row whose name differs from its own BOM line's material_description — the plain single-row
  // fallback always shares that text (lib/qc-bom-sync.js's namedPartRows). Only those get the
  // physical-cut-piece reconciliation status; a bought/generic line was never taggable at Cut time
  // in the first place (Production's CutDialog only offers a Part picker when a breakdown exists).
  const isNamedPart = part.bom_item_id && part.part_name !== part.bom_material_description;
  return (
    <div className="flex items-start gap-3 py-2.5 text-sm">
      <Checkbox className="mt-0.5" checked={selected} onCheckedChange={() => onToggle(part.id)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{part.part_no}. {part.part_name}</span>
        <span className="text-xs text-muted-foreground">{sizeText(part)} · qty {part.qty}</span>
        {isNamedPart && (
          <span className="text-xs text-muted-foreground">
            {part.pieces_cut}/{part.qty} cut{part.linked_piece_code ? ` · matched to ${part.linked_piece_code}` : ''}
          </span>
        )}
        <BomItemLink part={part} bomItems={bomItems} onLink={onLinkBomItem} canEdit={canEdit} />
      </div>
      <div className="flex min-w-0 flex-1 items-start justify-end gap-1">
        <button onClick={() => onOpenPicker([part.id])} className="flex min-w-0 flex-col items-end text-right hover:opacity-80">
          {linked ? (
            <>
              <span className="font-medium">
                {part.certificate_no} · {part.tc_cast_no}
                {/* Heat No. (Q1, gap-closure round 2026-08-26) — existed on test_certificates,
                    unwired end-to-end until this fix; shown alongside cast_no, its usual sibling. */}
                {part.tc_heat_no ? ` · heat ${part.tc_heat_no}` : ''}
                {part.tc_plate_no ? ` · ${part.tc_plate_no}` : ''}
              </span>
              <span className="text-xs text-muted-foreground">{part.material_spec} · {part.steel_maker}</span>
              <span className="text-xs text-muted-foreground">
                C {part.chem_c} Mn {part.chem_mn} … Y.S {part.ys} UTS {part.uts}
              </span>
              {/* Receipt provenance (Q3) — which delivery/supplier the inspected piece came from,
                  previously only answerable via a raw SQL join outside the app. */}
              {(part.receipt_inward_batch_no || part.receipt_supplier_name) && (
                <span className="text-xs text-muted-foreground">
                  Received via {[part.receipt_inward_batch_no, part.receipt_supplier_name].filter(Boolean).join(' · ')}
                </span>
              )}
            </>
          ) : (
            <span className="flex items-center gap-1 text-warning">
              <AlertTriangleIcon className="size-3.5" />No certificate — Link…
            </span>
          )}
        </button>
        {canEdit && linked && (
          <button
            aria-label="Unlink certificate"
            onClick={e => { e.stopPropagation(); onUnlink(part.id); }}
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
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

// Form III A groups — a per-named-sub-assembly certificate (real sample SB-1097's "Feed pipeline"),
// distinct from Form IV A's full parts table (lib/qc-folder-pdf.js). New/delete here, header fields
// per group, and parts move in/out via the always-works manual path — "Sync from BOM" reuses the
// same global sync-bom endpoint Form IV A uses (lib/qc-bom-sync.js already routes a material line
// into whichever group matches its assembly_id/group_label).
const IIIA_HEADER_FIELDS = [
  ['design_pressure', 'Design Pressure (Kgf/cm²)'], ['design_temp', 'Design Temperature'],
  ['process_of_manufacture', 'Process of Manufacture'], ['mode_of_flange_attachment', 'Mode of Flange Attachment'],
  ['flange_particulars', 'Flange Particulars'], ['size_of_branch', 'Size of Branch & Attachment'],
  ['heat_treatment', 'Heat Treatment'], ['identification_marks', 'Identification Marks'],
  ['drawing_no', 'Drawing No.'], ['hydro_test_pressure', 'Hydro Test Pressure (Kgf/cm²)'], ['hydro_test_date', 'Hydro Test Date'],
];

function NewIiiaGroupDialog({ open, onOpenChange, documentId, assemblies, groupLabels, router }) {
  const EMPTY = { name: '', assembly_id: '', group_label: '' };
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target?.value ?? e }));

  async function submit() {
    if (!form.name.trim()) return showToast('Group name is required', 'error');
    setBusy(true);
    try {
      await api(`/api/qc-documents/${documentId}/iiia-groups`, {
        method: 'POST', body: { name: form.name.trim(), assembly_id: form.assembly_id || null, group_label: form.group_label || null },
      });
      showToast('Form III A group added');
      setForm(EMPTY);
      onOpenChange(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) setForm(EMPTY); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Form III A group</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={set('name')} placeholder="e.g. Feed pipeline" autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>BOM assembly (optional — auto-pulls its material lines)</Label>
            <Select value={form.assembly_id} onValueChange={set('assembly_id')}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                {assemblies.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Or BOM group label (optional)</Label>
            <Select value={form.group_label} onValueChange={set('group_label')}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                {groupLabels.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy} onClick={submit}>{busy ? 'Adding…' : 'Add group'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IiiaGroupCard({ group: g, parts, ungroupedParts, canEdit, documentId, router }) {
  const [form, setForm] = useState(() => Object.fromEntries(IIIA_HEADER_FIELDS.map(([k]) => [k, g[k] || ''])));
  const [busy, setBusy] = useState(false);
  const [addPartId, setAddPartId] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    try {
      await api(`/api/qc-documents/${documentId}/iiia-groups/${g.id}`, { method: 'PATCH', body: form });
      showToast('Group saved');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function removeGroup() {
    if (!window.confirm(`Delete "${g.name}"? Its parts move back to Form IV A.`)) return;
    try {
      await api(`/api/qc-documents/${documentId}/iiia-groups/${g.id}`, { method: 'DELETE' });
      showToast('Group deleted');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function addPart() {
    if (!addPartId) return;
    try {
      await api(`/api/qc-documents/${documentId}/iiia-groups/${g.id}/parts`, { method: 'POST', body: { part_id: Number(addPartId) } });
      setAddPartId('');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function removePart(partId) {
    try {
      await api(`/api/qc-documents/${documentId}/iiia-groups/${g.id}/parts`, { method: 'DELETE', body: { part_id: partId } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{g.name}</span>
        {canEdit && <Button size="icon-sm" variant="ghost" aria-label="Delete group" onClick={removeGroup}><Trash2Icon className="size-3.5" /></Button>}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {IIIA_HEADER_FIELDS.map(([k, l]) => (
          <div key={k} className="flex flex-col gap-1">
            <Label className="text-xs font-normal text-muted-foreground">{l}</Label>
            <Input value={form[k]} onChange={set(k)} disabled={!canEdit} className="h-8" />
          </div>
        ))}
      </div>
      {canEdit && <Button size="sm" disabled={busy} onClick={save} className="w-fit">{busy ? 'Saving…' : 'Save header'}</Button>}
      <div className="flex flex-col divide-y text-sm">
        {parts.length === 0 && <p className="py-2 text-xs text-muted-foreground">No parts in this group yet.</p>}
        {parts.map(p => (
          <div key={p.id} className="flex items-center justify-between py-1.5">
            <span>{p.part_name} {p.qty ? <span className="text-muted-foreground">× {p.qty}</span> : null}</span>
            {canEdit && <Button size="icon-sm" variant="ghost" aria-label="Move back to Form IV A" onClick={() => removePart(p.id)}><XIcon className="size-3.5" /></Button>}
          </div>
        ))}
      </div>
      {canEdit && ungroupedParts.length > 0 && (
        <div className="flex items-center gap-1">
          <Select value={addPartId} onValueChange={setAddPartId}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Move a Form IV A part into this group" /></SelectTrigger>
            <SelectContent>
              {ungroupedParts.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.part_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={!addPartId} onClick={addPart}>Add</Button>
        </div>
      )}
    </div>
  );
}

function IiiaGroupsCard({ documentId, groups, parts, assemblies, bomItems, canEdit, router }) {
  const [newOpen, setNewOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const groupLabels = useMemo(() => [...new Set(bomItems.map(b => b.group_label).filter(Boolean))], [bomItems]);
  const ungrouped = parts.filter(p => !p.iiia_group_id);

  async function syncBom() {
    setSyncBusy(true);
    try {
      const res = await api(`/api/qc-documents/${documentId}/sync-bom`, { method: 'POST' });
      showToast(res.added > 0 ? `Added ${res.added} part${res.added === 1 ? '' : 's'} from BOM` : 'Already up to date');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setSyncBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Form III A — Certificate of Manufacture and Test</CardTitle>
        {canEdit && (
          <CardAction>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" disabled={syncBusy} onClick={syncBom}>
                <RefreshCwIcon data-icon="inline-start" />{syncBusy ? 'Syncing…' : 'Sync from BOM'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
                <PlusIcon data-icon="inline-start" />New group
              </Button>
            </div>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {groups.length === 0 && <p className="py-2 text-sm text-muted-foreground">No Form III A groups yet — this boiler files only Form IV A until one is added.</p>}
        {groups.map(g => (
          <IiiaGroupCard key={g.id} group={g} parts={parts.filter(p => p.iiia_group_id === g.id)}
            ungroupedParts={ungrouped} canEdit={canEdit} documentId={documentId} router={router} />
        ))}
      </CardContent>
      <NewIiiaGroupDialog open={newOpen} onOpenChange={setNewOpen} documentId={documentId} assemblies={assemblies} groupLabels={groupLabels} router={router} />
    </Card>
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
  const [syncBusy, setSyncBusy] = useState(false);
  const setCell = (i, k) => e => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));

  async function save() {
    setBusy(true);
    try {
      await api(`/api/qc-documents/${documentId}/mountings`, { method: 'POST', body: { rows } });
      showToast('Bought-out items saved');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function syncBom() {
    setSyncBusy(true);
    try {
      const res = await api(`/api/qc-documents/${documentId}/sync-mountings`, { method: 'POST' });
      showToast(res.added > 0 ? `Added ${res.added} item${res.added === 1 ? '' : 's'} from BOM` : 'Already up to date');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setSyncBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bought-out Items (Mountings &amp; Fittings)</CardTitle>
        {canEdit && (
          <CardAction>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" disabled={syncBusy} onClick={syncBom}>
                <RefreshCwIcon data-icon="inline-start" />{syncBusy ? 'Syncing…' : 'Sync from BOM'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRows(rs => [...rs, { ...EMPTY_MOUNT }])}>
                <PlusIcon data-icon="inline-start" />Add row
              </Button>
              <Button size="sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
            </div>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 && <p className="py-4 text-sm text-muted-foreground">No bought-out items listed yet.</p>}
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

export default function QcDocumentEditor({ project, document, parts, certificates, mountings = [], groups = [], bomItems = [], approvals = [], assemblies = [], canEdit, currentUserName }) {
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
  const [visBusy, setVisBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);

  // "Unlinked"/"complete" cover every part on the document, Form III A's included — a grouped part
  // still needs a certificate just as much as a Form IV A one; only the CARD's own list (below) is
  // scoped to ungrouped parts, since grouped ones show on their own Form III A card instead.
  const unlinked = parts.filter(p => !p.test_certificate_id);
  // Zero parts is vacuously zero unlinked — not actually complete. Same reasoning as the server
  // gates (PDF route, PATCH customer_visible).
  const incomplete = parts.length === 0 || unlinked.length > 0;
  const ivaParts = parts.filter(p => !p.iiia_group_id);
  const ivaUnlinked = unlinked.filter(p => !p.iiia_group_id);
  const showIiia = modelConfig(project.series).forms.includes('IIIA');
  async function setCustomerVisible(v) {
    setVisBusy(true);
    try {
      await api(`/api/qc-documents/${document.id}`, { method: 'PATCH', body: { customer_visible: v } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setVisBusy(false); }
  }
  const byFilter = filter === 'unlinked' ? ivaUnlinked : ivaParts;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? byFilter.filter(p => [p.part_no, p.part_name, p.certificate_no, p.tc_cast_no, p.tc_heat_no, p.tc_plate_no, p.material_spec, p.steel_maker]
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

  // Only meaningful for a single-part picker open — a bulk selection can span parts with different
  // bom_item_id links, so there's no one BOM item to suggest against (see PartRow's per-part
  // "Link to BOM item" instead). lib/tc-match.js already returns [] for a missing/unmatched bomItem.
  const pickerPart = pickerTargets.length === 1 ? parts.find(p => p.id === pickerTargets[0]) : null;
  const pickerBomItem = pickerPart ? bomItems.find(b => b.id === pickerPart.bom_item_id) : null;
  const suggestions = pickerPart ? suggestCertificates(pickerPart, pickerBomItem, certificates, approvals) : [];

  async function link(certId) {
    try {
      // Two suggested certs can share the same normalized (material_spec, steel_maker) — e.g. two
      // casts from the same mill/spec, a common real case since exact-tier doesn't key on cast — so
      // dedupe before sending, or one link click would double-count that key's approval/rejection.
      const seenKeys = new Set();
      const shownCandidates = suggestions
        .filter(s => pickerBomItem?.inventory_item_id)
        .filter(s => {
          const key = `${normalizeMaterial(s.certificate.material_spec)}|${normalizeMaterial(s.certificate.steel_maker)}`;
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        })
        .map(s => ({
          material_spec: s.certificate.material_spec, steel_maker: s.certificate.steel_maker,
          inventory_item_id: pickerBomItem.inventory_item_id,
        }));
      await api(`/api/qc-documents/${document.id}/link-parts`, {
        method: 'POST', body: { part_ids: pickerTargets, test_certificate_id: certId, shown_candidates: shownCandidates },
      });
      showToast(`Linked ${pickerTargets.length} part${pickerTargets.length === 1 ? '' : 's'}`);
      setSelected(new Set());
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function linkBomItem(partId, bomItemId) {
    try {
      await api(`/api/qc-documents/${document.id}/parts/${partId}/link-bom-item`, {
        method: 'POST', body: { bom_item_id: bomItemId },
      });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function unlinkPart(partId) {
    try {
      await api(`/api/qc-documents/${document.id}/link-parts`, { method: 'DELETE', body: { part_ids: [partId] } });
      showToast('Certificate unlinked');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function syncBom() {
    setSyncBusy(true);
    try {
      const res = await api(`/api/qc-documents/${document.id}/sync-bom`, { method: 'POST' });
      showToast(res.added > 0 ? `Added ${res.added} part${res.added === 1 ? '' : 's'} from BOM` : 'Already up to date');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setSyncBusy(false);
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
        <Link href={`/qc?tab=docs&project=${project.id}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeftIcon className="size-4" />QC
        </Link>
        <h1 className="text-xl font-bold tracking-tight">{document.doc_id}</h1>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Draft</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{document.company}</span>
        <div className="ml-auto flex items-center gap-2">
          {parts.length === 0 ? (
            <span className="text-xs text-warning">No parts on this document yet</span>
          ) : unlinked.length > 0 && (
            <span className="text-xs text-warning">{unlinked.length} part{unlinked.length === 1 ? '' : 's'} still need a certificate</span>
          )}
          <Button disabled={incomplete} onClick={() => setPdfOpen(true)}>Preview PDF</Button>
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center gap-2">
          <Checkbox id="qc-doc-customer-visible" checked={!!document.customer_visible} disabled={visBusy || incomplete}
            onCheckedChange={(v) => setCustomerVisible(!!v)} />
          <Label htmlFor="qc-doc-customer-visible" className="font-normal text-xs">
            Share with customer{incomplete ? ' (link every part first)' : document.customer_visible ? ' — visible in their portal' : ' (not shown in the portal)'}
          </Label>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Form II(1) &amp; III{' '}
            <span className="font-normal text-muted-foreground">
              (Maker's No. {document.makers_no || '—'} · Year {document.year_of_make || '—'} ·
              {' '}Design {document.design_pressure || '—'} · Hydro {document.hydro_test_pressure || '—'})
            </span>
          </CardTitle>
          {canEdit && (
            <CardAction><Button size="sm" variant="ghost" onClick={() => setBoilerOpen(true)}>Edit</Button></CardAction>
          )}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Form IV A — Material Test Certificates</CardTitle>
          <CardAction>
            <div className="flex items-center gap-1">
              <Button size="xs" variant={filter === 'all' ? 'secondary' : 'ghost'} onClick={() => setFilter('all')}>All ({ivaParts.length})</Button>
              <Button size="xs" variant={filter === 'unlinked' ? 'secondary' : 'ghost'} onClick={() => setFilter('unlinked')}>
                Unlinked ({ivaUnlinked.length})
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
              <Button size="sm" variant="outline" disabled={syncBusy} onClick={syncBom}>
                <RefreshCwIcon data-icon="inline-start" />{syncBusy ? 'Syncing…' : 'Sync from BOM'}
              </Button>
            )}
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
                onRemove={removePart} onUnlink={unlinkPart} onLinkBomItem={linkBomItem} bomItems={bomItems} canEdit={canEdit} />
            ))}
          </div>
        </CardContent>
      </Card>

      {showIiia && (
        <IiiaGroupsCard documentId={document.id} groups={groups} parts={parts} assemblies={assemblies}
          bomItems={bomItems} canEdit={canEdit} router={router} />
      )}

      <MountingsCard key={mountings.length} documentId={document.id} mountings={mountings} canEdit={canEdit} router={router} />

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
        suggestions={suggestions}
        onPick={link}
      />
      <BoilerDetailsSheet open={boilerOpen} onOpenChange={setBoilerOpen} document={document} currentUserName={currentUserName} router={router} />
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
