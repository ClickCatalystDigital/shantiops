// components/QcDocumentEditor.jsx

'use client';

// Document editor (/projects/[id]/qc/[docId]) — Form IV A only in V1. The right column of every
// part row is display-only, populated from whatever certificate is linked and nothing else: the
// literal implementation of "it should fetch from the TC data only" (QC-CHANGES.md §1). Preview PDF
// stays disabled while any part is unlinked — the server route re-asserts this, this is just the UX
// echo of that gate.
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
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
import { ChevronLeftIcon, ChevronDownIcon, AlertTriangleIcon, SearchIcon, PlusIcon, Trash2Icon, XIcon, RefreshCwIcon } from 'lucide-react';
import CertPicker from './CertPicker';
import SearchableSelect from './SearchableSelect';
import PdfPreview from './PdfPreview';
import QcHeaderField from './QcHeaderField';
import { suggestCertificates, suggestBomItem } from '@/lib/tc-match';
import { normalizeMaterial } from '@/lib/match-utils';
import { QC_HEADER_FIELDS } from '@/lib/qc-document-fields';
import { modelConfig } from '@/lib/qc-models';
import { STANDARD_MOC } from '@/lib/section-shapes';
import SearchableSelect from './SearchableSelect';

// V2-CHANGES.md Group 2 — same two companies as StatutoryDocsPanel.jsx's NewDocumentSheet; this
// sheet only needs the plain names (doc-ID prefix derivation is a creation-time concern, not an
// edit-time one — changing a document's company later doesn't retroactively rewrite its doc_id).
const COMPANIES = ['Shanti Boilers', 'Shanti Techno Fab'];

