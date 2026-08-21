// components/CertForm.jsx

'use client';

// Add / edit a Test Certificate — shared by TcBank (the bank's own Add button) and CertPicker (the
// "+ Add certificate" escape hatch inside the document editor's link picker, so the hard gate never
// dead-ends). Three field groups in the sample's own order/vocabulary (QC-CHANGES.md §2): identity,
// chemical analysis (per cast/heat), physical analysis (per rolled plate).
//
// V3-CHANGES.md — layout rebuilt as a real 70/30 split: the source PDF is the thing people are
// transcribing from, so it gets the width (70%) and full-height multi-page scrolling; the form is a
// narrow, fast-scanning column (30%) grouped into cards so eyes don't have to hunt for the next
// field during daily entry.
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, showToast } from '@/lib/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { XIcon, AlertTriangleIcon } from 'lucide-react';
import PdfInlinePreview from './PdfInlinePreview';
import SearchableSelect from './SearchableSelect';

// Only fields the form actually has — guards against the AI returning an unexpected key.
const EXTRACTABLE_FIELDS = ['certificate_no', 'cast_no', 'plate_no', 'material_spec', 'steel_maker',
  'size_t', 'size_w', 'size_l', 'chem_c', 'chem_mn', 'chem_p', 'chem_s', 'chem_si',
  'ys', 'uts', 'elongation', 'bend_test'];

const EMPTY = {
  certificate_no: '', cast_no: '', plate_no: '', material_spec: '', steel_maker: '',
  size_t: '', size_w: '', size_l: '',
  chem_c: '', chem_mn: '', chem_p: '', chem_s: '', chem_si: '',
  ys: '', uts: '', elongation: '', bend_test: 'OK',
  steel_making_process: '', heat_treatment: '',
};

// certificate.project_ids comes back from getTestCertificates as a "2,6" concatenation.
function parseProjectIds(certificate, fallback) {
  if (!certificate?.project_ids) return fallback.map(Number).filter(Boolean);
  return String(certificate.project_ids).split(',').map(Number).filter(Boolean);
}

// A card wrapper for each field group — gives daily-use scanning a clear rhythm (title, then
// fields) instead of the fields all running together in one long column.
function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card/40 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </section>
  );
}

// A compact input with its own small label above it — placeholders alone (the old "C" / "Mn" style)
// vanish the moment you type, which makes a dense grid of numbers hard to audit later.
function LabeledInput({ label, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <Input {...props} />
    </div>
  );
}

