'use client';

// Group 5 Bundle A — the unified PR flow (D3, unify decision 2026-08-04). One shared page for
// Engineering/Design/Stores (whichever departments the viewer holds): bundle 1-or-more item lines,
// split each across one or more projects with its own qty, submit. Materializes straight to
// bom_items on Enquiry — no acceptance gate. Kept deliberately lean per the client's steer
// ("if they don't like it, we can make changes later") — no PR history/list view yet.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { TrashIcon, PlusIcon } from 'lucide-react';

let nextKey = 1;
function emptyLine() {
  return { key: nextKey++, material_description: '', moc: '', size_spec: '', uomHint: '', projects: [{ key: nextKey++, project_id: '', qty_text: '' }] };
}

// Search-as-you-type over the Item Master catalog (GET /api/items) — picking a match autofills the
// description/spec fields; typing straight through without picking anything is just free text, the
// lean fallback the client asked for.
function ItemSearchField({ line, onChange }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  async function onType(v) {
    onChange({ material_description: v });
    if (v.trim().length < 2) { setResults([]); setOpen(false); return; }
    try {
      const rows = await api(`/api/items?search=${encodeURIComponent(v.trim())}`);
      setResults(rows);
      setOpen(rows.length > 0);
    } catch { /* catalog search is best-effort — free text still works */ }
  }

  function pick(item) {
    onChange({ material_description: item.item_name, size_spec: item.detail_desc || '', uomHint: item.uom || '' });
    setOpen(false);
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <Label>Item description {line.uomHint && <span className="font-normal text-muted-foreground">(UoM: {line.uomHint})</span>}</Label>
      <Input value={line.material_description} onChange={e => onType(e.target.value)}
        onFocus={() => setOpen(results.length > 0)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search the item catalog, or just type a description" />
      {open && (
        <div className="absolute top-full z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
          {results.map(it => (
            <button key={it.id} type="button" className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted/40"
              onMouseDown={() => pick(it)}>
              <span className="font-medium">{it.item_name}</span>
              <span className="text-xs text-muted-foreground">{it.item_code ? `${it.item_code} · ` : ''}{it.uom || '—'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LineCard({ line, projects, onChange, onRemove, removable }) {
  function setLine(patch) { onChange({ ...line, ...patch }); }
  function setProject(pkey, patch) {
    setLine({ projects: line.projects.map(p => p.key === pkey ? { ...p, ...patch } : p) });
  }
  function addProject() { setLine({ projects: [...line.projects, { key: nextKey++, project_id: '', qty_text: '' }] }); }
  function removeProject(pkey) { setLine({ projects: line.projects.filter(p => p.key !== pkey) }); }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1"><ItemSearchField line={line} onChange={setLine} /></div>
        {removable && (
          <Button size="icon-sm" variant="ghost" className="mt-6 shrink-0" onClick={onRemove}><TrashIcon className="size-4" /></Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>MOC (optional)</Label>
          <Input value={line.moc} onChange={e => setLine({ moc: e.target.value })} placeholder="e.g. MS" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Size / spec (optional)</Label>
          <Input value={line.size_spec} onChange={e => setLine({ size_spec: e.target.value })} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Projects &amp; quantity</Label>
        {line.projects.map(p => (
          <div key={p.key} className="flex items-center gap-2">
            <Select value={p.project_id} onValueChange={v => setProject(p.key, { project_id: v })}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Project…" /></SelectTrigger>
              <SelectContent>
                {projects.map(pr => <SelectItem key={pr.id} value={String(pr.id)}>{pr.project_no}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input className="flex-1" value={p.qty_text} onChange={e => setProject(p.key, { qty_text: e.target.value })} placeholder="e.g. 4 Nos" />
            {line.projects.length > 1 && (
              <Button size="icon-sm" variant="ghost" onClick={() => removeProject(p.key)}><TrashIcon className="size-4" /></Button>
            )}
          </div>
        ))}
        <Button size="sm" variant="outline" className="w-fit" onClick={addProject}>
          <PlusIcon data-icon="inline-start" />Add project
        </Button>
      </div>
    </div>
  );
}

export default function PrWorkspace({ departments, projects }) {
  const router = useRouter();
  const [dept, setDept] = useState(departments[0] || '');
  const [lines, setLines] = useState([emptyLine()]);
  const [busy, setBusy] = useState(false);

  function updateLine(key, next) { setLines(ls => ls.map(l => l.key === key ? next : l)); }
  function addLine() { setLines(ls => [...ls, emptyLine()]); }
  function removeLine(key) { setLines(ls => ls.filter(l => l.key !== key)); }

  async function submit() {
    if (!dept) return showToast('Pick a department', 'error');
    for (const l of lines) {
      if (!l.material_description.trim()) return showToast('Every line needs a description', 'error');
      if (l.projects.some(p => !p.project_id || !p.qty_text.trim())) return showToast('Every project split needs a project and a quantity', 'error');
    }
    setBusy(true);
    try {
      const res = await api('/api/purchase-requisitions', {
        method: 'POST',
        body: {
          raised_by_dept: dept,
          lines: lines.map(l => ({
            material_description: l.material_description, moc: l.moc || undefined, size_spec: l.size_spec || undefined,
            projects: l.projects.map(p => ({ project_id: Number(p.project_id), qty_text: p.qty_text })),
          })),
        },
      });
      showToast(`${res.pr_no} raised — ${res.bom_item_ids.length} item(s) on Enquiry now`);
      setLines([emptyLine()]);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Raise a purchase requisition</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {departments.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label>Raising as</Label>
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {lines.map(l => (
          <LineCard key={l.key} line={l} projects={projects} onChange={next => updateLine(l.key, next)}
            onRemove={() => removeLine(l.key)} removable={lines.length > 1} />
        ))}
        <Button size="sm" variant="outline" className="w-fit" onClick={addLine}>
          <PlusIcon data-icon="inline-start" />Add another item
        </Button>
        <Button disabled={busy} onClick={submit} className="w-fit">
          {busy ? 'Raising…' : 'Raise PR'}
        </Button>
      </CardContent>
    </Card>
  );
}
