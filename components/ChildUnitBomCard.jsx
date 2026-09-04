'use client';

// components/ChildUnitBomCard.jsx — Multi-unit BOM split, Phase 3 (MULTI-UNIT-SPLIT-DESIGN.md §5.1).
// A read-only card shown only on a child project's own page — the derived "what this one physical
// unit needs" view, computed live server-side (GET /api/projects/[id]/child-bom), never a clone of
// the master's own bom_items. Department-agnostic: any internal user viewing this child sees it,
// since QC/Production/Dispatch all need to know what belongs to this specific unit (§4 of the design
// doc — this is exactly the gap children didn't have any answer for before Phase 3).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default function ChildUnitBomCard({ projectId, unitNo }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/child-bom`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setData(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          This unit's material list
          {unitNo != null && <Badge variant="outline" className="font-normal">Unit {unitNo}</Badge>}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Derived live from the master BOM{data?.masterProjectNo && (
            <> on <Link href={`/projects/${data.masterProjectId}`} className="underline">{data.masterProjectNo}</Link></>
          )} — read-only. Procurement and Stores are handled at the master level, not per unit.
        </p>
      </CardHeader>
      <CardContent>
        {!data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !data.items?.length ? (
          <p className="text-sm text-muted-foreground">The master BOM has no items yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>MOC / Spec</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Qty for this unit</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map(it => (
                  <TableRow key={it.id}>
                    <TableCell className="max-w-xs truncate">
                      {it.material_description}
                      {it.catalog_item_code && (
                        <span className="ml-1 text-xs text-muted-foreground">({it.catalog_item_code})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{it.moc || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{it.size_spec || '—'}</TableCell>
                    <TableCell>{it.per_unit_qty ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {it.ready
                        ? (it.routed_to ? `→ ${it.routed_to}` : 'Ready — awaiting routing')
                        : (it.allocated_qty > 0 ? `${it.allocated_qty}/${it.per_unit_qty ?? '—'} allocated` : '—')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