// A Select seeded from the bank's existing distinct values, with a "+ Custom" escape hatch — same
// idiom as ProcurementWorkspace's PaymentTermsField. Kills the "S" / "SA106 Gr B" typo class the
// sample already has, without hard-coding a fixed option list this business doesn't have yet.
function PickOrType({ label, value, options, onChange }) {
  const [custom, setCustom] = useState(!!value && !options.includes(value));
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {custom ? (
        <Input value={value} onChange={e => onChange(e.target.value)} placeholder={`Type ${label.toLowerCase()}`} autoFocus />
      ) : (
        <Select value={value || undefined} onValueChange={v => (v === '__custom' ? setCustom(true) : onChange(v))}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>
            {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            <SelectItem value="__custom">+ Custom…</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

// Floats as its own panel to the left of the form Sheet instead of living inside it — portaled
// straight to <body>, positioned above the Sheet's own dim/blur overlay (z-[60] beats the overlay's
// z-50), reusing the exact glass/ring/blur tokens SheetContent itself uses so it reads as part of
// the same system rather than a bolted-on extra. It has no open/close animation or focus trap of
// its own — it's a passive companion; the Sheet still owns Escape and overlay-click-to-close.
function FloatingPdfPanel({ open, children }) {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-y-6 left-6 z-[60] flex w-[min(52vw,820px)] flex-col gap-2 overflow-hidden rounded-xl border bg-popover/85 p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 backdrop-blur-xl">
      {children}
    </div>,
    document.body
  );
}

export default function CertForm({ open, onOpenChange, certificate = null, certificates = [], projects = [], defaultProjectIds = [], router, onSaved }) {
  const editing = !!certificate;
  const [form, setForm] = useState(() => (editing ? { ...EMPTY, ...certificate } : EMPTY));
  const [projectIds, setProjectIds] = useState(() => parseProjectIds(certificate, defaultProjectIds));
  const [busy, setBusy] = useState(false);
  const [pdfFile, setPdfFile] = useState(null);   // newly picked, not yet uploaded
  const [extracting, setExtracting] = useState(false);

  const makers = useMemo(() => [...new Set(certificates.map(c => c.steel_maker).filter(Boolean))].sort(), [certificates]);
  const specs = useMemo(() => [...new Set(certificates.map(c => c.material_spec).filter(Boolean))].sort(), [certificates]);

  // Global dupe (a physical cert is entered once, then linked to many projects). Best-effort client
  // warning over the certs we were handed; the server enforces it globally regardless.
  const dupe = !editing && form.certificate_no.trim() && form.cast_no.trim()
    ? certificates.find(c => c.certificate_no === form.certificate_no.trim() && c.cast_no === form.cast_no.trim()
        && (c.plate_no || null) === (form.plate_no.trim() || null))
    : null;

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  function reset() {
    setForm(editing ? { ...EMPTY, ...certificate } : EMPTY);
    setProjectIds(parseProjectIds(certificate, defaultProjectIds));
    setPdfFile(null);
  }

  // Add-flow only (see file header note): auto-fills empty fields from the AI's best-effort read of
  // the PDF. Edit-flow still lets you attach/replace a PDF, just without silently overwriting
  // already-correct saved values on pick.
    async function pickPdf(f) {
    if (!f) return;
    setPdfFile(f);
    if (editing) return;

    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const { fields } = await api('/api/test-certificates/extract', { method: 'POST', body: fd });
      setForm(cur => {
        const next = { ...cur };
        for (const k of EXTRACTABLE_FIELDS) if (fields[k] != null && fields[k] !== '') next[k] = String(fields[k]);
        return next;
      });
      showToast('Fields populated from the PDF — review before saving');
    } catch (err) {
      showToast(`Couldn't auto-fill from the PDF (${err.message}) — fill in the fields manually`, 'warning');
    }
    setExtracting(false);
  }

  async function submit() {
    if (!form.certificate_no.trim() || !form.cast_no.trim() || !form.material_spec.trim() || !form.steel_maker.trim()) {
      return showToast('Certificate No., Cast No., Steel Maker and Material Spec are required', 'error');
    }
    setBusy(true);
    try {
      let id = certificate?.id;
      const body = { ...form, project_ids: projectIds };
      if (editing) {
        await api(`/api/test-certificates/${certificate.id}`, { method: 'PATCH', body });
        onSaved?.({ ...certificate, ...form });
      } else {
        const res = await api('/api/test-certificates', { method: 'POST', body });
        id = res.id;
        onSaved?.({ ...form, id });
      }

      if (pdfFile) {
        try {
          const fd = new FormData();
          fd.append('file', pdfFile);
          await api(`/api/test-certificates/${id}/pdf`, { method: 'POST', body: fd });
          showToast(editing ? 'Certificate updated' : 'Certificate added, with PDF');
        } catch (err) {
          showToast(`${editing ? 'Certificate updated' : 'Certificate added'}, but the PDF couldn't be uploaded (${err.message})`, 'warning');
        }
      } else {
        showToast(editing ? 'Certificate updated' : 'Certificate added');
      }

      if (!editing) setForm(EMPTY);
      setPdfFile(null);
      onOpenChange(false);
      router?.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function del() {
    if (!editing) return;
    if (!window.confirm(`Delete certificate ${certificate.certificate_no}? This also removes its stored PDF.`)) return;
    setBusy(true);
    try {
      await api(`/api/test-certificates/${certificate.id}`, { method: 'DELETE' });
      showToast('Certificate deleted');
      onOpenChange(false);
      router?.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <>
      <FloatingPdfPanel open={open}>
        <div className="flex shrink-0 items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Source PDF</p>
          {!editing && (
            <p className="text-xs text-muted-foreground">AI fills the fields on the right — always review before saving.</p>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <PdfInlinePreview
            file={pdfFile}
            url={!pdfFile && certificate?.pdf_key ? `/api/test-certificates/${certificate.id}/pdf` : undefined}
            onPick={pickPdf}
            extracting={extracting}
          />
        </div>
      </FloatingPdfPanel>

      <Sheet open={open} onOpenChange={o => { onOpenChange(o); if (!o) reset(); }}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="shrink-0 border-b px-6 py-4">
            <SheetTitle>{editing ? 'Edit Test Certificate' : 'Add Test Certificate'}</SheetTitle>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="flex flex-col gap-4 p-4 md:p-6">
              <Section title="Identity">
                <div className="flex flex-col gap-1.5">
                  <Label>Projects <span className="font-normal text-muted-foreground">(optional — add now or later)</span></Label>
                  {projectIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {projectIds.map(pid => {
                        const p = projects.find(x => x.id === pid);
                        return (
                          <span key={pid} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs">
                            {p ? p.project_no : `#${pid}`}
                            <button type="button" aria-label="Remove project"
                              onClick={() => setProjectIds(ids => ids.filter(x => x !== pid))}>
                              <XIcon className="size-3 text-muted-foreground hover:text-foreground" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <SearchableSelect
                    items={projects.filter(p => !projectIds.includes(p.id))}
                    value={null}
                    onChange={id => id != null && setProjectIds(ids => [...ids, Number(id)])}
                    getLabel={p => p.project_no} getSub={p => p.customer_name}
                    triggerPlaceholder="Add a project…" placeholder="Search projects…" className="w-full" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Certificate No.</Label>
                  <Input value={form.certificate_no} onChange={set('certificate_no')} placeholder="RCL/MTL/PLM/80839164" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <LabeledInput label="Cast No." value={form.cast_no} onChange={set('cast_no')} />
                  <LabeledInput label="Plate No." value={form.plate_no} onChange={set('plate_no')} />
                </div>

                {dupe && (
                  <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>Already in the bank — same certificate, cast and plate ({dupe.material_spec}, {dupe.steel_maker}).</span>
                  </div>
                )}

                <PickOrType label="Steel Maker" value={form.steel_maker} options={makers} onChange={v => setForm(f => ({ ...f, steel_maker: v }))} />
                <PickOrType label="Material Spec" value={form.material_spec} options={specs} onChange={v => setForm(f => ({ ...f, material_spec: v }))} />

                <div className="flex flex-col gap-1.5">
                  <Label>Size (mm)</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <LabeledInput label="T" value={form.size_t} onChange={set('size_t')} />
                    <LabeledInput label="W" value={form.size_w} onChange={set('size_w')} />
                    <LabeledInput label="L" value={form.size_l} onChange={set('size_l')} />
                  </div>
                </div>
              </Section>

              <Section title="Chemical analysis — of the cast (%)">
                <div className="grid grid-cols-5 gap-2">
                  <LabeledInput label="C" value={form.chem_c} onChange={set('chem_c')} />
                  <LabeledInput label="Mn" value={form.chem_mn} onChange={set('chem_mn')} />
                  <LabeledInput label="P" value={form.chem_p} onChange={set('chem_p')} />
                  <LabeledInput label="S" value={form.chem_s} onChange={set('chem_s')} />
                  <LabeledInput label="Si" value={form.chem_si} onChange={set('chem_si')} />
                </div>
              </Section>

              <Section title="Physical analysis — of this plate">
                <div className="grid grid-cols-3 gap-2">
                  <LabeledInput label="Y.S (MPa)" value={form.ys} onChange={set('ys')} />
                  <LabeledInput label="UTS (MPa)" value={form.uts} onChange={set('uts')} />
                  <LabeledInput label="Elongation %" value={form.elongation} onChange={set('elongation')} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Bend / Flat test</Label>
                  <Select value={form.bend_test} onValueChange={v => setForm(f => ({ ...f, bend_test: v }))}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OK">OK</SelectItem>
                      <SelectItem value="NOT OK">NOT OK</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Form III A extras (only that form uses them; blank is fine for IV A-only certs). */}
                <div className="grid grid-cols-2 gap-2">
                  <LabeledInput label="Steel Making Process" value={form.steel_making_process} onChange={set('steel_making_process')} placeholder="e.g. BASIC OXYGEN" />
                  <LabeledInput label="Heat Treatment" value={form.heat_treatment} onChange={set('heat_treatment')} placeholder="e.g. NORMALISED" />
                </div>
              </Section>
            </div>
          </div>

          <SheetFooter className="flex-row items-center justify-end gap-2 border-t px-6 py-4">
            {editing && (
              <Button variant="outline" disabled={busy} className="mr-auto text-destructive" onClick={del}>Delete</Button>
            )}
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={busy} onClick={submit}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add certificate'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}