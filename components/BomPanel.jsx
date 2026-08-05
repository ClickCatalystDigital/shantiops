'use client';

// Engineering's Bill of Materials panel: the shared BOM table (full column set), PMB .xlsx import
// with preview, import/revision history with original-file downloads, and the original paste flow
// kept as a fallback for non-Excel BOMs. Generating a packing list from the BOM stays a Dispatch
// action (PackingPanel).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import BomTable from './BomTable';
import BomImport from './BomImport';

function parseBom(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [material_description, moc, size_spec] = line.split(/\t|,/).map(x => x?.trim());
    return { material_description, moc, size_spec };
  }).filter(r => r.material_description);
}

export default function BomPanel({ projectId, bom, pending, canUpload, editableFields = [], imports = [], canCancel = false }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function uploadPaste(e) {
    e.preventDefault();
    const rows = parseBom(text);
    if (!rows.length) return showToast('Paste at least one BOM line', 'error');
    setBusy(true);
    try {
      const { inserted } = await api(`/api/projects/${projectId}/bom`, { method: 'POST', body: { rows } });
      showToast(`${inserted} BOM line${inserted !== 1 ? 's' : ''} added`);
      setText('');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bill of Materials</CardTitle>
        {canUpload && <CardAction><BomImport projectId={projectId} /></CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {bom.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No BOM yet — import the project's PMB workbook (.xlsx) or paste rows below.
          </p>
        ) : (
          <BomTable projectId={projectId} bom={bom} pendingIds={pending.map(p => p.id)}
            editableFields={editableFields} department="Engineering" canCancel={canCancel} />
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
          </details>
        )}
      </CardContent>
    </Card>
  );
}
