'use client';

// Material Indent bridge — Production's own cross-project worklist of "material Stores has routed
// to me, ready to indent" (the plan's §9/§10). Backed by GET /api/production/material-indent-lines
// (lib/data.js's getPendingProductionMaterialLines); the actual create action reuses the existing,
// unmodified POST /api/material-indents — nothing about that route changes here.
//
// Grouped by project, one "Create Material Indent" per group — material_indents.project_id is a
// single scalar, and the release route rejects a line whose own bom_item.project_id doesn't match
// it, so a selection can never span projects (see the plan's §10 for the full trace).
import { useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardHeader, CardTitle, CardContent, CardAction } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// Same tiny parse ReceiveBomItemDialog.jsx's own local unitSuffix() already uses — qty_text is
// free text like "2 Nos"; this strips the leading number to show just the unit.
function unitSuffix(qtyText) {
  return String(qtyText || '').replace(/^\s*[\d.]+\s*/, '').trim();
}

// A split-master line routed for several child units produces one worklist row per unit (each was
// independently allocated/routed) — key on (bom_item_id, unit) so they select independently.
function rowKey(r) {
  return `${r.bom_item_id}:${r.unit_project_no || ''}`;
}

export default function MaterialIndentWorklist() {
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState([]);

  async function load() {
    const data = await api('/api/production/material-indent-lines');
    setRows(data);
    setSelected(new Set());
  }

  useEffect(() => { load().catch(err => showToast(err.message, 'error')); }, []);

  function toggle(key) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function createIndent(projectId, groupRows) {
    const lines = groupRows.filter(r => selected.has(rowKey(r)) && remainingQty(r) > 0);
    if (!lines.length) return;
    setBusy(true);
    try {
      // The specific child unit(s) this material is for has no column on material_indent_items
      // today (a known, documented limitation — see the plan's §9) — folded into notes as the
      // pragmatic, schema-respecting way to not silently drop context Stores/Production still need.
      const units = [...new Set(lines.map(r => r.unit_project_no).filter(Boolean))];
      const created = await api('/api/material-indents', {
        method: 'POST',
        body: {
          project_id: projectId,
          notes: units.length ? `For unit(s): ${units.join(', ')}` : undefined,
          items: lines.map(r => ({ bom_item_id: r.bom_item_id, qty_requested: remainingQty(r) })),
        },
      });
      showToast(`Material Indent ${created.indent_no} raised — ${lines.length} item(s)`);
      setJustCreated(prev => [{ id: created.id, indent_no: created.indent_no }, ...prev].slice(0, 5));
      await load();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  const recentlyCreated = justCreated.length > 0 && (
    <div className="flex flex-col gap-1 rounded-md border border-success/30 bg-success-surface p-3 text-sm">
      <span className="font-medium">Just created</span>
      {justCreated.map(ind => (
        <div key={ind.id} className="flex items-center gap-2 text-xs">
          <span>{ind.indent_no}</span>
          <a href={`/api/material-indents/${ind.id}/pdf`} target="_blank" rel="noreferrer" className="underline">Download PDF</a>
        </div>
      ))}
    </div>
  );

  if (rows === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!rows.length) {
    return (
      <div className="flex flex-col gap-4">
        {recentlyCreated}
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Nothing routed to Production yet — Stores routes a received BOM line "→ Production" once
          it's ready, and it appears here automatically.
        </CardContent></Card>
      </div>
    );
  }

  const groups = new Map();
  rows.forEach(r => {
    if (!groups.has(r.indent_project_id)) {
      groups.set(r.indent_project_id, { project_no: r.indent_project_no, customer_name: r.customer_name, rows: [] });
    }
    groups.get(r.indent_project_id).rows.push(r);
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Material Stores has routed to Production, ready to be indented. Select lines within one
        project and raise a single indent — an indent can't span projects, so each group has its
        own "Create Material Indent" action.
      </p>
      {recentlyCreated}
      {[...groups.entries()].map(([projectId, group]) => {
        const selectedCount = group.rows.filter(r => selected.has(rowKey(r))).length;
        return (
          <Card key={projectId}>
            <CardHeader>
              <CardTitle>{group.project_no}</CardTitle>
              <p className="text-sm text-muted-foreground">{group.customer_name}</p>
              <CardAction>
                <Button size="sm" disabled={!selectedCount || busy}
                  onClick={() => createIndent(Number(projectId), group.rows)}>
                  Create Material Indent{selectedCount ? ` (${selectedCount})` : ''}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {group.rows.map(r => {
                const key = rowKey(r);
                const remaining = remainingQty(r);
                const unclear = !r.required_qty;
                const alreadyFull = !unclear && remaining <= 0;
                const disabled = unclear || alreadyFull;
                return (
                  <label key={key}
                    className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${disabled ? '' : 'border-l-2 border-l-info'} ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
                    <Checkbox checked={selected.has(key)} onCheckedChange={() => toggle(key)}
                      disabled={disabled} className="mt-0.5" />
                    <div className="flex flex-1 flex-col">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.material_description}</span>
                        {r.size_spec && <span className="text-xs text-muted-foreground">· {r.size_spec}</span>}
                        {r.unit_project_no && <Badge variant="outline" className="text-[10px]">Unit {r.unit_project_no}</Badge>}
                      </div>
                      <span className="text-xs text-muted-foreground tnum">
                        {r.catalog_item_code ? `${r.catalog_item_code} · ` : ''}
                        {r.moc ? `${r.moc} · ` : ''}
                        {r.piece ? `Piece ${r.piece.code}${r.piece.heat_no ? ` (heat ${r.piece.heat_no})` : ''}` : null}
                      </span>
                      {unclear ? (
                        <span className="text-xs text-warning">Required qty unclear — raise from the BOM tab instead</span>
                      ) : (
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground tnum">
                          <span>Required <span className="font-medium text-foreground">{r.required_qty} {unitSuffix(r.qty_text)}</span></span>
                          <span>Already indented <span className="font-medium text-foreground">{r.already_indented_open + r.already_indented_released}</span></span>
                          <span>Remaining <span className="font-medium text-foreground">{alreadyFull ? 'Fully indented' : remaining}</span></span>
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// The quantity a NEW indent line should ask for — the still-uncovered remainder, never the full
// requirement again. Getting this wrong would let Production silently re-request material Stores
// already released via an earlier indent.
function remainingQty(r) {
  if (!r.required_qty) return 0;
  return Math.max(0, r.required_qty - (r.already_indented_open + r.already_indented_released));
}
