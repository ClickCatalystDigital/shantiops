'use client';

// QC → Inspection Plan → Data Book Templates: a customer's Data Book table of contents (docs/gulf-coast-asme-plan.md,
// Phase 1c). Each line says where its pages come from. A project's book copies the lines when it is started, so
// editing here never changes a book already started.
import { useCallback, useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Card, CardHeader, CardTitle, CardContent, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { PlusIcon, PencilIcon, CopyIcon, Trash2Icon, ArrowUpIcon, ArrowDownIcon } from 'lucide-react';
import { SOURCES, sourceLabel } from '@/lib/databook.mjs';

const INSPECTION = 'inspection';
const blank = section => ({ key: '', section: section || '', label: '', source: 'upload' });

export default function DatabookTemplates({ canEdit = false }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api('/api/databook-templates').then(setList).catch(e => { showToast(e.message, 'error'); setList([]); }), []);
  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Book templates</CardTitle>
        {canEdit && <CardAction><Button size="sm" onClick={() => setEditing({ name: '', form_no: '', lines: [blank()] })}><PlusIcon /> New template</Button></CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {list === null ? <p className="text-sm text-muted-foreground">Loading…</p>
          : list.length === 0 ? <p className="text-sm text-muted-foreground">No Data Book template yet. Add the customer’s table of contents once, then start each job’s book from it (Data Book tab).</p>
          : list.map(t => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="font-medium">{t.name}</span>
              {t.form_no && <Badge variant="outline">{t.form_no}</Badge>}
              {!!t.is_default && <Badge variant="secondary">Default</Badge>}
              <span className="text-muted-foreground">{t.lines.length} lines · used by {t.books} book{t.books === 1 ? '' : 's'}</span>
              <div className="ml-auto flex gap-1">
                <Button size="icon-sm" variant="ghost" title={canEdit ? 'Edit' : 'View'} onClick={() => setEditing(t)}><PencilIcon /></Button>
                {canEdit && <Button size="icon-sm" variant="ghost" title="Copy as a new template"
                  onClick={() => setEditing({ name: `${t.name} (copy)`, form_no: t.form_no || '', lines: t.lines })}><CopyIcon /></Button>}
              </div>
            </div>
          ))}
      </CardContent>
      {editing && <Editor t={editing} canEdit={canEdit} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </Card>
  );
}

function Editor({ t, canEdit, onClose, onSaved }) {
  const [name, setName] = useState(t.name || '');
  const [formNo, setFormNo] = useState(t.form_no || '');
  const [isDefault, setIsDefault] = useState(!!t.is_default);
  const [lines, setLines] = useState(t.lines?.length ? t.lines.map(l => ({ ...l })) : [blank()]);
  const [busy, setBusy] = useState(false);
  const set = (i, k, v) => setLines(xs => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const move = (i, d) => setLines(xs => { const n = [...xs]; const j = i + d; if (j < 0 || j >= n.length) return xs; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const add = i => setLines(xs => { const n = [...xs]; n.splice(i + 1, 0, blank(xs[i]?.section)); return n; });

  async function save() {
    setBusy(true);
    try {
      const body = { name, form_no: formNo, lines, is_default: isDefault };
      if (t.id) await api(`/api/databook-templates/${t.id}`, { method: 'PUT', body });
      else await api('/api/databook-templates', { method: 'POST', body });
      showToast('Template saved'); onSaved();
    } catch (e) { showToast(e.message, 'error'); setBusy(false); }
  }
  const cell = 'h-7 w-full rounded border bg-transparent px-1 text-xs disabled:opacity-70';

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader><DialogTitle>{t.id ? 'Data Book template' : 'New Data Book template'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
          <div className="flex flex-col gap-1"><Label>Name</Label><Input value={name} disabled={!canEdit} onChange={e => setName(e.target.value)} placeholder="e.g. Exchanger Data Book" /></div>
          <div className="flex flex-col gap-1"><Label>Form no.</Label><Input value={formNo} disabled={!canEdit} onChange={e => setFormNo(e.target.value)} placeholder="e.g. Form 106 Rev 1" /></div>
          {t.id && <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> Default</label>}
        </div>
        <p className="text-xs text-muted-foreground">
          Each line is one entry in the table of contents. “Comes from” picks the records the app fills it with; every line also accepts uploaded PDFs.
          Books already started keep their own lines.
        </p>
        <div className="max-h-[55vh] overflow-auto rounded-md border">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="sticky top-0 bg-background shadow-[0_1px_0_var(--border)]">
              <tr className="text-left text-muted-foreground">
                <th className="w-16 px-1 py-1.5">Section</th><th className="w-24 px-1" title="Short unique id, e.g. rt">Key</th>
                <th className="px-1">Contents</th><th className="w-64 px-1">Comes from</th><th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {lines.map((x, i) => {
                const insp = String(x.source).startsWith('inspection:');
                return (
                  <tr key={i} className="border-t">
                    <td className="px-1 py-0.5"><input className={cell} disabled={!canEdit} value={x.section} onChange={e => set(i, 'section', e.target.value)} /></td>
                    <td className="px-1"><input className={cell} disabled={!canEdit} value={x.key} onChange={e => set(i, 'key', e.target.value)} /></td>
                    <td className="px-1"><input className={cell} disabled={!canEdit} value={x.label} onChange={e => set(i, 'label', e.target.value)} /></td>
                    <td className="px-1">
                      {canEdit ? <div className="flex gap-1">
                        <select className={cell} value={insp ? INSPECTION : x.source}
                          onChange={e => set(i, 'source', e.target.value === INSPECTION ? 'inspection:' : e.target.value)}>
                          {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          <option value={INSPECTION}>Inspection records of one test…</option>
                        </select>
                        {insp && <input className={`${cell} w-20`} placeholder="RT" title="Test type, as recorded (RT, UT, MT, Hydro…)"
                          value={x.source.slice(11)} onChange={e => set(i, 'source', `inspection:${e.target.value}`)} />}
                      </div> : <span className="text-muted-foreground">{sourceLabel(x.source)}</span>}
                    </td>
                    <td className="px-1">
                      {canEdit && <div className="flex">
                        <Button size="icon-xs" variant="ghost" title="Up" onClick={() => move(i, -1)}><ArrowUpIcon /></Button>
                        <Button size="icon-xs" variant="ghost" title="Down" onClick={() => move(i, 1)}><ArrowDownIcon /></Button>
                        <Button size="icon-xs" variant="ghost" title="Add a line below" onClick={() => add(i)}><PlusIcon /></Button>
                        <Button size="icon-xs" variant="ghost" title="Remove" onClick={() => setLines(xs => xs.filter((_, j) => j !== i))}><Trash2Icon /></Button>
                      </div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canEdit && <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">{lines.length} lines</span>
          <Button variant="outline" onClick={() => setLines(xs => [...xs, blank(xs[xs.length - 1]?.section)])}><PlusIcon /> Line</Button>
          <Button disabled={busy} onClick={save}>Save template</Button>
        </DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
