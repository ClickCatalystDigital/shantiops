'use client';

// PMB (.xlsx) or CSV upload (format prop picks which; both post to the same route — parsePmb
// autodetects the file's actual format) with a mandatory human preview: the file is parsed
// server-side and nothing is written until the user has seen what was detected (per-sheet counts,
// unmapped columns, skipped rows) and confirms. Replace is explicit and destructive-styled. The
// same File object is re-posted to confirm — no draft state on the server.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function BomImport({ projectId, format = 'xlsx' }) {
  const router = useRouter();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const accept = format === 'csv' ? '.csv' : '.xlsx';
  const label = format === 'csv' ? 'Import CSV' : 'Import PMB (.xlsx)';

  async function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const { preview } = await api(`/api/projects/${projectId}/bom/import`, { method: 'POST', body: fd });
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
      if (preview.existingItems > 0) fd.append('replace', '1');
      const res = await api(`/api/projects/${projectId}/bom/import`, { method: 'POST', body: fd });
      showToast(`Imported ${res.inserted} items (revision ${res.revision})`);
      setPreview(null);
      setFile(null);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  const replacing = preview?.existingItems > 0;

  return (
    <>
      <input ref={fileRef} type="file" accept={accept} className="hidden" onChange={pick} />
      <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy && !preview ? 'Reading…' : label}
      </Button>

      <Dialog open={!!preview} onOpenChange={o => !o && setPreview(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import preview — {preview?.filename}</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="flex flex-col gap-4 text-sm">
              <p className="text-muted-foreground">
                {preview.totalItems} items detected across {preview.sheets.length} sheets
                {preview.totalSkipped > 0 && <> · <span className="text-warning font-medium">{preview.totalSkipped} rows skipped</span></>}
              </p>

              {preview.sheets.map(s => (
                <div key={s.name} className="rounded-md border p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{s.name}</span>
                    <span className="text-xs text-muted-foreground tnum">
                      {s.error ? s.error : `${s.itemCount} items`}
                    </span>
                  </div>
                  {s.unmappedColumns?.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Ignored columns: {s.unmappedColumns.join(' · ')}
                    </p>
                  )}
                  {s.sample?.length > 0 && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      e.g. {s.sample.map(i => i.material_description).slice(0, 3).join(' · ')}
                    </p>
                  )}
                  {s.skipped?.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-warning">
                        {s.skipped.length} skipped row{s.skipped.length !== 1 ? 's' : ''} — review
                      </summary>
                      <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                        {s.skipped.map(sk => (
                          <li key={sk.row}>Row {sk.row} ({sk.reason}): {Object.values(sk.cells).join(' | ').slice(0, 90)}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}

              {replacing && (
                <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-danger">
                  This project already has {preview.existingItems} BOM items
                  {preview.packedCount > 0 && <>, {preview.packedCount} of them already on packing lists — their links will be lost</>}.
                  Importing will <strong>replace the entire BOM</strong>, including any in-app edits.
                </p>
              )}

              <DialogFooter>
                <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
                <Button variant={replacing ? 'destructive' : 'default'} disabled={busy} onClick={confirm}>
                  {busy ? 'Importing…' : replacing ? `Replace BOM with ${preview.totalItems} items` : `Import ${preview.totalItems} items`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
