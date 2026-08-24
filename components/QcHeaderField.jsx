'use client';

// components/QcHeaderField.jsx — one control per qc_documents header field, driven by
// lib/qc-document-fields.js's { key, label, required, kind, unit }. Shared by the creation sheet
// (StatutoryDocsPanel.jsx) and the edit sheet (QcDocumentEditor.jsx) so both render identically
// instead of drifting (they used to be two independently hand-rolled field lists).
//
// Required-field asterisk / optional hint reuse this app's existing convention (PrWorkspace.jsx,
// NcrPanel.jsx: `text-danger` `*`; PrWorkspace.jsx's own `(optional)` label suffix) — no new style.
import { Input } from './ui/input';
import { Label } from './ui/label';
import DimensionInput from './DimensionInput';

// Same "canonical display string in, decomposed UI, composed string out" idiom QtyInput.jsx uses
// for qty_text — unit here is fixed (not user-picked), so only the leading number is decomposed.
function parseNumber(value) {
  const m = String(value ?? '').match(/-?\d+(\.\d+)?/);
  return m ? m[0] : '';
}

export default function QcHeaderField({ field, value, onChange }) {
  const { label, required, kind, unit } = field;

  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label}
        {required ? <span className="text-danger"> *</span> : <span className="text-muted-foreground"> (optional)</span>}
      </Label>
      {kind === 'number' ? (
        <div className="flex items-center gap-1.5">
          <Input type="number" step="any" className="flex-1" value={parseNumber(value)}
            onChange={e => onChange(unit ? `${e.target.value} ${unit}`.trim() : e.target.value)} />
          {unit && <span className="shrink-0 text-sm text-muted-foreground">{unit}</span>}
        </div>
      ) : kind === 'dimension' ? (
        <DimensionInput valueMm={parseNumber(value)} onChangeMm={mm => onChange(mm ? `${mm} mm` : '')} />
      ) : kind === 'date' ? (
        <Input type="date" value={value || ''} onChange={e => onChange(e.target.value)} />
      ) : (
        <Input value={value || ''} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  );
}
