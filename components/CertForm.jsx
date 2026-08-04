'use client';

// Add / edit a Test Certificate — shared by TcBank (the bank's own Add button) and CertPicker (the
// "+ Add certificate" escape hatch inside the document editor's link picker, so the hard gate never
// dead-ends). Three field groups in the sample's own order/vocabulary (QC-CHANGES.md §2): identity,
// chemical analysis (per cast/heat), physical analysis (per rolled plate).
import { useMemo, useRef, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { UploadIcon, SparklesIcon } from 'lucide-react';
import PdfInlinePreview from './PdfInlinePreview';

// Only fields the form actually has — guards against the AI returning an unexpected key.
const EXTRACTABLE_FIELDS = ['certificate_no', 'cast_no', 'plate_no', 'material_spec', 'steel_maker',
  'size_t', 'size_w', 'size_l', 'chem_c', 'chem_mn', 'chem_p', 'chem_s', 'chem_si',
  'ys', 'uts', 'elongation', 'bend_test'];

const EMPTY = {
  certificate_no: '', cast_no: '', plate_no: '', material_spec: '', steel_maker: '',
  size_t: '', size_w: '', size_l: '',
  chem_c: '', chem_mn: '', chem_p: '', chem_s: '', chem_si: '',
  ys: '', uts: '', elongation: '', bend_test: 'OK',
};

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

export default function CertForm({ open, onOpenChange, certificate = null, certificates = [], router, onSaved }) {
  const editing = !!certificate;
  const [form, setForm] = useState(() => (editing ? { ...EMPTY, ...certificate } : EMPTY));
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const [pdfFile, setPdfFile] = useState(null);   // newly picked, not yet uploaded
  const [extracting, setExtracting] = useState(false);

  const makers = useMemo(() => [...new Set(certificates.map(c => c.steel_maker).filter(Boolean))].sort(), [certificates]);
  const specs = useMemo(() => [...new Set(certificates.map(c => c.material_spec).filter(Boolean))].sort(), [certificates]);

  const dupe = !editing && form.certificate_no.trim() && form.cast_no.trim()
    ? certificates.find(c => c.certificate_no === form.certificate_no.trim() && c.cast_no === form.cast_no.trim()
        && (c.plate_no || null) === (form.plate_no.trim() || null))
    : null;

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  function reset() {
    setForm(editing ? { ...EMPTY, ...certificate } : EMPTY);
    setPdfFile(null);
  }

  // Add-flow only (see file header note): auto-fills empty fields from the AI's best-effort read of
  // the PDF. Edit-flow still lets you attach/replace a PDF, just without silently overwriting
  // already-correct saved values on pick.
  async function pickPdf(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
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
      if (editing) {
        await api(`/api/test-certificates/${certificate.id}`, { method: 'PATCH', body: form });
        onSaved?.({ ...certificate, ...form });
      } else {
        const res = await api('/api/test-certificates', { method: 'POST', body: form });
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
    <Sheet open={open} onOpenChange={o => { onOpenChange(o); if (!o) reset(); }}>
      {/* Widened from max-w-md: the PDF column needs real width alongside the form, on desktop —
          stacks to one column on mobile (client asked for "left side of the overlay," which only
          means something once there's room for two). */}
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{editing ? 'Edit Test Certificate' : 'Add Test Certificate'}</SheetTitle>
        </SheetHeader>
        <div className="grid grid-cols-1 gap-4 overflow-y-auto px-4 md:grid-cols-2">
          {/* Left — PDF upload/preview. Add-flow: picking a file also triggers AI populate (best-
              effort; failure just leaves the form for manual entry, per the header note). */}
          <div className="flex flex-col gap-2 md:order-1">
            <p className="text-xs font-medium text-muted-foreground">SOURCE PDF</p>
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={pickPdf} />
            <Button type="button" variant="outline" size="sm" disabled={extracting} onClick={() => fileRef.current?.click()}>
              {extracting ? <><SparklesIcon data-icon="inline-start" className="animate-pulse" />Reading PDF…</>
                : <><UploadIcon data-icon="inline-start" />{pdfFile || certificate?.pdf_key ? 'Replace PDF' : 'Upload PDF'}</>}
            </Button>
            {!editing && (
              <p className="text-xs text-muted-foreground">AI fills the fields on the right — always review before saving.</p>
            )}
            <PdfInlinePreview file={pdfFile} url={!pdfFile && certificate?.pdf_key ? `/api/test-certificates/${certificate.id}/pdf` : undefined} />
          </div>

          <div className="flex flex-col gap-4 md:order-2">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium text-muted-foreground">IDENTITY</p>
            <div className="flex flex-col gap-1.5">
              <Label>Certificate No.</Label>
              <Input value={form.certificate_no} onChange={set('certificate_no')} placeholder="RCL/MTL/PLM/80839164" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Cast No.</Label>
                <Input value={form.cast_no} onChange={set('cast_no')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Plate No.</Label>
                <Input value={form.plate_no} onChange={set('plate_no')} />
              </div>
            </div>
            {dupe && (
              <p className="text-xs text-warning">
                ⚠ Already in the bank — same certificate, cast and plate ({dupe.material_spec}, {dupe.steel_maker}).
              </p>
            )}
            <PickOrType label="Steel Maker" value={form.steel_maker} options={makers} onChange={v => setForm(f => ({ ...f, steel_maker: v }))} />
            <PickOrType label="Material Spec" value={form.material_spec} options={specs} onChange={v => setForm(f => ({ ...f, material_spec: v }))} />
            <div className="flex flex-col gap-1.5">
              <Label>Size (mm)</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input value={form.size_t} onChange={set('size_t')} placeholder="T" />
                <Input value={form.size_w} onChange={set('size_w')} placeholder="W" />
                <Input value={form.size_l} onChange={set('size_l')} placeholder="L" />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium text-muted-foreground">CHEMICAL ANALYSIS — of the cast (%)</p>
            <div className="grid grid-cols-5 gap-2">
              <Input value={form.chem_c} onChange={set('chem_c')} placeholder="C" />
              <Input value={form.chem_mn} onChange={set('chem_mn')} placeholder="Mn" />
              <Input value={form.chem_p} onChange={set('chem_p')} placeholder="P" />
              <Input value={form.chem_s} onChange={set('chem_s')} placeholder="S" />
              <Input value={form.chem_si} onChange={set('chem_si')} placeholder="Si" />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium text-muted-foreground">PHYSICAL ANALYSIS — of this plate</p>
            <div className="grid grid-cols-3 gap-2">
              <Input value={form.ys} onChange={set('ys')} placeholder="Y.S (MPa)" />
              <Input value={form.uts} onChange={set('uts')} placeholder="UTS (MPa)" />
              <Input value={form.elongation} onChange={set('elongation')} placeholder="Elongation %" />
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
          </div>
          </div>
        </div>
        <SheetFooter>
          {editing && (
            <Button variant="outline" disabled={busy} className="mr-auto text-destructive" onClick={del}>Delete</Button>
          )}
          <Button disabled={busy} onClick={submit}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add certificate'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
