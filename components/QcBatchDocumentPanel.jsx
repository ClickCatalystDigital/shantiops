'use client';

// components/QcBatchDocumentPanel.jsx — Multi-unit split Phase 6 UI: the entry point for
// POST /api/qc-documents/batch-children. One shared set of boiler specs (genuinely identical
// across identical units) + a maker's-no/doc-id prefix (auto-suffixed per unit, e.g. "SB-1109" ->
// "SB-1109-01") + which units to create for.
import { useEffect, useState } from 'react';
import { showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Hardcoded rather than importing lib/qc-doc-pdf.js's COMPANY_NAMES client-side — that module also
// pulls in @react-pdf/renderer (server-only), same two real entities either way.
const COMPANY_NAMES = ['Shanti Boilers', 'Shanti Techno Fab'];

const FIELDS = [
  ['year_of_make', 'Year of Make'], ['design_pressure', 'Design Pressure (Kg/cm²)'],
  ['hydro_test_pressure', 'Hydro Test Pressure (Kg/cm²)'], ['hydro_test_date', 'Hydro Test Date'],
  ['working_pressure', 'Working Pressure (Kg/cm²)'], ['boiler_type', 'Boiler Type'],
  ['length_overall', 'Length Overall'], ['internal_diameter', 'Internal Dia'],
  ['heating_surface', 'Heating Surface (m²)'], ['evaporation_capacity', 'Evaporation Cap. (Kg/hr)'],
  ['steam_temp', 'Steam Outlet Temp. (°C)'],
];

export default function QcBatchDocumentPanel({ projectId }) {
  const [children, setChildren] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [makersNoPrefix, setMakersNoPrefix] = useState('');
  const [docIdPrefix, setDocIdPrefix] = useState('');
  const [company, setCompany] = useState(COMPANY_NAMES[0]);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/split`).then(r => r.json())
      .then(j => setChildren(j.children || [])).catch(() => {});
  }, [projectId]);

  function toggle(id) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  async function submit() {
    if (!makersNoPrefix.trim() || !docIdPrefix.trim()) return showToast("Maker's No. and Document ID prefixes are required", 'error');
    if (!selected.size) return showToast('Pick at least one unit', 'error');
    setBusy(true);
    try {
      const res = await fetch('/api/qc-documents/batch-children', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master_project_id: Number(projectId), child_project_ids: [...selected],
          makers_no_prefix: makersNoPrefix.trim(), doc_id_prefix: docIdPrefix.trim(), company, ...values,
        }),
      }).then(r => r.json().then(j => ({ ok: r.ok, ...j })));
      if (!res.ok) throw new Error(res.error || 'Failed');
      showToast(`Created ${res.created.length} statutory documents`);
      setSelected(new Set());
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  if (!children.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Raise statutory documents across units</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Maker's No. prefix</Label>
            <Input className="h-9" placeholder="e.g. SB-1109" value={makersNoPrefix} onChange={e => setMakersNoPrefix(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Document ID prefix</Label>
            <Input className="h-9" placeholder="e.g. SB-1109-DOC" value={docIdPrefix} onChange={e => setDocIdPrefix(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Company</Label>
            <Select value={company} onValueChange={setCompany}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COMPANY_NAMES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {FIELDS.map(([key, label]) => (
            <div key={key} className="flex flex-col gap-1">
              <Label className="text-xs">{label}</Label>
              <Input className="h-9" type={key === 'hydro_test_date' ? 'date' : 'text'}
                value={values[key] || ''} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {children.map(c => (
            <label key={c.id} className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
              {c.project_no}
            </label>
          ))}
        </div>
        <Button size="sm" className="w-fit" disabled={busy} onClick={submit}>
          {busy ? '…' : `Create ${selected.size || ''} document(s)`}
        </Button>
      </CardContent>
    </Card>
  );
}
