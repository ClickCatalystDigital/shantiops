'use client';

// QC → Test Certificates → Trace (docs/gulf-coast-asme-plan.md, Phase 1b). Type a heat number to follow it
// forward (certificate → pieces and where they were received → BOM lines and projects → welds → QC documents),
// or pick a project above to see every heat it used and print its Material Trace Map.
import { useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Card, CardHeader, CardTitle, CardContent, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FileDownIcon, SearchIcon } from 'lucide-react';

export default function HeatTrace({ projectId = null }) {
  const [heat, setHeat] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  async function run(qs) {
    setBusy(true);
    try { setResult(await api(`/api/trace?${qs}`)); } catch (e) { showToast(e.message, 'error'); } finally { setBusy(false); }
  }
  useEffect(() => { if (projectId) run(`project=${projectId}`); else setResult(null); }, [projectId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Heat trace</CardTitle>
        {projectId && <CardAction><Button size="sm" variant="outline" asChild>
          <a href={`/api/projects/${projectId}/trace-map/pdf`} target="_blank" rel="noreferrer"><FileDownIcon /> Material Trace Map</a></Button></CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (heat.trim()) run(`heat=${encodeURIComponent(heat.trim())}`); }}>
          <Input value={heat} onChange={e => setHeat(e.target.value)} placeholder="Heat number, e.g. H21A" className="max-w-xs" />
          <Button type="submit" disabled={busy || !heat.trim()}><SearchIcon /> Trace</Button>
        </form>
        {!result ? <p className="text-sm text-muted-foreground">Type a heat number, or pick a project above to see every heat it used.</p>
          : result.length === 0 ? <p className="text-sm text-muted-foreground">Nothing found for that.</p>
          : result.map((c, i) => <Chain key={`${c.heat}-${i}`} c={c} />)}
      </CardContent>
    </Card>
  );
}

function Step({ title, children, empty }) {
  return (
    <div className="flex flex-col gap-1 border-l-2 pl-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{title}</div>
      {children?.length ? children : <div className="text-xs text-muted-foreground">{empty}</div>}
    </div>
  );
}

function Chain({ c }) {
  const dims = p => [p.length_mm, p.width_mm, p.thickness_mm].filter(Boolean).join(' × ');
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center gap-2"><Badge>Heat {c.heat}</Badge>
        <span className="text-xs text-muted-foreground">{c.projects.map(p => p.project_no).join(', ') || 'not used on a project yet'}</span></div>
      <Step title="Certificates" empty="No certificate in the bank for this heat">
        {c.certificates.map(t => <div key={t.id} className="text-sm">{t.certificate_no}{t.plate_no ? ` · plate ${t.plate_no}` : ''} · {t.material_spec} · {t.steel_maker}
          {t.pdf_key && <a className="ml-2 text-xs underline" href={`/api/test-certificates/${t.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>}</div>)}
      </Step>
      <Step title="Pieces" empty="No stock pieces carry this heat">
        {c.pieces.map(p => <div key={p.id} className="text-sm">{p.code} <span className="text-muted-foreground">{p.item || ''} {dims(p)} · {p.status}
          {p.parent_id ? ' · cut from another piece' : ''}{p.supplier ? ` · from ${p.supplier}` : ''}{p.po_no ? ` (${p.po_no})` : ''}{p.project_no ? ` · ${p.project_no}` : ''}</span></div>)}
      </Step>
      <Step title="Used on" empty="Not linked to a BOM line">
        {c.bom.map(b => <div key={b.id} className="text-sm">{b.project_no} · {b.material_description}{b.size_spec ? ` ${b.size_spec}` : ''}</div>)}
      </Step>
      <Step title="Welds" empty="No weld on the register joins these parts">
        {c.welds.map(w => <div key={w.id} className="text-sm">{w.project_no} · {w.weld_no} {w.joint || ''} <span className="text-muted-foreground">{w.wps_no || ''} · {w.welder_stamps || ''} · {w.nde || ''}</span></div>)}
      </Step>
      <Step title="QC documents" empty="Not cited in a QC document">
        {c.documents.map(d => <div key={`${d.id}-${d.part_name}`} className="text-sm">{d.project_no} · {d.doc_id} · {d.part_name}</div>)}
      </Step>
    </div>
  );
}
