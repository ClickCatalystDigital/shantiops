'use client';

// QC → Data Book (docs/gulf-coast-asme-plan.md, Phase 1c). The project's table of contents with each line's state,
// live from the records: included (green), missing (red) or not applicable (grey, with a note). Preview builds the
// PDF now, stamped PRELIMINARY; Release stores a frozen copy once nothing is missing and the ITP is cleared.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { sourceLabel } from '@/lib/databook.mjs';
import { Card, CardHeader, CardTitle, CardContent, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { UploadIcon, FileDownIcon, LockIcon, XIcon } from 'lucide-react';

const STATE = { included: ['Included', 'bg-green-500/10'], missing: ['Missing', 'bg-red-500/10'], na: ['N/A', 'bg-muted'] };

export default function DataBook({ projectId = null, canWrite = false, canRelease = false }) {
  const [d, setD] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [tpl, setTpl] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const target = useRef(null);
  const load = useCallback(() => {
    if (!projectId) return setD(null);
    api(`/api/projects/${projectId}/databook`).then(setD).catch(e => showToast(e.message, 'error'));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api('/api/databook-templates').then(t => { setTemplates(t); if (t[0]) setTpl(String(t[0].id)); }).catch(() => {}); }, []);

  const put = async body => { try { await api(`/api/projects/${projectId}/databook`, { method: 'PUT', body }); load(); } catch (e) { showToast(e.message, 'error'); } };
  async function upload(file) {
    if (!file || !target.current) return;
    const fd = new FormData(); fd.append('line_key', target.current); fd.append('file', file);
    try { await api(`/api/projects/${projectId}/databook/files`, { method: 'POST', body: fd }); load(); } catch (e) { showToast(e.message, 'error'); }
  }
  async function release() {
    if (!window.confirm('Release the Data Book? The PDF is stored as it is now and never changes; later changes need a new revision.')) return;
    setBusy(true);
    try { const r = await api(`/api/projects/${projectId}/databook/release`, { method: 'POST' }); showToast(`Released revision ${r.revision} (${r.pages} pages)`); load(); }
    catch (e) { showToast(e.message, 'error'); } finally { setBusy(false); }
  }

  if (!projectId) return <Card><CardHeader><CardTitle>Data Book</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Pick a project above.</p></CardContent></Card>;
  if (!d) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>;
  if (!d.book) return (
    <Card>
      <CardHeader><CardTitle>Data Book</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {templates.length === 0 ? <p className="text-sm text-muted-foreground">No Data Book template yet.</p> : <>
          <Select value={tpl} onValueChange={setTpl}><SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
            <SelectContent>{templates.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.lines.length} lines)</SelectItem>)}</SelectContent></Select>
          {canWrite && <Button onClick={() => put({ template_id: Number(tpl) })}>Start Data Book</Button>}
        </>}
      </CardContent>
    </Card>
  );
  const ready = !d.problems.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Book <span className="ml-2 text-sm font-normal text-muted-foreground">{d.book.template_name}{d.book.form_no ? ` · ${d.book.form_no}` : ''}</span></CardTitle>
        <CardAction className="flex gap-2">
          <Button size="sm" variant="outline" asChild><a href={`/api/projects/${projectId}/databook/pdf`} target="_blank" rel="noreferrer"><FileDownIcon /> Preview</a></Button>
          {canRelease && <Button size="sm" disabled={busy || !ready} title={ready ? '' : 'Clear what is listed below first'} onClick={release}><LockIcon /> Release</Button>}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="flex gap-2 text-sm">
          <Badge variant="outline" className="bg-green-500/10">{d.included} included</Badge>
          <Badge variant="outline" className="bg-red-500/10">{d.missing} missing</Badge>
          <Badge variant="outline">{d.na} not applicable</Badge>
        </div>
        {!ready && <div className="rounded-md bg-amber-500/10 p-2 text-xs">Before release: {d.problems.slice(0, 6).join(' · ')}{d.problems.length > 6 ? ` and ${d.problems.length - 6} more` : ''}</div>}
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5">Sec.</th><th>Contents</th><th>Comes from</th><th>State</th><th /></tr></thead>
          <tbody>{d.rows.map(r => {
            const [label, cls] = STATE[r.status];
            const files = d.files.filter(f => f.line_key === r.key);
            return (
              <tr key={r.key} className={`border-t align-top ${cls}`}>
                <td className="px-1 py-2 text-xs">{r.section}</td>
                <td className="py-2">{r.label}
                  {r.status === 'na' && <div className="text-xs text-muted-foreground">{r.note}</div>}
                  {files.map(f => <div key={f.id} className="flex items-center gap-1 text-xs">
                    <a className="underline" href={`/api/projects/${projectId}/databook/files/${f.id}`} target="_blank" rel="noreferrer">{f.file_name}</a>
                    {canWrite && <button type="button" title="Remove" className="text-muted-foreground" onClick={() => api(`/api/projects/${projectId}/databook/files?file_id=${f.id}`, { method: 'DELETE' }).then(load).catch(e => showToast(e.message, 'error'))}><XIcon className="size-3" /></button>}
                  </div>)}
                </td>
                <td className="py-2 text-xs text-muted-foreground">{sourceLabel(r.source)}{r.auto ? ` · ${r.auto} record${r.auto === 1 ? '' : 's'}` : ''}</td>
                <td className="py-2 text-xs">{label}</td>
                <td className="whitespace-nowrap py-2 text-right">{canWrite && <>
                  <Button size="xs" variant="ghost" title="Upload a PDF to this line" onClick={() => { target.current = r.key; fileRef.current?.click(); }}><UploadIcon /></Button>
                  {r.status === 'na'
                    ? <Button size="xs" variant="ghost" onClick={() => put({ line_key: r.key, state: 'required' })}>Required</Button>
                    : <Button size="xs" variant="ghost" onClick={() => { const note = window.prompt(`Why does "${r.label}" not apply?`); if (note) put({ line_key: r.key, state: 'na', note }); }}>N/A</Button>}
                </>}</td>
              </tr>
            );
          })}</tbody>
        </table>
        {d.releases.length > 0 && <div className="flex flex-col gap-1 border-t pt-2 text-sm">
          <div className="text-xs font-medium uppercase text-muted-foreground">Released</div>
          {d.releases.map(r => <div key={r.id}><a className="underline" href={`/api/databook-releases/${r.id}/pdf`} target="_blank" rel="noreferrer">Revision {r.revision}</a>
            <span className="text-xs text-muted-foreground"> · {r.pages} pages · {r.released_by} · {formatDate(String(r.released_at).slice(0, 10))} · SHA-256 {r.sha256.slice(0, 12)}…</span></div>)}
        </div>}
      </CardContent>
    </Card>
  );
}