function sizeText(p) {
  return [p.size_t, p.size_w, p.size_l].filter(Boolean).join(' × ') || '—';
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

// Splits a free-text BOM quantity/size value ("2 Nos", "40 SQ MTR", "1300 mm(ID)") into its leading
// number and trailing unit — there's no dedicated uom column on bom_items, this is the only place a
// unit is ever recorded. Used to show the unit as a label next to a numeric input instead of making
// the user retype it.
function parseUnit(text) {
  const m = String(text || '').trim().match(/^-?[\d.]+\s*(.*)$/);
  return m ? m[1].trim() : '';
}

// The other half of parseUnit — the leading number, for a box that edits only that part.
function parseNumber(text) {
  const m = String(text || '').trim().match(/^-?[\d.]+/);
  return m ? m[0] : '';
}

// Shared collapse toggle — expanded state renders each card's own header/content exactly as before
// (this button is additive, nothing else changes), collapsed state swaps CardContent for a one-line
// summary the card itself computes, so the design stays a normal Card in both states.
function CollapseButton({ open, onToggle, label }) {
  return (
    <Button size="icon-sm" variant="ghost" aria-label={open ? `Collapse ${label}` : `Expand ${label}`} onClick={onToggle}>
      <ChevronDownIcon className={`size-4 transition-transform ${open ? '' : '-rotate-90'}`} />
    </Button>
  );
}

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
          {/* Derived, not typed (DG- reversal) — every approved drawing on this project. Design
              owns drawing approval, so there's no override point here; correct a wrong drawing_no
              on the calc_drawings row itself. */}
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>Drawing No's</Label>
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {document.approved_drawing_codes?.length ? document.approved_drawing_codes.join(', ') : 'No approved drawings on this project yet'}
            </p>
          </div>
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

// The title itself IS the BOM picker now — "216. IBR ELBOWS" used to be plain static text with a
// separate "BOM: IBR ELBOWS · change" line underneath doing the actual linking, which was both a
// second control to learn AND, once linked, a near-verbatim repeat of the name right above it. One
// searchable field does both jobs: picking an option renames the part (via link-bom-item's now-dual
// bom_item_id+part_name update) and links it in the same call — matching the Mountings row picker.
// Shared between Form IV A's PartRow and Form III A's IiiaGroupCard, the only two places a part's
// name is shown as an editable title.
function PartTitleField({ part, partNo, bomItems, onLink, canEdit }) {
  const current = bomItems.find(b => b.id === part.bom_item_id);
  if (!canEdit) {
    return <span className="font-medium">{partNo}. {part.part_name}</span>;
  }
  const suggestion = !current && suggestBomItem(part, bomItems);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <span className="shrink-0 font-medium text-muted-foreground">{partNo}.</span>
        {/* Ghost until touched: at rest this should read as the same plain bold text every other
            row's title always was, not an empty-looking bordered box padded out to the row's full
            width for a ten-character name — the border/background only appear on hover or focus,
            which is also the only moment `w-full` normally looks correct to give room to search in. */}
        <SearchableSelect
          className="min-w-0 flex-1"
          inputClassName="h-auto border-transparent bg-transparent px-1 py-0 text-sm font-medium shadow-none hover:border-input focus-visible:bg-background focus-visible:px-2.5 focus-visible:py-1"
          value=""
          displayValue={part.part_name}
          onChange={id => {
            const item = bomItems.find(b => String(b.id) === id);
            if (item) onLink(part.id, item.id, item.material_description);
          }}
          options={bomItems.map(b => ({ value: String(b.id), label: b.material_description }))}
          placeholder="Part name"
        />
      </div>
      {suggestion && (
        <button type="button" onClick={() => onLink(part.id, suggestion.id, suggestion.material_description)}
          className="truncate text-left text-xs text-info hover:underline">
          Suggested: {suggestion.material_description}
        </button>
      )}
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
  const linkedBomItem = bomItems.find(b => b.id === part.bom_item_id);
  return (
    <div className="flex items-start gap-3 py-2.5 text-sm">
      <Checkbox className="mt-0.5" checked={selected} onCheckedChange={() => onToggle(part.id)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <PartTitleField part={part} partNo={part.part_no} bomItems={bomItems} onLink={onLinkBomItem} canEdit={canEdit} />
        <span className="text-xs text-muted-foreground">{sizeText(part)} · qty {part.qty}</span>
        {isNamedPart && (
          <span className="text-xs text-muted-foreground">
            {part.pieces_cut}/{part.qty} cut{part.linked_piece_code ? ` · matched to ${part.linked_piece_code}` : ''}
          </span>
        )}
        <LinkedBomItemContext item={linkedBomItem} />
      </div>
      {/* Bordered only once there's something to frame: a card around the cert's own details makes
          the X (unlink) read as "detach this cert record" — an action that belongs to what's inside
          the border — while the bin (remove the whole part) stays a plain icon outside it, reading
          as a separate, row-level action rather than something that happens to the certificate.
          Sized to its own content (shrink-0, no flex-1) rather than stretched to half the row — the
          title column's own flex-1 is what pushes this to the right, so the gap between them is real
          space between two boxes, not empty padding inside one oversized one. */}
      <div className={cn(
        'flex shrink-0 max-w-xs items-start justify-end gap-1',
        linked && 'rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5',
      )}>
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
// Linking to a BOM item at creation (not just afterward via PartRow's own BomItemLink select) is what
// lets a manually-added part benefit from the rest of the architecture immediately: Form III A group
// routing (link-bom-item's route now re-runs reconcileIiiaGroups), and lib/tc-match.js's certificate
// suggestions, which need a real bom_item to compare against. Optional — a genuinely off-BOM addition
// (an IBR-mandated attachment that was never a BOM line) still works with the fields typed by hand.
function AddPartDialog({ open, onOpenChange, documentId, bomItems, router }) {
  const EMPTY = { part_no: '', part_name: '', size_t: '', size_w: '', size_l: '', qty: '', bom_item_id: '' };
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  function pickBomItem(id) {
    const item = bomItems.find(b => String(b.id) === id);
    setForm(f => ({
      ...f, bom_item_id: id,
      part_name: item ? item.material_description : f.part_name,
      size_l: item?.size_spec && !f.size_t && !f.size_w ? item.size_spec : f.size_l,
    }));
  }

  async function submit() {
    if (!form.part_name.trim()) return showToast('Part name is required', 'error');
    setBusy(true);
    try {
      await api(`/api/qc-documents/${documentId}/parts`, {
        method: 'POST', body: { ...form, bom_item_id: form.bom_item_id ? Number(form.bom_item_id) : null },
      });
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
          <div className="flex flex-col gap-1.5">
            <Label>From BOM item (optional — fills in the name below, and enables certificate suggestions)</Label>
            <SearchableSelect value={form.bom_item_id} onChange={pickBomItem}
              options={bomItems.map(b => ({ value: String(b.id), label: b.material_description }))}
              placeholder="None — off-BOM addition" />
          </div>
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
// drawing_no is handled separately (a real calc_drawing_id picker, not free text — see the
// dedicated field in IiiaGroupCard) since the DG- reversal made it canonical.
const IIIA_HEADER_FIELDS = [
  ['design_pressure', 'Design Pressure (Kgf/cm²)'], ['design_temp', 'Design Temperature'],
  ['process_of_manufacture', 'Process of Manufacture'], ['mode_of_flange_attachment', 'Mode of Flange Attachment'],
  ['flange_particulars', 'Flange Particulars'], ['size_of_branch', 'Size of Branch & Attachment'],
  ['heat_treatment', 'Heat Treatment'], ['identification_marks', 'Identification Marks'],
  ['hydro_test_pressure', 'Hydro Test Pressure (Kgf/cm²)'], ['hydro_test_date', 'Hydro Test Date'],
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
      const res = await api(`/api/qc-documents/${documentId}/iiia-groups`, {
        method: 'POST', body: { name: form.name.trim(), assembly_id: form.assembly_id || null, group_label: form.group_label || null },
      });
      showToast(res.moved > 0 ? `Group added — pulled in ${res.moved} existing part${res.moved === 1 ? '' : 's'}` : 'Form III A group added');
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
            <SearchableSelect value={form.assembly_id} onChange={set('assembly_id')}
              options={assemblies.map(a => ({ value: String(a.id), label: a.name }))} placeholder="None" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Or BOM group label (optional)</Label>
            <SearchableSelect value={form.group_label} onChange={set('group_label')}
              options={groupLabels.map(l => ({ value: l, label: l }))} placeholder="None" />
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

function IiiaGroupCard({ group: g, parts, ungroupedParts, bomItems, onLinkBomItem, canEdit, documentId, drawings, router }) {
  const [form, setForm] = useState(() => Object.fromEntries(IIIA_HEADER_FIELDS.map(([k]) => [k, g[k] || ''])));
  const [drawingId, setDrawingId] = useState(g.calc_drawing_id ? String(g.calc_drawing_id) : '');
  const [busy, setBusy] = useState(false);
  const [addPartId, setAddPartId] = useState('');
  const [q, setQ] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const needle = q.trim().toLowerCase();
  const shownParts = needle
    ? parts.filter(p => [p.part_no, p.part_name].some(v => v && String(v).toLowerCase().includes(needle)))
    : parts;

  async function save() {
    setBusy(true);
    try {
      await api(`/api/qc-documents/${documentId}/iiia-groups/${g.id}`, {
        method: 'PATCH', body: { ...form, calc_drawing_id: drawingId ? Number(drawingId) : null },
      });
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
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-normal text-muted-foreground">Drawing No.</Label>
          {canEdit ? (
            <SearchableSelect value={drawingId} onChange={setDrawingId} className="h-8"
              options={drawings.map(d => ({ value: String(d.id), label: `${d.dgNo || d.id} · ${d.name}` }))}
              placeholder={g.drawing_no ? `Unlinked — was "${g.drawing_no}"` : 'Link a drawing…'} />
          ) : (
            <Input value={g.linked_drawing_dg_no || g.drawing_no || ''} disabled className="h-8" />
          )}
        </div>
        {IIIA_HEADER_FIELDS.map(([k, l]) => (
          <div key={k} className="flex flex-col gap-1">
            <Label className="text-xs font-normal text-muted-foreground">{l}</Label>
            <Input value={form[k]} onChange={set(k)} disabled={!canEdit} className="h-8" />
          </div>
        ))}
      </div>
      {canEdit && <Button size="sm" disabled={busy} onClick={save} className="w-fit">{busy ? 'Saving…' : 'Save header'}</Button>}
      {parts.length > 1 && (
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search part name or number" className="h-8 pl-8 text-sm" />
        </div>
      )}
      <div className="flex flex-col divide-y text-sm">
        {parts.length === 0 && <p className="py-2 text-xs text-muted-foreground">No parts in this group yet.</p>}
        {parts.length > 0 && shownParts.length === 0 && <p className="py-2 text-xs text-muted-foreground">No matches.</p>}
        {shownParts.map(p => (
          <div key={p.id} className="flex items-center justify-between gap-2 py-1.5">
            <div className="min-w-0 flex-1">
              <PartTitleField part={p} partNo={p.part_no} bomItems={bomItems} onLink={onLinkBomItem} canEdit={canEdit} />
              {p.qty ? <span className="text-xs text-muted-foreground">× {p.qty}</span> : null}
            </div>
            {canEdit && <Button size="icon-sm" variant="ghost" aria-label="Move back to Form IV A" onClick={() => removePart(p.id)}><XIcon className="size-3.5" /></Button>}
          </div>
        ))}
      </div>
      {canEdit && ungroupedParts.length > 0 && (
        <div className="flex items-center gap-1">
          <SearchableSelect value={addPartId} onChange={setAddPartId} className="h-8"
            options={ungroupedParts.map(p => ({ value: String(p.id), label: p.part_name }))}
            placeholder="Move a Form IV A part into this group" />
          <Button size="sm" variant="outline" disabled={!addPartId} onClick={addPart}>Add</Button>
        </div>
      )}
    </div>
  );
}

function IiiaGroupsCard({ documentId, projectId, groups, parts, assemblies, bomItems, onLinkBomItem, canEdit, router }) {
  const [newOpen, setNewOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [drawings, setDrawings] = useState([]);
  const groupLabels = useMemo(() => [...new Set(bomItems.map(b => b.group_label).filter(Boolean))], [bomItems]);
  const ungrouped = parts.filter(p => !p.iiia_group_id);
  const groupedPartCount = parts.length - ungrouped.length;

  // Best-effort, same idiom as PrWorkspace.jsx's drawing picker — the project's real DG- drawings,
  // for linking a Form III A group to its canonical drawing number.
  useEffect(() => {
    let cancelled = false;
    api(`/api/calc-drawings?project_id=${projectId}`).then(({ drawings }) => { if (!cancelled) setDrawings(drawings || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

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
        <CardAction>
          <div className="flex items-center gap-1">
            {canEdit && (
              <>
                <Button size="sm" variant="outline" disabled={syncBusy} onClick={syncBom}>
                  <RefreshCwIcon data-icon="inline-start" />{syncBusy ? 'Syncing…' : 'Sync from BOM'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
                  <PlusIcon data-icon="inline-start" />New group
                </Button>
              </>
            )}
            <CollapseButton open={open} onToggle={() => setOpen(o => !o)} label="Form III A groups" />
          </div>
        </CardAction>
      </CardHeader>
      {!open && (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {groups.length === 0 ? 'No groups yet' : `${groups.length} group${groups.length === 1 ? '' : 's'} · ${groupedPartCount} part${groupedPartCount === 1 ? '' : 's'}`}
            {groups.length > 0 && ` — ${groups.map(g => g.name).slice(0, 3).join(', ')}${groups.length > 3 ? ', …' : ''}`}
          </p>
        </CardContent>
      )}
      {open && (
        <CardContent className="flex flex-col gap-3">
          {groups.length === 0 && <p className="py-2 text-sm text-muted-foreground">No Form III A groups yet — this boiler files only Form IV A until one is added.</p>}
          {groups.map(g => (
            <IiiaGroupCard key={g.id} group={g} parts={parts.filter(p => p.iiia_group_id === g.id)}
              ungroupedParts={ungrouped} bomItems={bomItems} onLinkBomItem={onLinkBomItem}
              canEdit={canEdit} documentId={documentId} drawings={drawings} router={router} />
          ))}
        </CardContent>
      )}
      <NewIiiaGroupDialog open={newOpen} onOpenChange={setNewOpen} documentId={documentId} assemblies={assemblies} groupLabels={groupLabels} router={router} />
    </Card>
  );
}

// Mountings & fittings list editor (QC-FOLDER-DESIGN.md §4.2) — a small editable list, saved whole
// via the bulk-replace endpoint. serial_numbers is free text (one description can have several).
const EMPTY_MOUNT = { description: '', size: '', moc: '', serial_numbers: '', make: '', qty: '' };

function MountingsCard({ documentId, mountings, bomItems, canEdit, router }) {
  // `_key` is a locally-generated identity, never persisted (the server route only reads its own
  // whitelisted fields, so this extra prop round-trips harmlessly in the Save payload) — needed
  // because "Add row" prepends (client point: new rows go on top), which shifts every existing row's
  // ARRAY INDEX by one. Keying selection/edits by index instead of `_key` would silently point every
  // open selection at the wrong row the moment a row was added above it. `keySeq` only ever counts up,
  // so a key is never reused even after rows are deleted.
  const keySeq = useRef(mountings.length);
  const [rows, setRows] = useState(() => mountings.map((m, i) => ({ ...m, _key: i })));
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set());
  const setCell = (key, k) => e => setRows(rs => rs.map(r => (r._key === key ? { ...r, [k]: e.target.value } : r)));
  function toggleRow(key) {
    setSelected(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }
  function deleteSelected() {
    if (!selected.size) return;
    if (!window.confirm(`Remove ${selected.size} selected item${selected.size === 1 ? '' : 's'}?`)) return;
    setRows(rs => rs.filter(r => !selected.has(r._key)));
    setSelected(new Set());
  }
  // MOC and Make both get a searchable-but-not-locked picker: STANDARD_MOC is the app's own existing
  // canonical vocabulary (already what PrWorkspace's raw-material MOC field searches), extended with
  // whatever MOC values this project's own BOM actually uses (bought-out valve/gauge materials like
  // "CI"/"Bronze" that STANDARD_MOC, curated for structural steel, doesn't cover) — real values, not
  // invented ones. Make has no canonical list anywhere in the app, so it's built purely from this
  // project's own BOM makers. Both stay free-typeable (SearchableSelect's displayValue/onTextChange
  // hybrid) rather than a closed enum — a genuinely new maker or MOC must never be rejected outright.
  const mocOptions = useMemo(() => {
    const fromBom = bomItems.map(b => b.moc).filter(Boolean);
    return [...new Set([...STANDARD_MOC, ...fromBom])].sort();
  }, [bomItems]);
  const makeOptions = useMemo(() => [...new Set(bomItems.map(b => b.make).filter(Boolean))].sort(), [bomItems]);
  // Same reasoning as Form IV A's BomItemLink — a manually-added or manually-edited row that stays
  // tied to a real bom_items row keeps benefiting from the architecture (the canonical
  // inventory_serials lookup lib/qc-bom-sync.js's mountingSerials does at the next sync, and
  // certificate suggestions), instead of becoming a disconnected free-text island. Picking an item
  // is now the title field itself (SearchableSelect's displayValue/onTextChange hybrid mode below),
  // so description is always overwritten by the pick — that's the explicit "this is what this row
  // is" action now, not a blank-only autofill. The other fields stay fill-if-blank: picking a title
  // shouldn't clobber a size/MOC/make the user already typed in by hand.
  function setBomLink(key, id) {
    const item = id ? bomItems.find(b => b.id === id) : null;
    setRows(rs => rs.map(r => (r._key !== key ? r : {
      ...r, bom_item_id: id,
      description: item ? item.material_description : r.description,
      size: r.size || item?.size_spec || r.size,
      moc: r.moc || item?.moc || r.moc,
      make: r.make || item?.make || r.make,
      qty: r.qty || item?.qty_text || r.qty,
    })));
  }
  const setDescription = (key, text) => setRows(rs => rs.map(r => (r._key === key ? { ...r, description: text } : r)));
  // Qty is stored as one compound string ("40 SQ MTR") — the box only ever shows/edits the leading
  // number; the unit sits in its own label, sourced from whichever BOM item this row is linked to
  // (parseUnit'd from that item's own qty_text) so it updates the moment the link changes, and
  // falling back to whatever unit was already in the row's own text for a row with no link at all.
  // Typing a new number recombines it with that same unit before saving, so the stored value stays
  // in the one format every other reader of `qty` (the PDF, sync) already expects.
  const setQtyNumber = (key, unit) => e => {
    const num = e.target.value;
    setRows(rs => rs.map(r => (r._key === key ? { ...r, qty: unit ? `${num} ${unit}`.trim() : num } : r)));
  };

  // Filter AFTER pairing each row with its display position — `i` here is only ever used for the
  // "N." label and Save's sort_order, never for identity (every handler above keys by the stable
  // `_key` instead, precisely so a search filter or a prepended row can never point an edit/selection
  // at the wrong row).
  const needle = q.trim().toLowerCase();
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => {
    if (!needle) return true;
    return [r.description, r.size, r.moc, r.make, r.serial_numbers, r.qty]
      .some(v => v && String(v).toLowerCase().includes(needle));
  });
  const allShownSelected = shown.length > 0 && shown.every(({ r }) => selected.has(r._key));
  function toggleSelectShown() {
    setSelected(s => {
      if (allShownSelected) { const n = new Set(s); shown.forEach(({ r }) => n.delete(r._key)); return n; }
      return new Set([...s, ...shown.map(({ r }) => r._key)]);
    });
  }

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
        <CardAction>
          <div className="flex items-center gap-1">
            {canEdit && (
              <>
                <Button size="sm" variant="outline" disabled={syncBusy} onClick={syncBom}>
                  <RefreshCwIcon data-icon="inline-start" />{syncBusy ? 'Syncing…' : 'Sync from BOM'}
                </Button>
                <Button size="sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
              </>
            )}
            <CollapseButton open={open} onToggle={() => setOpen(o => !o)} label="bought-out items" />
          </div>
        </CardAction>
      </CardHeader>
      {!open && (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {rows.length} item{rows.length === 1 ? '' : 's'}
            {rows.length > 0 && ` — ${[...new Set(rows.map(r => r.make).filter(Boolean))].slice(0, 4).join(', ')}${new Set(rows.map(r => r.make).filter(Boolean)).size > 4 ? ', …' : ''}`}
          </p>
        </CardContent>
      )}
      {open && (
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 && <p className="py-4 text-sm text-muted-foreground">No bought-out items listed yet.</p>}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search description, size, MOC, make, or serial no." className="pl-8" />
          </div>
          {canEdit && (
            <>
              <Button size="sm" variant="outline" onClick={() => setRows(rs => [{ ...EMPTY_MOUNT, _key: keySeq.current++ }, ...rs])}>
                <PlusIcon data-icon="inline-start" />Add row
              </Button>
              <Button size="sm" variant="outline" disabled={shown.length === 0} onClick={toggleSelectShown}>
                {allShownSelected ? 'Deselect all' : 'Select all'}
              </Button>
              {selected.size > 0 && (
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={deleteSelected}>
                  Delete ({selected.size})
                </Button>
              )}
            </>
          )}
        </div>
        {rows.length > 0 && (
          <div className="flex items-center gap-2 px-0.5 text-xs font-medium text-muted-foreground">
            <span className="w-5 shrink-0" />
            <span className="w-5 shrink-0" />
            <span className="w-56 shrink-0">Description</span>
            <span className="w-36 shrink-0">Size</span>
            <span className="w-24 shrink-0">MOC</span>
            <span className="w-28 shrink-0">Make</span>
            <span className="w-36 shrink-0">Serial No(s)</span>
            <span className="w-32 shrink-0">Qty</span>
          </div>
        )}
        {shown.map(({ r, i }) => {
            // The unit is sourced from whichever BOM item this row is linked to (so it updates the
            // moment the link changes) — falling back to whatever unit was already embedded in this
            // row's own qty text for a row with no link at all (e.g. a purely manual "5 Bags" entry).
            const linkedItem = bomItems.find(b => b.id === r.bom_item_id);
            const qtyUnit = parseUnit(linkedItem?.qty_text) || parseUnit(r.qty);
            const key = r._key;
            return (
          <div key={key} className="flex flex-wrap items-center gap-2 border-t py-2 first:border-t-0">
            <Checkbox className="shrink-0" checked={selected.has(key)} onCheckedChange={() => toggleRow(key)} />
            <span className="w-5 shrink-0 text-sm font-medium text-muted-foreground">{i + 1}.</span>
            {canEdit ? (
              <SearchableSelect
                className="w-56 shrink-0 text-sm"
                value={r.bom_item_id ? String(r.bom_item_id) : ''}
                onChange={id => setBomLink(key, id ? Number(id) : null)}
                displayValue={r.description}
                onTextChange={text => setDescription(key, text)}
                options={bomItems.map(b => ({ value: String(b.id), label: b.material_description }))}
                placeholder="Description — type or pick from BOM"
              />
            ) : (
              <span className="w-56 shrink-0 truncate text-sm font-medium">{r.description || '—'}</span>
            )}
            {/* Each field styled for what it actually is, not one uniform text box: MOC/Make are
                searchable-but-free-typeable (real vocabularies, never a hard block on a new value);
                Serial No(s) is the field someone will actually eyeball-compare against a physical
                tag, so it's monospaced; Qty is a genuine number now (split from its unit above),
                so it's the one field that can safely be type="number"; Size stays plain free text —
                dimensional data has no reusable vocabulary the way a maker's name or MOC grade does. */}
            <Input value={r.size || ''} onChange={setCell(key, 'size')} disabled={!canEdit}
              placeholder="Size" className="h-8 w-36 text-xs" />
            {canEdit ? (
              <SearchableSelect className="h-8 w-24 shrink-0 text-xs" value="" displayValue={r.moc}
                onChange={v => setCell(key, 'moc')({ target: { value: v } })}
                onTextChange={text => setCell(key, 'moc')({ target: { value: text } })}
                options={mocOptions.map(m => ({ value: m, label: m }))} placeholder="MOC" />
            ) : (
              <span className="w-24 shrink-0 truncate rounded-full bg-muted/50 px-2 py-1 text-center text-xs font-medium">{r.moc || '—'}</span>
            )}
            {canEdit ? (
              <SearchableSelect className="h-8 w-28 shrink-0 text-xs" value="" displayValue={r.make}
                onChange={v => setCell(key, 'make')({ target: { value: v } })}
                onTextChange={text => setCell(key, 'make')({ target: { value: text } })}
                options={makeOptions.map(m => ({ value: m, label: m }))} placeholder="Make" />
            ) : (
              <span className="w-28 shrink-0 truncate text-xs">{r.make || '—'}</span>
            )}
            <Input value={r.serial_numbers || ''} onChange={setCell(key, 'serial_numbers')} disabled={!canEdit}
              placeholder="Serial No(s)" className="h-8 w-36 font-mono text-xs" />
            <div className="flex w-32 shrink-0 items-center gap-1">
              <Input value={parseNumber(r.qty)} onChange={setQtyNumber(key, qtyUnit)} disabled={!canEdit}
                placeholder="Qty" type="number" inputMode="decimal" className="h-8 w-16 text-right text-xs font-medium" />
              <span className="truncate text-xs text-muted-foreground" title={qtyUnit}>{qtyUnit}</span>
            </div>
            {canEdit && (
              <Button size="icon-sm" variant="ghost" aria-label="Remove row" className="ml-auto"
                onClick={() => setRows(rs => rs.filter(row => row._key !== key))}>
                <Trash2Icon className="size-3.5" />
              </Button>
            )}
          </div>
            );
          })}
      </CardContent>
      )}
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
  const [ivaOpen, setIvaOpen] = useState(true);

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

  async function linkBomItem(partId, bomItemId, partName) {
    try {
      await api(`/api/qc-documents/${document.id}/parts/${partId}/link-bom-item`, {
        method: 'POST', body: { bom_item_id: bomItemId, part_name: partName },
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

  async function removeSelectedParts() {
    const ids = [...selected];
    if (!window.confirm(`Remove ${ids.length} selected part${ids.length === 1 ? '' : 's'} from this document?`)) return;
    try {
      await Promise.all(ids.map(id => api(`/api/qc-documents/${document.id}/parts/${id}`, { method: 'DELETE' })));
      showToast(`${ids.length} part${ids.length === 1 ? '' : 's'} removed`);
      setSelected(new Set());
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
          {/* This model's form set requires Form III A (lib/qc-models.js) but no group exists yet —
              the PDF silently omits the page rather than dumping every part onto it (that would just
              reproduce the III A == IV A bug), so this is the only place that surfaces the gap before
              a folder goes out missing a required statutory form. */}
          {showIiia && groups.length === 0 && (
            <span className="flex items-center gap-1 text-xs text-warning">
              <AlertTriangleIcon className="size-3.5" />Form III A required — no groups defined yet
            </span>
          )}
          <Button disabled={incomplete} onClick={() => setPdfOpen(true)}>Preview PDF</Button>
          {canEdit && (
            <div className="flex items-center gap-1.5">
              <button type="button" role="switch" aria-checked={!!document.customer_visible}
                aria-label="Customer Share" disabled={visBusy || incomplete}
                onClick={() => setCustomerVisible(!document.customer_visible)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${document.customer_visible ? 'bg-primary' : 'bg-muted-foreground/25'}`}>
                <span className={`inline-block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform ${document.customer_visible ? 'translate-x-4' : ''}`} />
              </button>
              <span className="text-xs text-muted-foreground">
                Customer Share{incomplete ? ' (link every part first)' : document.customer_visible ? ' — visible in portal' : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Form II(1) &amp; III{' '}
            <span className="text-sm font-normal text-muted-foreground">
              (Maker's No. {document.makers_no || '—'} · Year {document.year_of_make || '—'} ·
              {' '}Design {document.design_pressure || '—'} · Hydro {document.hydro_test_pressure || '—'})
            </span>
          </CardTitle>
          {canEdit && (
            <CardAction><Button size="sm" variant="ghost" onClick={() => setBoilerOpen(true)}>Edit</Button></CardAction>
          )}
        </CardHeader>
      </Card>

      {showIiia && (
        <IiiaGroupsCard documentId={document.id} projectId={project.id} groups={groups} parts={parts} assemblies={assemblies}
          bomItems={bomItems} onLinkBomItem={linkBomItem} canEdit={canEdit} router={router} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Form IV A — Material Test Certificates</CardTitle>
          <CardAction>
            <div className="flex items-center gap-1">
              <Button size="xs" variant={filter === 'all' ? 'secondary' : 'ghost'} onClick={() => setFilter('all')}>All ({ivaParts.length})</Button>
              <Button size="xs" variant={filter === 'unlinked' ? 'secondary' : 'ghost'} onClick={() => setFilter('unlinked')}>
                Unlinked ({ivaUnlinked.length})
              </Button>
              <CollapseButton open={ivaOpen} onToggle={() => setIvaOpen(o => !o)} label="Form IV A" />
            </div>
          </CardAction>
        </CardHeader>
        {!ivaOpen && (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {ivaParts.length} part{ivaParts.length === 1 ? '' : 's'} · {ivaUnlinked.length} unlinked
            </p>
          </CardContent>
        )}
        {ivaOpen && (
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
        )}
      </Card>

      <MountingsCard key={mountings.length} documentId={document.id} mountings={mountings} bomItems={bomItems} canEdit={canEdit} router={router} />

      {selected.size > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between rounded-xl bg-popover p-3 text-sm shadow-lg ring-1 ring-foreground/10">
          <span>{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={removeSelectedParts}>Delete</Button>
            <Button size="sm" onClick={() => openPicker([...selected])}>Link to certificate…</Button>
          </div>
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
      <AddPartDialog open={addPartOpen} onOpenChange={setAddPartOpen} documentId={document.id} bomItems={bomItems} router={router} />
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
