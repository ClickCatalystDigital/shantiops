'use client';

// QC → ITP Templates: a customer's Inspection & Test Plan as data (docs/gulf-coast-asme-plan.md). A job card
// made from a template copies its points, so editing here never changes cards already made.
import { useCallback, useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Card, CardHeader, CardTitle, CardContent, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { PlusIcon, PencilIcon, Trash2Icon, ArrowUpIcon, ArrowDownIcon, UploadIcon } from 'lucide-react';
import { cleanItems } from '@/lib/itp-template.mjs';

const blank = () => ({ section: '', item_key: '', name: '', doc_code: '', point_type: 'R', requires: '', test_type: '', per_weld: 0, qc_only: 0, after_dispatch: 0 });

export default function ItpTemplates({ canEdit = false }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null); // {id?, name, revision, items}
  const [importing, setImporting] = useState(null); // [{name, revision, items, errors, existingId}]
  const load = useCallback(() => api('/api/itp-templates').then(setList).catch(e => { showToast(e.message, 'error'); setList([]); }), []);
  useEffect(() => { load(); }, [load]);

  async function open(t) {
    if (!t) return setEditing({ name: '', revision: '', items: [blank()] });
    try { setEditing(await api(`/api/itp-templates/${t.id}`)); } catch (e) { showToast(e.message, 'error'); }
  }
  async function remove(t) {
    if (!window.confirm(`Remove template "${t.name}"? Cards already made from it keep their points.`)) return;
    try { const r = await api(`/api/itp-templates/${t.id}`, { method: 'DELETE' }); showToast(r.archived ? 'Archived (cards use it)' : 'Deleted'); load(); }
    catch (e) { showToast(e.message, 'error'); }
  }

  // Import: a JSON file with {templates: [{name, revision, items: [...]}]} (also a bare array or one template).
  // Checked here with the same rules the save route uses; nothing is written until Import is clicked.
  async function readImport(file) {
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      const raw = Array.isArray(d) ? d : Array.isArray(d.templates) ? d.templates : [d];
      const ts = raw.map(t => {
        const name = String(t?.name || '').trim();
        const { items, errors } = cleanItems(Array.isArray(t?.items) ? t.items : []);
        return { name, revision: t?.revision || '', items, errors: [...(name ? [] : ['Template has no name']), ...(items.length ? [] : ['No points']), ...errors],
          existingId: (list || []).find(x => x.name === name)?.id };
      });
      if (!ts.length) throw new Error('No templates in this file');
      setImporting(ts);
    } catch (e) { showToast(`Could not read the file: ${e.message}`, 'error'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>ITP templates</CardTitle>
        {canEdit && <CardAction className="flex gap-2">
          <Button size="sm" variant="outline" asChild><label className="cursor-pointer"><UploadIcon /> Import
            <input type="file" accept=".json,application/json" className="hidden" onChange={e => { readImport(e.target.files?.[0]); e.target.value = ''; }} /></label></Button>
          <Button size="sm" onClick={() => open(null)}><PlusIcon /> New template</Button>
        </CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {list === null ? <p className="text-sm text-muted-foreground">Loading…</p>
          : list.length === 0 ? <p className="text-sm text-muted-foreground">No ITP templates yet. Add the customer’s ITP once, then start a job card from it (Job Cards → New Job Card → ITP traveler).</p>
          : list.map(t => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="font-medium">{t.name}</span>
              {t.revision && <Badge variant="outline">rev {t.revision}</Badge>}
              <span className="text-muted-foreground">{t.points} points · used by {t.cards} card{t.cards === 1 ? '' : 's'}</span>
              <div className="ml-auto flex gap-1">
                <Button size="icon-sm" variant="ghost" title={canEdit ? 'Edit' : 'View'} onClick={() => open(t)}><PencilIcon /></Button>
                {canEdit && <Button size="icon-sm" variant="ghost" title="Remove" onClick={() => remove(t)}><Trash2Icon /></Button>}
              </div>
            </div>
          ))}
      </CardContent>
      {importing && <ImportDialog ts={importing} onClose={() => setImporting(null)} onDone={() => { setImporting(null); load(); }} />}
      {editing && <TemplateEditor t={editing} canEdit={canEdit} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </Card>
  );
}

function TemplateEditor({ t, canEdit, onClose, onSaved }) {
  const [name, setName] = useState(t.name || '');
  const [revision, setRevision] = useState(t.revision || '');
  const [items, setItems] = useState(t.items?.length ? t.items.map(i => ({ ...blank(), ...i })) : [blank()]);
  const [busy, setBusy] = useState(false);
  const set = (i, k, v) => setItems(xs => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const move = (i, d) => setItems(xs => { const n = [...xs]; const j = i + d; if (j < 0 || j >= n.length) return xs; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const add = i => setItems(xs => { const n = [...xs]; n.splice(i + 1, 0, { ...blank(), section: xs[i]?.section || '' }); return n; });

  async function save() {
    setBusy(true);
    try {
      const body = { name, revision, items };
      if (t.id) await api(`/api/itp-templates/${t.id}`, { method: 'PUT', body });
      else await api('/api/itp-templates', { method: 'POST', body });
      showToast('Template saved'); onSaved();
    } catch (e) { showToast(e.message, 'error'); setBusy(false); }
  }
  const cell = 'h-7 w-full rounded border bg-transparent px-1 text-xs disabled:opacity-70';

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader><DialogTitle>{t.id ? 'ITP template' : 'New ITP template'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div className="flex flex-col gap-1"><Label>Name</Label><Input value={name} disabled={!canEdit} onChange={e => setName(e.target.value)} placeholder="e.g. Exchanger ITP" /></div>
          <div className="flex flex-col gap-1"><Label>Revision</Label><Input value={revision} disabled={!canEdit} onChange={e => setRevision(e.target.value)} /></div>
        </div>
        <p className="text-xs text-muted-foreground">
          Type: H hold (needs the customer’s authorization), W witness (notice before work), R review. Requires: earlier point numbers that must be cleared first (e.g. 4.20, 4.24).
          Test: the inspection a point needs before QC can sign (RT, VT, Hydro…); “per weld” means one passing test on every weld that lists it.
        </p>
        <div className="max-h-[55vh] overflow-auto rounded-md border">
          <table className="w-full min-w-[1000px] text-xs">
            <thead className="sticky top-0 bg-background shadow-[0_1px_0_var(--border)]">
              <tr className="text-left text-muted-foreground">
                <th className="px-1 py-1.5">Section</th><th className="w-16 px-1">Point</th><th className="px-1">Description</th><th className="w-14 px-1">Doc</th>
                <th className="w-14 px-1">Type</th><th className="w-24 px-1">Requires</th><th className="w-20 px-1">Test</th>
                <th className="w-12 px-1" title="One passing test on every weld listing this method">Per weld</th>
                <th className="w-12 px-1" title="QC signs it directly; no shop work">QC only</th>
                <th className="w-14 px-1" title="May stay open when the job ships (e.g. final data package)">After ship</th><th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {items.map((x, i) => (
                <tr key={i} className="border-t">
                  <td className="px-1 py-0.5"><input className={cell} disabled={!canEdit} value={x.section} onChange={e => set(i, 'section', e.target.value)} /></td>
                  <td className="px-1"><input className={cell} disabled={!canEdit} value={x.item_key} onChange={e => set(i, 'item_key', e.target.value)} /></td>
                  <td className="px-1"><input className={cell} disabled={!canEdit} value={x.name} onChange={e => set(i, 'name', e.target.value)} /></td>
                  <td className="px-1"><input className={cell} disabled={!canEdit} value={x.doc_code || ''} onChange={e => set(i, 'doc_code', e.target.value)} /></td>
                  <td className="px-1"><input className={cell} disabled={!canEdit} value={x.point_type || ''} onChange={e => set(i, 'point_type', e.target.value)} /></td>
                  <td className="px-1"><input className={cell} disabled={!canEdit} value={x.requires || ''} onChange={e => set(i, 'requires', e.target.value)} /></td>
                  <td className="px-1"><input className={cell} disabled={!canEdit} value={x.test_type || ''} onChange={e => set(i, 'test_type', e.target.value)} /></td>
                  {['per_weld', 'qc_only', 'after_dispatch'].map(k => (
                    <td key={k} className="px-1 text-center"><input type="checkbox" disabled={!canEdit} checked={!!x[k]} onChange={e => set(i, k, e.target.checked ? 1 : 0)} /></td>
                  ))}
                  <td className="px-1">
                    {canEdit && <div className="flex">
                      <Button size="icon-xs" variant="ghost" title="Up" onClick={() => move(i, -1)}><ArrowUpIcon /></Button>
                      <Button size="icon-xs" variant="ghost" title="Down" onClick={() => move(i, 1)}><ArrowDownIcon /></Button>
                      <Button size="icon-xs" variant="ghost" title="Add a point below" onClick={() => add(i)}><PlusIcon /></Button>
                      <Button size="icon-xs" variant="ghost" title="Remove" onClick={() => setItems(xs => xs.filter((_, j) => j !== i))}><Trash2Icon /></Button>
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">{items.length} points</span>
          <Button variant="outline" onClick={() => setItems(xs => [...xs, blank()])}><PlusIcon /> Point</Button>
          <Button disabled={busy} onClick={save}>Save template</Button>
        </DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ ts, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const blocked = ts.some(t => t.errors.length);
  async function run() {
    setBusy(true);
    try {
      for (const t of ts) {
        const body = { name: t.name, revision: t.revision, items: t.items };
        if (t.existingId) await api(`/api/itp-templates/${t.existingId}`, { method: 'PUT', body });
        else await api('/api/itp-templates', { method: 'POST', body });
      }
      showToast(`Imported ${ts.length} template${ts.length === 1 ? '' : 's'}`); onDone();
    } catch (e) { showToast(e.message, 'error'); setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Import ITP templates</DialogTitle></DialogHeader>
        <div className="flex flex-col divide-y text-sm">
          {ts.map((t, i) => (
            <div key={i} className="flex flex-col gap-1 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.name || '(no name)'}</span>
                {t.revision && <Badge variant="outline">rev {t.revision}</Badge>}
                <span className="text-muted-foreground">{t.items.length} points · {t.items.filter(x => x.point_type === 'H').length} hold · {t.items.filter(x => x.point_type === 'W').length} witness</span>
                {t.existingId && <Badge variant="secondary">replaces existing</Badge>}
              </div>
              {t.errors.map((e, j) => <p key={j} className="text-xs text-destructive">{e}</p>)}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Job cards already made from a replaced template keep their own points.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || blocked} onClick={run}>{blocked ? 'Fix the file first' : `Import ${ts.length}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
