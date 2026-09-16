// Project View redesign, Decision I — the common BOM reference section. Read-only, collapsed by
// default, downloadable as Excel, always the last row, present across the whole lifecycle. All
// operational editing (add/edit/delete, Cancel, Receive, Prod. Done) stays on the relevant main
// workspaces (/engineering, /stores, /production) — this is reference-only.
'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardAction, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ChevronDownIcon, DownloadIcon } from 'lucide-react';

export default function CommonBomCard({ projectId, bom = [] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-left">
          <ChevronDownIcon className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
          <CardTitle>Bill of Materials</CardTitle>
          <span className="text-xs text-muted-foreground">({bom.length} item{bom.length === 1 ? '' : 's'})</span>
        </button>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <a href={`/api/projects/${projectId}/bom/xlsx`}><DownloadIcon data-icon="inline-start" />Download Excel</a>
          </Button>
        </CardAction>
      </CardHeader>
      {open && (
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>MOC</TableHead>
                <TableHead>Size / Spec</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bom.map(b => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.material_description}</TableCell>
                  <TableCell className="text-muted-foreground">{b.moc || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{b.size_spec || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{b.qty_text || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{b.purchase_status || 'Enquiry'}</TableCell>
                </TableRow>
              ))}
              {bom.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No BOM yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}
