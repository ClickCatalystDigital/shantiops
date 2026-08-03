'use client';

// Add / edit a Test Certificate — shared by TcBank (the bank's own Add button) and CertPicker (the
// "+ Add certificate" escape hatch inside the document editor's link picker, so the hard gate never
// dead-ends). Three field groups in the sample's own order/vocabulary (QC-CHANGES.md §2): identity,
// chemical analysis (per cast/heat), physical analysis (per rolled plate).
import { useMemo, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

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

  const makers = useMemo(() => [...new Set(certificates.map(c => c.steel_maker).filter(Boolean))].sort(), [certificates]);
  const specs = useMemo(() => [...new Set(certificates.map(c => c.material_spec).filter(Boolean))].sort(), [certificates]);

  const dupe = !editing && form.certificate_no.trim() && form.cast_no.trim()
    ? certificates.find(c => c.certificate_no === form.certificate_no.trim() && c.cast_no === form.cast_no.trim()
        && (c.plate_no || null) === (form.plate_no.trim() || null))
    : null;

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  function reset() {
    setForm(editing ? { ...EMPTY, ...certificate } : EMPTY);
  }

  async function submit() {
    if (!form.certificate_no.trim() || !form.cast_no.trim() || !form.material_spec.trim() || !form.steel_maker.trim()) {
      return showToast('Certificate No., Cast No., Steel Maker and Material Spec are required', 'error');
    }
    setBusy(true);
    try {
      if (editing) {
        await api(`/api/test-certificates/${certificate.id}`, { method: 'PATCH', body: form });
        showToast('Certificate updated');
        onSaved?.({ ...certificate, ...form });
      } else {
        const res = await api('/api/test-certificates', { method: 'POST', body: form });
        showToast('Certificate added');
        onSaved?.({ ...form, id: res.id });
        setForm(EMPTY);
      }
      onOpenChange(false);
      router?.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Sheet open={open} onOpenChange={o => { onOpenChange(o); if (!o) reset(); }}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editing ? 'Edit Test Certificate' : 'Add Test Certificate'}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4">
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
        <SheetFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add certificate'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
