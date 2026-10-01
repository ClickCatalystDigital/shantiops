'use client';
// Editable body of a combined packing list: sections → packing groups → lines. Everything is a suggestion
// the Dispatch head can change: move lines between groups (drag onto a group, or "Move to"), rename/retype
// groups, show sizes under one item, make an assembly line from selected lines and expand it back.
import { useState, Fragment } from 'react';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowUpIcon, ArrowDownIcon, Trash2Icon, GripVerticalIcon, PencilIcon } from 'lucide-react';
import { PACK_TYPES, PACK_TYPE_LABEL } from '@/lib/packing-forms.mjs';

function Cell({ value, onSave, disabled, className = '' }) {
  const [v, setV] = useState(value ?? '');
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setV(value ?? ''); }
  if (disabled) return <span className="px-1">{value || '—'}</span>;
  return <Input className={`h-7 px-1.5 text-xs ${className}`} value={v} placeholder="—" onChange={e => setV(e.target.value)}
    onBlur={() => { if ((v || '') !== (value || '')) onSave(v); }} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />;
}

export default function PackingCombined({ list, items, setItems, saveItem, removeItem, readOnly }) {
  const locked = readOnly || list.status !== 'draft';
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
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
  const onlyAssembly = ids.length === 1 && tops.find(t => t.id === ids[0])?.line_kind === 'assembly';
  function makeAssembly() {
    const name = prompt('Assembly name (e.g. FEED LINE)'); if (!name) return;
    const pieces = prompt('How many pieces?', '1'); if (!pieces) return;
    act({ action: 'make_assembly', ids, name, pieces: Number(pieces) }, 'Assembly created');
  }
  function rename(g) {
    const v = prompt('Packing label', g.label); if (v && v !== g.label) act({ action: 'edit_group', group_label: g.label, new_label: v });
  }
  function drop(e, g) {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id && g.label) act({ action: 'move', ids: sel.has(id) ? ids : [id], group_label: g.label });
  }

  return (
    <div className="flex flex-col gap-3">
      {!locked && (
        <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-card p-2 text-xs">
          <span className="text-muted-foreground">{ids.length} selected</span>
          <Select disabled={!ids.length || busy} onValueChange={v => v.startsWith('new:') ? act({ action: 'move', ids, new_group: v.slice(4) }) : act({ action: 'move', ids, group_label: v })}>
            <SelectTrigger className="h-7 w-52 text-xs"><SelectValue placeholder="Move to…" /></SelectTrigger>
            <SelectContent>
              {PACK_TYPES.map(t => <SelectItem key={t} value={`new:${t}`}>New {PACK_TYPE_LABEL[t]} group</SelectItem>)}
              {labels.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-7" disabled={!ids.length || busy} onClick={makeAssembly}>Make assembly</Button>
          <Button size="sm" variant="outline" className="h-7" disabled={!onlyAssembly || busy} onClick={() => act({ action: 'expand', id: ids[0] }, 'Assembly expanded')}>Expand</Button>
          <Button size="sm" variant="outline" className="h-7" disabled={ids.length < 2 || busy} onClick={() => act({ action: 'make_sizes', ids })}>Show as sizes</Button>
          <Button size="sm" variant="outline" className="h-7 text-danger" disabled={!ids.length || busy} onClick={() => { if (confirm(`Remove ${ids.length} line(s) from this list?`)) Promise.all(ids.map(i => removeItem(i))).then(() => setSel(new Set())); }}>Remove</Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground">
            <th className="w-6" /><th className="w-8">#</th><th>Description</th><th>MOC</th><th>Size / Spec</th><th>IBR No</th><th className="w-24">Qty</th><th>Make</th><th className="w-20" />
          </tr></thead>
          <tbody>
            {groups.map((g, gi) => (
              <Fragment key={g.key + gi}>{renderGroup(g, gi === 0 || groups[gi - 1].section !== g.section)}</Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && <p className="text-sm text-muted-foreground">No items yet.</p>}
    </div>
  );

  function renderGroup(g, first) {
    return (<>
      {first && g.section && <tr><td colSpan={9} className="bg-muted/50 px-2 py-1.5 text-xs font-bold uppercase tracking-wide">{g.section}</td></tr>}
      <tr onDragOver={e => !locked && e.preventDefault()} onDrop={e => !locked && drop(e, g)}>
        <td colSpan={9} className="border-t bg-primary/5 px-2 py-1 text-xs font-semibold">
          {g.label || 'No packing group'}
          {g.type && <Badge variant="secondary" className="ml-2">{PACK_TYPE_LABEL[g.type] || g.type}</Badge>}
          {!locked && g.label && <>
            <Button variant="ghost" size="icon-sm" className="no-print ml-1 h-5 w-5" title="Rename" onClick={() => rename(g)}><PencilIcon className="size-3" /></Button>
            <Select onValueChange={t => act({ action: 'edit_group', group_label: g.label, pack_type: t })}>
              <SelectTrigger className="no-print ml-1 inline-flex h-5 w-24 text-[10px]"><SelectValue placeholder="Retype" /></SelectTrigger>
              <SelectContent>{PACK_TYPES.map(t => <SelectItem key={t} value={t}>{PACK_TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
            </Select></>}
        </td>
      </tr>
      {g.rows.flatMap(it => [it, ...kids(it.id)]).map(it => {
        const sub = !!it.parent_item_id;
        return (
          <tr key={it.id} className="border-t align-middle" draggable={!locked && !sub} onDragStart={e => e.dataTransfer.setData('text/plain', String(it.id))}>
            <td className="no-print">{!locked && !sub && <><input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} /></>}</td>
            <td className="tnum">{it.s_no ?? ''}</td>
            <td className={`font-medium ${sub ? 'pl-4' : ''}`}>{sub ? '' : <Cell value={it.material_description} disabled={locked} onSave={v => saveItem(it.id, { material_description: v })} />}
              {it.line_kind === 'assembly' && <Badge variant="outline" className="ml-1 text-[10px]">assembly</Badge>}</td>
            <td>{sub ? '' : <Cell value={it.moc} disabled={locked} onSave={v => saveItem(it.id, { moc: v })} />}</td>
            <td><Cell value={it.size_spec} disabled={locked} onSave={v => saveItem(it.id, { size_spec: v })} /></td>
            <td><Cell value={it.ibr_no} disabled={readOnly} onSave={v => saveItem(it.id, { ibr_no: v })} /></td>
            <td className="tnum">{it.line_kind === 'serial' ? '' : <span className="flex items-center gap-1"><Cell value={it.qty} disabled={locked} className="w-14" onSave={v => saveItem(it.id, { qty: v })} />{it.unit}</span>}</td>
            <td>{sub ? '' : <Cell value={it.make} disabled={locked} onSave={v => saveItem(it.id, { make: v })} />}</td>
            <td className="no-print whitespace-nowrap">{!locked && <>
              {!sub && <><Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={() => act({ action: 'reorder', id: it.id, dir: 'up' })}><ArrowUpIcon className="size-3" /></Button>
              <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={() => act({ action: 'reorder', id: it.id, dir: 'down' })}><ArrowDownIcon className="size-3" /></Button></>}
              {it.line_kind === 'sub' && <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => act({ action: 'promote_size', id: it.id })}>Own line</Button>}
              {sub && <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={() => removeItem(it.id)}><Trash2Icon className="size-3 text-danger" /></Button>}
            </>}</td>
          </tr>);
      })}
    </>);
  }
}
