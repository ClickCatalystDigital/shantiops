'use client';

// components/MaterialCertificatePanel.jsx — architecture-review addition. QC's write surface for
// linking certificate(s) to specific (BOM item × child unit) allocation cells, at whole-order scale.
// Lives inside /qc's own Test Certificates tab (QcWorkspace.jsx), not a new panel on the master
// project page — reuses /qc's own existing project-scoping (whichever child is currently selected
// there resolves to its master, the "which order" context) and the existing CertPicker component.
//
// Deliberately a flat, searchable table with a plain per-row checkbox, not a per-line-then-
// checkbox-of-children widget like ChildRoutingPanel.jsx — the real requirement (a receipt/lot can
// cover many BOM items across many children in one delivery) needs selecting arbitrarily from a pool
// spanning BOTH axes at once, which a flat table represents far more directly than nesting by line
// first would.
//
// Certification is deliberately cell-level, not quantity-level: a cell can carry more than one
// certificate, but this does not record how much of that cell's allocated quantity each certificate
// covers — exact-quantity lot genealogy is a real, bigger, deferred feature (see the architecture
// review doc), not attempted here.
import { useEffect, useMemo, useState } from 'react';
import { showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchIcon, XIcon } from 'lucide-react';
import CertPicker from './CertPicker';

const cellKey = (bomItemId, childProjectId) => `${bomItemId}:${childProjectId}`;

export default function MaterialCertificatePanel({ masterProjectId, certificates = [] }) {
  const [board, setBoard] = useState(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadBoard() {
    const j = await fetch(`/api/projects/${masterProjectId}/child-routing`).then(r => r.json());
    setBoard(j);
  }

  // Keyed on masterProjectId, not the raw selected child — switching between two children of the
  // SAME master must not re-fetch, since the board is already whole-order.
  useEffect(() => {
    let cancelled = false;
    setBoard(null);
    setSelected(new Set());
    fetch(`/api/projects/${masterProjectId}/child-routing`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setBoard(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [masterProjectId]);

  const rows = useMemo(() => {
    if (!board) return [];
    const linesById = new Map(board.lines.map(l => [l.id, l]));
    const childrenById = new Map(board.children.map(c => [c.id, c]));
    return board.cells
      .map(c => ({ ...c, line: linesById.get(c.bom_item_id), child: childrenById.get(c.child_project_id) }))
      .filter(r => r.line && r.child);
  }, [board]);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter(r =>
        r.line.material_description?.toLowerCase().includes(needle) ||
        r.child.project_no?.toLowerCase().includes(needle) ||
        r.certificates.some(c => c.certificate_no?.toLowerCase().includes(needle)))
    : rows;
  const allShownSelected = shown.length > 0 && shown.every(r => selected.has(cellKey(r.bom_item_id, r.child_project_id)));

  function toggle(key) {
    setSelected(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }
  function toggleAllShown() {
    setSelected(prev => {
      const next = new Set(prev);
      shown.forEach(r => {
        const key = cellKey(r.bom_item_id, r.child_project_id);
        allShownSelected ? next.delete(key) : next.add(key);
      });
      return next;
    });
  }

  async function assign(certificateId) {
    const cells = [...selected].map(k => {
      const [bom_item_id, child_project_id] = k.split(':').map(Number);
      return { bom_item_id, child_project_id };
    });
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${masterProjectId}/child-routing/certificates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells, certificate_id: certificateId }),
      }).then(r => r.json().then(j => ({ ok: r.ok, ...j })));
      if (!res.ok) throw new Error(res.error || 'Failed to assign');
      const alreadyLinked = res.skipped.filter(s => s.reason === 'already_linked').length;
      const notAllocated = res.skipped.filter(s => s.reason === 'not_allocated').length;
      const notes = [];
      if (alreadyLinked) notes.push(`${alreadyLinked} already had this certificate`);
      if (notAllocated) notes.push(`${notAllocated} no longer allocated`);
      showToast(`Linked ${res.assigned} of ${cells.length}${notes.length ? ` — ${notes.join(', ')}` : ''}`);
      setSelected(new Set());
      // A not_allocated skip means the board changed under the user between load and submit —
      // refresh so that stale row drops out rather than staying to be clicked again.
      await loadBoard();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function unlink(bomItemId, childProjectId, certificateId) {
    try {
      const res = await fetch(`/api/projects/${masterProjectId}/child-routing/certificates`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bom_item_id: bomItemId, child_project_id: childProjectId, certificate_id: certificateId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to remove');
      showToast('Certificate removed');
      await loadBoard();
    } catch (err) { showToast(err.message, 'error'); }
  }

  if (!board) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Assign certificates to material
          {board.master && (
            <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-xs font-normal text-muted-foreground">
              Order {board.master.project_no} · {board.children.length} units
            </span>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Select any group of item/unit rows across this whole order and assign one certificate to
          all of them at once. A cell can carry more than one certificate.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item · unit · certificate" className="pl-8" />
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No allocated material yet.</p>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <label className="flex items-center gap-1.5">
                <Checkbox checked={allShownSelected} onCheckedChange={toggleAllShown} />
                Select all {shown.length} shown
              </label>
              <span>{shown.length} of {rows.length} allocated cells</span>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Allocated</TableHead>
                    <TableHead>Certificate(s)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No matches.</TableCell></TableRow>
                  )}
                  {shown.map(r => {
                    const key = cellKey(r.bom_item_id, r.child_project_id);
                    return (
                      <TableRow key={key}>
                        <TableCell><Checkbox checked={selected.has(key)} onCheckedChange={() => toggle(key)} /></TableCell>
                        <TableCell className="max-w-xs truncate">{r.line.material_description}</TableCell>
                        <TableCell className="text-muted-foreground">{r.child.project_no}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{r.allocated}</TableCell>
                        <TableCell>
                          {r.certificates.length ? (
                            <div className="flex flex-wrap gap-1">
                              {r.certificates.map(c => (
                                <span key={c.id} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-1.5 py-0.5 text-xs">
                                  {c.certificate_no}
                                  <button type="button" aria-label="Remove certificate"
                                    onClick={() => unlink(r.bom_item_id, r.child_project_id, c.id)}>
                                    <XIcon className="size-3 text-muted-foreground hover:text-foreground" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {selected.size > 0 && (
              <div className="flex items-center justify-between rounded-md border bg-muted/30 p-2 text-sm">
                <span>{selected.size} selected</span>
                <Button size="sm" disabled={busy} onClick={() => setPickerOpen(true)}>
                  Assign certificate to {selected.size} selected
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
      <CertPicker open={pickerOpen} onOpenChange={setPickerOpen} title="Assign certificate"
        certificates={certificates} onPick={assign} />
    </Card>
  );
}
