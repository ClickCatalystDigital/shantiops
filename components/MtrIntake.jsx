'use client';

// QC → Test Certificates → Batch upload (docs/gulf-coast-asme-plan.md, Phase 1b). Drop many MTR PDFs: each is
// uploaded on its own (a duplicate file is caught by its hash), then read by the model two at a time. Every
// file waits in the queue until a person reviews its heats next to the PDF and accepts or rejects it.
// Rows keep their state, so a closed tab just means pressing "Read waiting files" later.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { lineProblems } from '@/lib/mtr-extract.mjs';
import PdfPreview from './PdfPreview';
import SearchableSelect from './SearchableSelect';
import { Card, CardHeader, CardTitle, CardContent, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { UploadIcon, PlusIcon, Trash2Icon } from 'lucide-react';

const STATUS = {
  uploaded: ['Waiting to be read', 'outline'], extracted: ['Ready to review', 'default'], failed: ['Could not read', 'destructive'],
  not_mtr: ['Not an MTR', 'secondary'], duplicate: ['Duplicate', 'secondary'], accepted: ['Accepted', 'secondary'], rejected: ['Rejected', 'secondary'],
};
const LINE_FIELDS = [['heat_no', 'Heat'], ['plate_no', 'Plate / piece'], ['material_spec', 'Spec'], ['chem_c', 'C'], ['chem_mn', 'Mn'],
  ['chem_p', 'P'], ['chem_s', 'S'], ['chem_si', 'Si'], ['ys', 'Yield'], ['uts', 'Tensile'], ['strength_unit', 'Unit'], ['elongation', 'Elong. %']];

export default function MtrIntake({ projects = [], defaultProjectId = null }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [review, setReview] = useState(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const load = useCallback(() => api('/api/mtr-intake').then(setRows).catch(e => showToast(e.message, 'error')), []);
  useEffect(() => { load(); }, [load]);

  async function readAll(ids) {
    const queue = [...ids];
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        try { await api(`/api/mtr-intake/${id}/extract`, { method: 'POST' }); } catch (e) { showToast(e.message, 'error'); }
        setBusy(`Reading ${++done} of ${ids.length}…`);
        load();
      }
    };
    await Promise.all([worker(), worker()]);
  }

  async function upload(files) {
    const pdfs = [...files].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!pdfs.length) return showToast('Pick PDF files', 'error');
    const fresh = [];
    for (const [i, f] of pdfs.entries()) {
      setBusy(`Uploading ${i + 1} of ${pdfs.length}…`);
      const fd = new FormData(); fd.append('file', f);
      try { const r = await api('/api/mtr-intake', { method: 'POST', body: fd }); if (r.status === 'uploaded') fresh.push(r.id); }
      catch (e) { showToast(`${f.name}: ${e.message}`, 'error'); }
    }
    await load();
    if (fresh.length) await readAll(fresh);
    setBusy('');
    const dupes = pdfs.length - fresh.length;
    showToast(`${fresh.length} uploaded${dupes ? `, ${dupes} duplicate or refused` : ''}`);
  }

  async function reject(r) {
    const reason = window.prompt(`Reject ${r.file_name}? Reason (optional):`, '');
    if (reason === null) return;
    try { await api(`/api/mtr-intake/${r.id}`, { method: 'PATCH', body: { action: 'reject', reason } }); load(); } catch (e) { showToast(e.message, 'error'); }
  }

  const waiting = (rows || []).filter(r => r.status === 'uploaded').map(r => r.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Batch MTR upload</CardTitle>
        <CardAction className="flex gap-2">
          {waiting.length > 0 && <Button size="sm" variant="outline" disabled={!!busy} onClick={async () => { await readAll(waiting); setBusy(''); }}>Read waiting files ({waiting.length})</Button>}
          <Button size="sm" disabled={!!busy} onClick={() => inputRef.current?.click()}><UploadIcon /> Upload PDFs</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={e => { upload(e.target.files); e.target.value = ''; }} />
        <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          className={`rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground ${drag ? 'border-primary bg-primary/5' : ''}`}>
          {busy || 'Drop mill test report PDFs here. Several at once is fine; each heat is checked by a person before it reaches the certificate bank.'}
        </div>
        {!rows ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? null : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5">File</th><th>Status</th><th>Uploaded</th><th /></tr></thead>
            <tbody>{rows.map(r => {
              const [label, variant] = STATUS[r.status] || [r.status, 'outline'];
              return (
                <tr key={r.id} className="border-t align-top">
                  <td className="py-2 pr-2">{r.file_name}
                    {r.status === 'duplicate' && <div className="text-xs text-muted-foreground">Same file as {r.duplicate_cert_no ? `certificate ${r.duplicate_cert_no}` : r.duplicate_of_name}</div>}
                    {['failed', 'not_mtr', 'rejected'].includes(r.status) && r.error && <div className="text-xs text-muted-foreground">{r.error}</div>}
                    {r.status === 'accepted' && <div className="text-xs text-muted-foreground">{r.certificates} certificate{r.certificates === 1 ? '' : 's'} added</div>}
                  </td>
                  <td><Badge variant={variant}>{label}</Badge></td>
                  <td className="text-xs text-muted-foreground">{formatDate(String(r.uploaded_at).slice(0, 10))} · {r.uploaded_by}</td>
                  <td className="whitespace-nowrap text-right">
                    {['extracted', 'failed', 'not_mtr', 'uploaded'].includes(r.status) && <Button size="xs" onClick={() => setReview(r)}>Review</Button>}
                    {['failed', 'uploaded'].includes(r.status) && <Button size="xs" variant="ghost" disabled={!!busy} onClick={async () => { await readAll([r.id]); setBusy(''); }}>Read again</Button>}
                    {!['accepted', 'rejected', 'duplicate'].includes(r.status) && <Button size="xs" variant="ghost" onClick={() => reject(r)}>Reject</Button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </CardContent>
      {review && <ReviewDialog row={review} projects={projects} defaultProjectId={defaultProjectId}
        onClose={() => setReview(null)} onDone={() => { setReview(null); load(); }} />}
    </Card>
  );
}

function ReviewDialog({ row, projects, defaultProjectId, onClose, onDone }) {
  const [d, setD] = useState(null);
  const [header, setHeader] = useState({ certificate_no: '', steel_maker: '', certificate_date: '', material_spec: '' });
  const [lines, setLines] = useState([]);
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/api/mtr-intake/${row.id}`).then(x => {
      setD(x);
      const e = x.extracted;
      setHeader({ certificate_no: e?.header?.certificate_no || '', steel_maker: e?.header?.steel_maker || '', certificate_date: e?.header?.certificate_date || '', material_spec: e?.header?.material_spec || '' });
      setLines(e?.lines?.length ? e.lines : [{ heat_no: '' }]);
    }).catch(e => showToast(e.message, 'error'));
  }, [row.id]);
  const setLine = (i, k, v) => setLines(xs => xs.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const problems = lines.map(l => lineProblems(header, l));
  const blocked = problems.some(p => p.length);
  const conf = d?.extracted?.confidence;

  async function accept() {
    setBusy(true);
    try {
      const r = await api(`/api/mtr-intake/${row.id}/accept`, { method: 'POST', body: { header, lines, project_ids: projectId ? [projectId] : [] } });
      showToast(`${r.certificate_ids.length} certificate${r.certificate_ids.length === 1 ? '' : 's'} added to the bank`); onDone();
    } catch (e) { showToast(e.message, 'error'); setBusy(false); }
  }
  const h = (k, l, props = {}) => <div className="flex flex-col gap-1"><Label>{l}</Label><Input value={header[k] || ''} onChange={e => setHeader({ ...header, [k]: e.target.value })} {...props} /></div>;

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-7xl">
        <DialogHeader><DialogTitle>Review {row.file_name}</DialogTitle></DialogHeader>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-[70vh] overflow-hidden rounded-md border">
            <PdfPreview inline open url={`/api/mtr-intake/${row.id}/pdf`} title={row.file_name} />
          </div>
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-auto pr-1">
            {!d ? <p className="text-sm text-muted-foreground">Loading…</p> : <>
              {d.status === 'failed' && <p className="rounded-md bg-destructive/10 p-2 text-xs">The file could not be read automatically ({d.error}). Type the heats from the PDF.</p>}
              {d.status === 'not_mtr' && <p className="rounded-md bg-muted p-2 text-xs">This looks like it is not a material test report. Reject it, or type the heats if it is.</p>}
              {conf != null && conf < 0.7 && <p className="rounded-md bg-amber-500/10 p-2 text-xs">The reader was not sure of these values ({Math.round(conf * 100)}%). Check every number against the PDF.</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {h('certificate_no', 'Certificate no.')}{h('steel_maker', 'Mill')}
                {h('material_spec', 'Material spec')}{h('certificate_date', 'Date', { type: 'date' })}
              </div>
              {lines.map((l, i) => (
                <div key={i} className="rounded-md border p-2">
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium">Heat {i + 1}
                    {problems[i].length > 0 && <span className="text-destructive">needs {problems[i].join(', ')}</span>}
                    <Button size="icon-xs" variant="ghost" className="ml-auto" title="Remove" onClick={() => setLines(xs => xs.filter((_, j) => j !== i))}><Trash2Icon /></Button>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                    {LINE_FIELDS.map(([k, lab]) => (
                      <label key={k} className="flex flex-col text-[11px] text-muted-foreground">{lab}
                        <input className="h-7 rounded border bg-transparent px-1 text-xs text-foreground" value={l[k] || ''} onChange={e => setLine(i, k, e.target.value)} />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <Button size="sm" variant="outline" className="self-start" onClick={() => setLines(xs => [...xs, { heat_no: '', material_spec: header.material_spec }])}><PlusIcon /> Heat</Button>
              <div className="flex flex-col gap-1"><Label>Link to project (optional)</Label>
                <SearchableSelect options={[{ value: null, label: 'No project yet' }, ...projects.map(p => ({ value: p.id, label: `${p.project_no} · ${p.customer_name || ''}` }))]}
                  value={projectId} onChange={setProjectId} placeholder="Search projects…" />
              </div>
              <p className="text-xs text-muted-foreground">Strength values are saved with the unit printed on the report; nothing is converted.</p>
            </>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button disabled={busy || !d || blocked || !lines.length} onClick={accept}>Accept {lines.length} heat{lines.length === 1 ? '' : 's'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
