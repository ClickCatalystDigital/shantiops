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
import SearchableSelect from '@/components/SearchableSelect';
import { CATEGORY_LABEL } from '@/lib/section-shapes';
import { FileSpreadsheetIcon } from 'lucide-react';

const CATEGORY_PREVIEW_OPTIONS = [
  { value: '', label: 'Uncategorized' },
  ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label })),
];

export default function BomImport({ projectId, format = 'xlsx', onImported }) {
  const router = useRouter();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  // Sparse — only rows the user actually overrides from parsePmb's own best-effort inference.
  // Keyed "sheetIndex-itemIndex", matching the server's own indexing on confirm.
  const [categoryOverrides, setCategoryOverrides] = useState({});
  // Datasheet rows (TYPE / FLOW cfm…) are imported as the node's Configuration by default; "Treat as item"
  // sends one back to an ordinary BOM item. Sparse, keyed "sheetIndex-c<i>" against the preview's config list.
  const [configOverrides, setConfigOverrides] = useState({});
  const asItemCount = Object.values(configOverrides).filter(v => v === 'item').length;
  const accept = format === 'csv' ? '.csv' : '.xlsx';
  const label = format === 'csv' ? 'Import CSV' : 'Upload PMB';

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
      setCategoryOverrides({});
      setConfigOverrides({});
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
      if (Object.keys(categoryOverrides).length) fd.append('categoryOverrides', JSON.stringify(categoryOverrides));
      if (asItemCount) fd.append('configOverrides', JSON.stringify(configOverrides));
      const res = await api(`/api/projects/${projectId}/bom/import`, { method: 'POST', body: fd });
      const cfgCount = (res.tree?.configsAdded || 0) + (res.tree?.configsUpdated || 0);
      showToast(`Imported ${res.inserted} items (revision ${res.revision})`
        + (cfgCount ? ` and ${cfgCount} configuration row${cfgCount === 1 ? '' : 's'}` : '')
        + (res.learned ? ` — learned ${res.learned} spelling correction${res.learned === 1 ? '' : 's'} for next time` : ''));
      setPreview(null);
      setFile(null);
      setCategoryOverrides({});
      setConfigOverrides({});
      router.refresh();
      onImported?.(res);
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  const replacing = preview?.existingItems > 0;

  return (
    <>
      <input ref={fileRef} type="file" accept={accept} className="hidden" onChange={pick} />
      {format === 'csv' ? (
        <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy && !preview ? 'Reading…' : label}
        </Button>
      ) : (
        // Excel-brand green (#217346) — a real, deliberate solid accent for the one destructive-
        // adjacent action on this toolbar, sized to match the neighboring Released/Draft toggle.
        <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}
          className="border-transparent bg-[#217346] text-white hover:bg-[#1a5c38]">
          <FileSpreadsheetIcon data-icon="inline-start" />
          {busy && !preview ? 'Reading…' : label}
        </Button>
      )}

      <Dialog open={!!preview} onOpenChange={o => !o && setPreview(null)}>
        <DialogContent className="max-h-[85vh] sm:max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import preview — {preview?.filename}</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="flex flex-col gap-4 text-sm">
              <p className="text-muted-foreground">
                {preview.totalItems + asItemCount} items detected across {preview.sheets.length} sheets
                {preview.totalConfigs - asItemCount > 0 && <> · <span className="font-medium text-foreground">{preview.totalConfigs - asItemCount} datasheet row{preview.totalConfigs - asItemCount === 1 ? '' : 's'} → saved as configuration</span></>}
                {preview.totalSkipped > 0 && <> · <span className="text-warning font-medium">{preview.totalSkipped} rows skipped</span></>}
              </p>

              {preview.sheets.map((s, sheetIndex) => {
                const uncategorized = s.items?.filter(i => !i.category).length || 0;
                return (
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
                  {s.items?.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Review categories ({s.items.length - uncategorized} guessed
                        {uncategorized > 0 && <>, {uncategorized} uncategorized</>}) — best-effort,
                        edit anything wrong before importing
                      </summary>
                      <div className="mt-2 flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
                        {s.items.map((it, itemIndex) => {
                          const key = `${sheetIndex}-${itemIndex}`;
                          const value = Object.prototype.hasOwnProperty.call(categoryOverrides, key)
                            ? categoryOverrides[key] : (it.category || '');
                          const suggestion = it.category_suggestion;
                          // Only worth showing while the line is still genuinely unresolved — once
                          // the reviewer has picked anything (including the suggested category
                          // itself), the hint just repeats what the dropdown already says.
                          const showSuggestion = suggestion && !value;
                          return (
                            <div key={itemIndex} className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className="flex-1 truncate text-xs" title={it.material_description}>{it.material_description}</span>
                                <SearchableSelect className="w-40 shrink-0" value={value}
                                  options={CATEGORY_PREVIEW_OPTIONS}
                                  onChange={v => setCategoryOverrides(prev => ({ ...prev, [key]: v }))} />
                              </div>
                              {showSuggestion && (
                                <p className="text-xs text-warning">
                                  Did you mean <strong>{suggestion.suggestedWord}</strong> (typed "{suggestion.word}")?{' '}
                                  <button type="button" className="underline"
                                    onClick={() => setCategoryOverrides(prev => ({ ...prev, [key]: suggestion.category }))}>
                                    Yes, mark as {CATEGORY_LABEL[suggestion.category] || suggestion.category}
                                  </button>
                                  {' '}— confirming this once teaches the system, so it won't ask again.
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  )}
                  {s.configs?.length > 0 && (
                    <details className="mt-1" open>
                      <summary className="cursor-pointer text-xs font-medium">
                        Configuration ({s.configs.length}) — datasheet fields saved on the subsystem, not as BOM items
                      </summary>
                      <div className="mt-2 flex max-h-56 flex-col divide-y overflow-y-auto rounded-md border pr-1">
                        {s.configs.map((c, ci) => {
                          const key = `${sheetIndex}-c${ci}`;
                          const asItem = configOverrides[key] === 'item';
                          return (
                            <div key={ci} className={`flex items-center gap-2 px-2 py-1 text-xs ${asItem ? 'bg-warning/5' : ''}`}>
                              <span className="w-1/3 shrink-0 truncate text-muted-foreground" title={c.group_label || s.name}>{c.group_label || s.name}</span>
                              <span className="w-1/4 shrink-0 truncate font-medium" title={c.label}>{c.label}</span>
                              <span className="flex-1 truncate" title={c.value}>{c.value || <em className="text-muted-foreground">blank — fill in later</em>}</span>
                              <label className="flex shrink-0 items-center gap-1 text-muted-foreground">
                                <input type="checkbox" checked={asItem}
                                  onChange={e => setConfigOverrides(prev => {
                                    const next = { ...prev };
                                    if (e.target.checked) next[key] = 'item'; else delete next[key];
                                    return next;
                                  })} />
                                Treat as item
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </details>
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
                );
              })}

              {replacing && (
                <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-danger">
                  This project already has {preview.existingItems} PMB-imported BOM item{preview.existingItems === 1 ? '' : 's'}.
                  Importing will <strong>replace</strong> {preview.existingItems - preview.blockedCount} of them, including any in-app edits.
                  {preview.blockedCount > 0 && (
                    <> {preview.blockedCount} of them already {preview.blockedCount === 1 ? 'has' : 'have'} real activity logged against
                    {preview.blockedCount === 1 ? ' it' : ' them'} elsewhere (a quote, an order, a packing list, a QC record, etc.) and will be kept as-is.</>
                  )}
                  {preview.preservedCount > 0 && (
                    <> {preview.preservedCount} other item{preview.preservedCount === 1 ? '' : 's'} (raised via PR or added manually) will also be kept.</>
                  )}
                </p>
              )}

              <DialogFooter>
                <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
                <Button variant={replacing ? 'destructive' : 'default'} disabled={busy} onClick={confirm}>
                  {busy ? 'Importing…' : replacing ? `Replace BOM with ${preview.totalItems + asItemCount} items` : `Import ${preview.totalItems + asItemCount} items`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
