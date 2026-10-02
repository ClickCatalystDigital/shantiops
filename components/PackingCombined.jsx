'use client';
// Editable body of a combined packing list: sections → packing groups → lines. Everything is a suggestion
// the Dispatch head can change: move lines between groups (drag onto a group, or "Move to"), rename/retype
// groups, show sizes under one item, make an assembly line from selected lines and expand it back.
//
// Look: text first, inputs only when you click a value (no grid of boxes). Group headers carry a coloured
// pack-type pill; an assembly is a quiet layers icon + caption, not a badge; size lines hang under their item.
import { useState, Fragment, useRef } from 'react';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowUpIcon, ArrowDownIcon, Trash2Icon, PencilIcon, LayersIcon, CornerDownRightIcon, GripVerticalIcon } from 'lucide-react';
import { PACK_TYPES, PACK_TYPE_LABEL } from '@/lib/packing-forms.mjs';

const TYPE_TONE = {
  loose: 'bg-warning-surface text-warning border-warning/30',
  mounted: 'bg-info-surface text-info border-info/30',
  package: 'bg-success-surface text-success border-success/30',
  bag: 'bg-muted text-muted-foreground border-border',
};

// A value that reads as plain text and turns into a small input when clicked. Enter or leaving saves,
// Escape cancels. `numeric` right-aligns it (quantities).
function EditText({ value, onSave, disabled, placeholder = '—', numeric = false, className = '' }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  const done = useRef(false);
  const shown = value === null || value === undefined || value === '' ? null : String(value);
  const align = numeric ? 'text-right' : 'text-left';
  if (disabled) return <span className={`block px-1.5 py-1 ${align} ${className}`}>{shown ?? <span className="text-muted-foreground/40">{placeholder}</span>}</span>;
  if (!editing) {
    return (
      <button type="button" onClick={() => { done.current = false; setV(shown ?? ''); setEditing(true); }}
        className={`block w-full rounded-md px-1.5 py-1 ${align} transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none ${className}`}>
        {shown ?? <span className="text-muted-foreground/40">{placeholder}</span>}
      </button>
    );
  }
  const commit = save => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (save && v !== (shown ?? '')) onSave(v);
  };
  return (
    <input autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={() => commit(true)}
      onKeyDown={e => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); }}
      className={`h-7 w-full rounded-md border border-primary/40 bg-background px-1.5 text-sm outline-none ring-2 ring-primary/15 ${numeric ? 'text-right' : ''}`} />
  );
}

