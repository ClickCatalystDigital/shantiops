'use client';

// V2 master-data import (V2-CHANGES.md Group 3) — generic upload-preview-confirm for
// suppliers/customers/items, parameterized by `type`. Same two-phase shape as BomImport.jsx
// (parse server-side, mandatory preview, re-post the same File to confirm — no draft state), except
// every confirmed import here is always a **full replace** of the target table (client-confirmed,
// 2026-08-04): these are periodic whole-file STERP re-exports, not incremental edits.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function MasterImport({ type, label }) {
  const router = useRouter();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const { preview } = await api(`/api/masters/${type}/import`, { method: 'POST', body: fd });
      setPreview(preview);
    } catch (err) {
      showToast(err.message, 'error');
      setFile(null);
    }
    setBusy(false);
    e.target.value = ''; // allow re-picking the same file
  }

  async function confirm() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('confirm', '1');
      const res = await api(`/api/masters/${type}/import`, { method: 'POST', body: fd });
      showToast(`Imported ${res.inserted} ${label.toLowerCase()}${res.skipped ? ` (${res.skipped} rows skipped)` : ''}`);
      setPreview(null);
      setFile(null);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  const replacing = preview?.existingRows > 0;

  return (
    <>
      <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={pick} />
      <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy && !preview ? 'Reading…' : `Import ${label} (.xlsx)`}
      </Button>

      <Dialog open={!!preview} onOpenChange={o => !o && setPreview(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import preview — {preview?.filename}</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="flex flex-col gap-4 text-sm">
              <p className="text-muted-foreground">
                {preview.totalRows} rows detected (sheet "{preview.sheetName}")
                {preview.totalSkipped > 0 && <> · <span className="text-warning font-medium">{preview.totalSkipped} rows skipped</span></>}
              </p>
              <p className="text-xs text-muted-foreground">
                Columns mapped: {preview.columns.join(' · ')}
              </p>
              {preview.sample?.length > 0 && (
                <div className="rounded-md border p-2 text-xs">
                  {preview.sample.map((r, i) => (
                    <div key={i} className="truncate border-b py-1 last:border-b-0">
                      {r.name || r.item_name}
                    </div>
                  ))}
                </div>
              )}
              {replacing && (
                <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-danger">
                  This will <strong>replace all {preview.existingRows} existing {label.toLowerCase()}</strong> with
                  the {preview.totalRows} rows in this file.
                  {Object.entries(preview.dependentCounts || {}).some(([, n]) => n > 0) && (
                    <> It will also clear {Object.entries(preview.dependentCounts)
                      .filter(([, n]) => n > 0)
                      .map(([t, n]) => `${n} ${t.replace(/_/g, ' ')}`)
                      .join(' and ')} that reference them.</>
                  )}
                </p>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
                <Button variant={replacing ? 'destructive' : 'default'} disabled={busy} onClick={confirm}>
                  {busy ? 'Importing…' : replacing ? `Replace with ${preview.totalRows} rows` : `Import ${preview.totalRows} rows`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
