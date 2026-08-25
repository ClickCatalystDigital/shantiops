'use client';

// Engineering (and Design, 2026-08-25) Bill of Materials panel: the shared BOM table (full column
// set), PMB .xlsx import with preview, CSV import (same 3-column shape as the paste flow, just from
// a file instead of a textarea — reuses the same POST /bom endpoint, no new route needed),
// import/revision history with original-file downloads, and the original paste flow kept as a
// fallback for non-Excel BOMs. Generating a packing list from the BOM stays a Dispatch action
// (PackingPanel).
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import BomTable from './BomTable';
import BomImport from './BomImport';

const CSV_FORMAT_HINT = 'material_description, moc, size_spec';
const CSV_SAMPLE = 'material_description,moc,size_spec\nControl Panel,CS,As per drawing\nID Fan with Motor,MS,CFM:3000 · 5 HP\n';

function parseBom(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [material_description, moc, size_spec] = line.split(/\t|,/).map(x => x?.trim());
    return { material_description, moc, size_spec };
  }).filter(r => r.material_description && r.material_description.toLowerCase() !== 'material_description');
}

function downloadCsvTemplate() {
  const url = URL.createObjectURL(new Blob([CSV_SAMPLE], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bom-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function BomPanel({ projectId, bom, pending, canUpload, editableFields = [], imports = [], canCancel = false, assemblies = [], department = 'Engineering' }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const csvRef = useRef(null);

  async function submitRows(rows) {
    if (!rows.length) return showToast('No BOM rows found', 'error');
    setBusy(true);
    try {
      const { inserted } = await api(`/api/projects/${projectId}/bom`, { method: 'POST', body: { rows } });
      showToast(`${inserted} BOM line${inserted !== 1 ? 's' : ''} added`);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function uploadPaste(e) {
    e.preventDefault();
    await submitRows(parseBom(text));
    setText('');
  }

  async function pickCsv(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    await submitRows(parseBom(await f.text()));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bill of Materials</CardTitle>
        {canUpload && (
          <CardAction className="flex items-center gap-2">
            {/* STERP item 16, §5o — assemblies are built/browsed on the Engineering workspace;
                items are assigned to one from this table's Edit dialog (Assembly field below). */}
            <a href="/engineering?tab=structure" className="text-sm text-primary hover:underline">Manage assemblies</a>
            <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={pickCsv} />
            <Button variant="outline" disabled={busy} onClick={() => csvRef.current?.click()}>
              {busy ? 'Reading…' : 'Import CSV'}
            </Button>
            <BomImport projectId={projectId} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {bom.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No BOM yet — import the project's PMB workbook (.xlsx), import a CSV, or paste rows below.
          </p>
        ) : (
          <BomTable projectId={projectId} bom={bom} pendingIds={pending.map(p => p.id)}
            editableFields={editableFields} department={department} canCancel={canCancel} assemblies={assemblies} />
        )}

        {imports.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Import history</span>
            {imports.map(imp => (
              <div key={imp.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground">
                <span className="tnum">Rev {imp.revision}</span>
                <a href={`/api/bom-imports/${imp.id}/file`} className="text-primary hover:underline">{imp.filename}</a>
                <span className="text-xs">{formatDate(imp.created_at)} · by {imp.imported_by}</span>
              </div>
            ))}
          </div>
        )}

        {canUpload && (
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">Paste rows instead</summary>
            <form onSubmit={uploadPaste} className="mt-2 flex flex-col gap-2">
              <Label>One item per line: Description, MOC, Size/Spec</Label>
              <Textarea rows={4} value={text} onChange={e => setText(e.target.value)}
                placeholder={'Control Panel, CS, As per drawing\nID Fan with Motor, MS, CFM:3000 · 5 HP'} />
              <div><Button disabled={busy}>{busy ? 'Adding…' : 'Add rows'}</Button></div>
            </form>
            <p className="mt-3 text-xs text-muted-foreground">
              CSV format: <code className="rounded bg-muted px-1 py-0.5">{CSV_FORMAT_HINT}</code> — one row per
              line, comma-separated. A header row matching the column names is fine and gets skipped automatically.{' '}
              <button type="button" onClick={downloadCsvTemplate} className="text-primary hover:underline">
                Download a sample CSV
              </button>
            </p>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
