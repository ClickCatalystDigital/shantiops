'use client';

// Design → Drawings → "Customer uploads". Drawings a customer sent from the portal: open/download,
// then mark Reviewed or Needs changes (the customer sees the note). The Design Head can delete.
import { useEffect, useState } from 'react';
import { FileTextIcon, ImageIcon, Trash2Icon, DownloadIcon, CheckIcon, MessageSquareWarningIcon } from 'lucide-react';
import { api, showToast, formatDate } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { UploadStatusPill, fileSize } from '@/components/CustomerDrawingStatus';

export default function CustomerDrawingUploads({ projectId, canDelete }) {
  const [rows, setRows] = useState(null);
  const [review, setReview] = useState(null); // { row, status }
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api(`/api/customer-drawings?project_id=${projectId}`).then(d => setRows(d.uploads)).catch(e => showToast(e.message, 'error'));
  useEffect(() => { setRows(null); load(); }, [projectId]);

  async function submitReview() {
    setBusy(true);
    try {
      await api(`/api/customer-drawings/${review.row.id}`, { method: 'PATCH', body: { status: review.status, note } });
      showToast(review.status === 'reviewed' ? 'Marked as reviewed' : 'Customer notified');
      setReview(null); setNote(''); await load();
    } catch (e) { showToast(e.message, 'error'); }
    setBusy(false);
  }

  async function remove(row) {
    if (!window.confirm(`Delete "${row.label}"? The file is removed from storage too.`)) return;
    try { await api(`/api/customer-drawings/${row.id}`, { method: 'DELETE' }); await load(); }
    catch (e) { showToast(e.message, 'error'); }
  }

  if (!rows || rows.length === 0) return null; // nothing from the customer yet — stay out of the way
  const pending = rows.filter(r => r.status === 'submitted').length;
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Customer uploads {pending > 0 && <Badge>{pending} new</Badge>}</CardTitle>
          <CardDescription>Drawings the customer sent from their portal — review each one.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {rows.map(r => {
            const Icon = r.mime?.startsWith('image/') ? ImageIcon : FileTextIcon;
            return (
              <div key={r.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-3">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <a href={`/api/customer-drawings/${r.id}/file`} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">{r.label}</a>
                    <p className="truncate text-xs text-muted-foreground">{r.file_name} · {fileSize(r.file_size)} · {r.uploaded_by_name || 'Customer'} · {formatDate(r.created_at)}</p>
                  </div>
                  <UploadStatusPill status={r.status} />
                  <div className="flex shrink-0 items-center gap-1">
                    <Button asChild variant="ghost" size="icon-sm" aria-label="Download"><a href={`/api/customer-drawings/${r.id}/file?download=1`}><DownloadIcon /></a></Button>
                    <Button variant="outline" size="sm" onClick={() => { setReview({ row: r, status: 'reviewed' }); setNote(r.review_note || ''); }}><CheckIcon data-icon="inline-start" />Reviewed</Button>
                    <Button variant="outline" size="sm" onClick={() => { setReview({ row: r, status: 'needs_changes' }); setNote(r.status === 'needs_changes' ? r.review_note || '' : ''); }}><MessageSquareWarningIcon data-icon="inline-start" />Needs changes</Button>
                    {canDelete && <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => remove(r)}><Trash2Icon /></Button>}
                  </div>
                </div>
                {r.review_note && <p className="ml-7 text-xs text-muted-foreground"><span className="font-medium text-foreground">{r.reviewed_by}:</span> {r.review_note}</p>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={!!review} onOpenChange={o => !o && setReview(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{review?.status === 'reviewed' ? 'Mark as reviewed' : 'Needs changes'} — {review?.row.label}</DialogTitle></DialogHeader>
          <Textarea value={note} onChange={e => setNote(e.target.value)} className="min-h-24"
            placeholder={review?.status === 'reviewed' ? 'Optional note for the customer' : 'Tell the customer what to change (required)'} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(null)}>Cancel</Button>
            <Button disabled={busy || (review?.status === 'needs_changes' && !note.trim())} onClick={submitReview}>Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