// Small replacement for window.prompt: one or two labelled fields in a dialog.
function AskDialog({ ask, onClose }) {
  const [vals, setVals] = useState(() => Object.fromEntries((ask?.fields || []).map(f => [f.key, f.value ?? ''])));
  if (!ask) return null;
  const submit = e => { e.preventDefault(); if (ask.fields.every(f => String(vals[f.key] ?? '').trim())) { ask.onSubmit(vals); onClose(); } };
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{ask.title}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {ask.fields.map((f, i) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <Label>{f.label}</Label>
              <Input autoFocus={i === 0} type={f.type || 'text'} min={f.type === 'number' ? 1 : undefined} value={vals[f.key] ?? ''} onChange={e => setVals(s => ({ ...s, [f.key]: e.target.value }))} placeholder={f.placeholder} />
            </div>
          ))}
          <DialogFooter><Button type="submit">{ask.cta || 'Save'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PackingCombined({ list, items, setItems, saveItem, removeItem, readOnly }) {
  const locked = readOnly || list.status !== 'draft';
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(null);
  const [overKey, setOverKey] = useState(null);
  const tops = items.filter(i => !i.parent_item_id);
  const kids = id => items.filter(i => i.parent_item_id === id);
  const groups = [];
  for (const it of tops) {
    const key = `${it.section || ''}|${it.group_label || ''}`;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, section: it.section, label: it.group_label, type: it.pack_type, rows: [] }; groups.push(g); }
    g.rows.push(it);
  }
  const labels = [...new Set(tops.map(t => t.group_label).filter(Boolean))];

  async function act(body, okMsg) {
    setBusy(true);
    try {
      const r = await api(`/api/packing/${list.id}/layout`, { method: 'POST', body });
      setItems(r.items); setSel(new Set()); if (okMsg) showToast(okMsg);
    } catch (e) { showToast(e.message, 'error'); }
    setBusy(false);
  }
  const ids = [...sel];
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleGroup = g => setSel(s => {
    const n = new Set(s); const all = g.rows.every(r => n.has(r.id));
    g.rows.forEach(r => (all ? n.delete(r.id) : n.add(r.id)));
    return n;
  });
  const onlyAssembly = ids.length === 1 && tops.find(t => t.id === ids[0])?.line_kind === 'assembly';
  function makeAssembly() {
    setAsk({ title: 'Make an assembly', cta: 'Create', fields: [
      { key: 'name', label: 'Assembly name', placeholder: 'e.g. FEED LINE' }, { key: 'pieces', label: 'Pieces', type: 'number', value: '1' }],
    onSubmit: v => act({ action: 'make_assembly', ids, name: v.name.trim(), pieces: Number(v.pieces) }, 'Assembly created') });
  }
  function rename(g) {
    setAsk({ title: 'Packing label', fields: [{ key: 'label', label: 'Label', value: g.label }],
      onSubmit: v => v.label.trim() !== g.label && act({ action: 'edit_group', group_label: g.label, new_label: v.label.trim() }) });
  }
  function drop(e, g) {
    e.preventDefault(); setOverKey(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id && g.label) act({ action: 'move', ids: sel.has(id) ? ids : [id], group_label: g.label });
  }
  const lineCount = items.filter(i => i.line_kind !== 'sub' && i.line_kind !== 'serial').length;
  const COLS = 8;

  return (
    <div className="flex flex-col gap-4">
      {!locked && (
        <div className="no-print sticky top-0 z-10 flex min-h-11 flex-wrap items-center gap-2 rounded-xl border bg-card/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
          {ids.length === 0 ? (
            <span className="text-muted-foreground">{lineCount} lines in {groups.length} group{groups.length === 1 ? '' : 's'}. Tick lines to move, group or remove them, or drag a line onto a group. Click any value to edit it.</span>
          ) : (<>
            <span className="font-medium">{ids.length} selected</span>
            <Select disabled={busy} onValueChange={v => v.startsWith('new:') ? act({ action: 'move', ids, new_group: v.slice(4) }) : act({ action: 'move', ids, group_label: v })}>
              <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Move to…" /></SelectTrigger>
              <SelectContent>
                {PACK_TYPES.map(t => <SelectItem key={t} value={`new:${t}`}>New {PACK_TYPE_LABEL[t]} group</SelectItem>)}
                {labels.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={makeAssembly}>Make assembly</Button>
            <Button size="sm" variant="outline" className="h-8" disabled={!onlyAssembly || busy} onClick={() => act({ action: 'expand', id: ids[0] }, 'Assembly expanded')}>Expand</Button>
            <Button size="sm" variant="outline" className="h-8" disabled={ids.length < 2 || busy} onClick={() => act({ action: 'make_sizes', ids })}>Show as sizes</Button>
            <Button size="sm" variant="ghost" className="h-8 text-danger hover:text-danger" disabled={busy} onClick={() => { if (confirm(`Remove ${ids.length} line(s) from this list?`)) Promise.all(ids.map(i => removeItem(i))).then(() => setSel(new Set())); }}><Trash2Icon className="size-3.5" />Remove</Button>
            <Button size="sm" variant="ghost" className="ml-auto h-8" onClick={() => setSel(new Set())}>Clear</Button>
          </>)}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <th className="no-print w-9 pb-2" /><th className="w-10 pb-2 pr-2">No</th><th className="pb-2 pr-3">Description</th><th className="w-44 pb-2 pr-3">MOC</th>
              <th className="w-48 pb-2 pr-3">Size / spec</th><th className="w-28 pb-2 pr-3">IBR no</th><th className="w-24 pb-2 pr-3 text-right">Qty</th><th className="w-32 pb-2">Make</th>
              {!locked && <th className="no-print w-20 pb-2" />}
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) => (
              <Fragment key={g.key + gi}>{renderGroup(g, gi === 0 || groups[gi - 1].section !== g.section)}</Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && <p className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">No items yet. Use "Add items" below.</p>}
      <AskDialog key={ask ? ask.title : 'none'} ask={ask} onClose={() => setAsk(null)} />
    </div>
  );

  function renderGroup(g, first) {
    const allPicked = g.rows.length > 0 && g.rows.every(r => sel.has(r.id));
    const span = locked ? COLS : COLS + 1;
    return (<>
      {first && g.section && (
        <tr><td colSpan={span} className="pb-1 pt-6 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{g.section}</td></tr>
      )}
      <tr onDragOver={e => { if (!locked) { e.preventDefault(); setOverKey(g.key); } }} onDragLeave={() => setOverKey(null)} onDrop={e => !locked && drop(e, g)} className="group/g">
        <td colSpan={span} className={`pt-4 ${first && g.section ? '' : ''}`}>
          <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${overKey === g.key ? 'border-primary bg-primary/10' : 'border-transparent bg-muted/50'}`}>
            {!locked && <Checkbox className="no-print" checked={allPicked} onCheckedChange={() => toggleGroup(g)} aria-label={`Select every line in ${g.label || 'this group'}`} />}
            <span className="text-sm font-semibold">{g.label || 'No packing group'}</span>
            {g.type && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${TYPE_TONE[g.type] || TYPE_TONE.bag}`}>{PACK_TYPE_LABEL[g.type] || g.type}</span>}
            <span className="text-xs text-muted-foreground tnum">{g.rows.length} line{g.rows.length === 1 ? '' : 's'}</span>
            {!locked && g.label && (
              <span className="no-print ml-auto flex items-center gap-1 opacity-50 transition-opacity group-hover/g:opacity-100">
                <Button variant="ghost" size="icon-sm" className="h-6 w-6" title="Rename label" onClick={() => rename(g)}><PencilIcon className="size-3" /></Button>
                <Select onValueChange={t => act({ action: 'edit_group', group_label: g.label, pack_type: t })}>
                  <SelectTrigger className="h-6 w-24 border-0 bg-transparent px-2 text-[11px] shadow-none"><SelectValue placeholder="Change type" /></SelectTrigger>
                  <SelectContent>{PACK_TYPES.map(t => <SelectItem key={t} value={t}>{PACK_TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
                </Select>
              </span>
            )}
          </div>
        </td>
      </tr>
      {g.rows.flatMap(it => [it, ...kids(it.id)]).map(it => {
        const sub = !!it.parent_item_id;
        const asm = it.line_kind === 'assembly';
        return (
          <tr key={it.id} className={`group/r align-top ${sel.has(it.id) ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
            draggable={!locked && !sub} onDragStart={e => e.dataTransfer.setData('text/plain', String(it.id))}>
            <td className="no-print border-b border-border/50 py-1.5 pl-1 align-middle">
              {!locked && !sub && <Checkbox checked={sel.has(it.id)} onCheckedChange={() => toggle(it.id)} aria-label="Select line" />}
            </td>
            <td className="tnum border-b border-border/50 py-1.5 pr-2 text-muted-foreground">{it.s_no ?? ''}</td>
            <td className="border-b border-border/50 py-1 pr-3">
              {sub ? (
                <span className="flex items-center gap-1.5 pl-3 text-muted-foreground"><CornerDownRightIcon className="size-3.5 shrink-0" /><span className="text-xs">size</span></span>
              ) : (<>
                <div className="flex items-center gap-1.5">
                  {asm && <LayersIcon className="ml-1.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Assembly" />}
                  <EditText value={it.material_description} disabled={locked} placeholder="Description" className="font-medium" onSave={v => saveItem(it.id, { material_description: v })} />
                </div>
                {asm && <p className="ml-6 text-[11px] leading-none text-muted-foreground">Assembly, shipped as one</p>}
              </>)}
            </td>
            <td className="border-b border-border/50 py-1 pr-3">{sub ? null : <EditText value={it.moc} disabled={locked} onSave={v => saveItem(it.id, { moc: v })} />}</td>
            <td className="border-b border-border/50 py-1 pr-3"><EditText value={it.size_spec} disabled={locked} onSave={v => saveItem(it.id, { size_spec: v })} /></td>
            <td className="border-b border-border/50 py-1 pr-3"><EditText value={it.ibr_no} disabled={readOnly} onSave={v => saveItem(it.id, { ibr_no: v })} /></td>
            <td className="tnum border-b border-border/50 py-1 pr-3">
              {it.line_kind === 'serial' ? null : (
                <div className="flex items-center justify-end gap-1">
                  <EditText value={it.qty} numeric disabled={locked} className="w-14" onSave={v => saveItem(it.id, { qty: v })} />
                  <span className="text-xs text-muted-foreground">{it.unit}</span>
                </div>)}
            </td>
            <td className="border-b border-border/50 py-1">{sub ? null : <EditText value={it.make} disabled={locked} onSave={v => saveItem(it.id, { make: v })} />}</td>
            {!locked && (
              <td className="no-print whitespace-nowrap border-b border-border/50 py-1 text-right">
                <span className="inline-flex items-center opacity-30 transition-opacity group-hover/r:opacity-100">
                  {!sub && <>
                    <Button variant="ghost" size="icon-sm" className="h-6 w-6" title="Move up" onClick={() => act({ action: 'reorder', id: it.id, dir: 'up' })}><ArrowUpIcon className="size-3" /></Button>
                    <Button variant="ghost" size="icon-sm" className="h-6 w-6" title="Move down" onClick={() => act({ action: 'reorder', id: it.id, dir: 'down' })}><ArrowDownIcon className="size-3" /></Button>
                    <GripVerticalIcon className="size-3.5 cursor-grab text-muted-foreground" aria-label="Drag onto a group" />
                  </>}
                  {it.line_kind === 'sub' && <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => act({ action: 'promote_size', id: it.id })}>Own line</Button>}
                  {sub && <Button variant="ghost" size="icon-sm" className="h-6 w-6" title="Remove size line" onClick={() => removeItem(it.id)}><Trash2Icon className="size-3 text-danger" /></Button>}
                </span>
              </td>
            )}
          </tr>);
      })}
    </>);
  }
}
