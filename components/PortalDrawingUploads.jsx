'use client';

// Portal → Design & Engineering → "Your drawings". The customer sends a drawing or sketch (PDF or
// image) with a label; Design reviews it. Files are stored in R2 and deleted with the row.
import { useState, useRef } from 'react';
import { UploadCloudIcon, FileTextIcon, ImageIcon, Trash2Icon, XIcon } from 'lucide-react';
import { api, showToast, formatDate } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadStatusPill, fileSize } from '@/components/CustomerDrawingStatus';
import { cn } from '@/lib/utils';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';

export default function PortalDrawingUploads({ projectId, initial = [], readOnly = false }) {
  const [rows, setRows] = useState(initial);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);

  const reload = async () => setRows((await api(`/api/customer-drawings?project_id=${projectId}`)).uploads);

  async function upload() {
    if (!label.trim()) return showToast('Add a label for this drawing', 'error');
    if (!file) return showToast('Choose a file first', 'error');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('project_id', projectId); fd.append('label', label.trim()); fd.append('file', file);
      await api('/api/customer-drawings', { method: 'POST', body: fd });
      showToast('Drawing sent to our design team');
      setLabel(''); setFile(null); if (inputRef.current) inputRef.current.value = '';
      await reload();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function remove(id) {
    if (!window.confirm('Remove this drawing?')) return;
    try { await api(`/api/customer-drawings/${id}`, { method: 'DELETE' }); await reload(); }
    catch (err) { showToast(err.message, 'error'); }
  }

  if (readOnly && rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">Your drawings</p>
        {!readOnly && <p className="text-xs text-muted-foreground">Share a drawing or sketch with our design team — PDF, PNG, JPG or WebP, up to 15 MB.</p>}
      </div>

      {rows.length > 0 && (
        <ul className="flex flex-col divide-y rounded-xl border">
          {rows.map(r => {
            const isImage = r.mime?.startsWith('image/');
            const Icon = isImage ? ImageIcon : FileTextIcon;
            return (
              <li key={r.id} className="flex flex-col gap-1.5 p-3">
                <div className="flex items-center gap-3">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <a href={`/api/customer-drawings/${r.id}/file`} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">{r.label}</a>
                    <p className="truncate text-xs text-muted-foreground">{r.file_name} · {fileSize(r.file_size)} · {formatDate(r.created_at)}</p>
                  </div>
                  <UploadStatusPill status={r.status} />
                  {!readOnly && r.status !== 'reviewed' && (
                    <button type="button" aria-label="Remove drawing" className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" onClick={() => remove(r.id)}>
                      <Trash2Icon className="size-4" />
                    </button>
                  )}
                </div>
                {r.review_note && (
                  <p className={cn('ml-7 rounded-md px-2.5 py-1.5 text-xs', r.status === 'needs_changes' ? 'bg-warning/10 text-foreground' : 'bg-muted text-muted-foreground')}>
                    <span className="font-medium">{r.reviewed_by || 'Design'}:</span> {r.review_note}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <div
          onDragOver={e => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
          className={cn('flex flex-col gap-3 rounded-xl border border-dashed p-4 transition-colors', over ? 'border-primary bg-primary/5' : 'bg-muted/20')}>
          <Input value={label} onChange={e => setLabel(e.target.value)} maxLength={120} placeholder="Label — e.g. Foundation layout, Chimney position" className="bg-background" />
          <div className="flex flex-wrap items-center gap-2">
            <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
            {file ? (
              <span className="flex min-w-0 items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                <span className="truncate">{file.name}</span><span className="text-muted-foreground">{fileSize(file.size)}</span>
                <button type="button" aria-label="Clear file" onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = ''; }}><XIcon className="size-3.5" /></button>
              </span>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                <UploadCloudIcon data-icon="inline-start" />Choose file or drop it here
              </Button>
            )}
            <Button type="button" size="sm" className="ml-auto" disabled={busy || !file || !label.trim()} onClick={upload}>{busy ? 'Sending…' : 'Send to design team'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
