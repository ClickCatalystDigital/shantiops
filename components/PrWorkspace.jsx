'use client';

// Group 5 Bundle A — the unified PR flow (D3, unify decision 2026-08-04). One shared page for
// Engineering/Design/Stores (whichever departments the viewer holds): bundle 1-or-more item lines,
// split each across one or more projects with its own qty, submit. Materializes straight to
// bom_items on Enquiry — no acceptance gate. Kept deliberately lean per the client's steer
// ("if they don't like it, we can make changes later") — no PR history/list view yet.
//
// V2-CHANGES.md Group 6 Phase 6.4 — Stores-only, a per-line source selector (bom/stock, D7).
// Eng/Design stay bom-only (their lines never show the picker, always source='bom'). 'stock' builds
// existing inventory (no project, a numeric qty for the Received-time increment, Phase 6.3).
// 'sas' (trade against a Sale Order) used to be raisable from here too, Stores-initiated — per
// STORES-SALES-CHANGES.md, SAS is now Sales-only (components/SalesWorkspace.jsx's own "Request
// from Stores" dialog), so it's deliberately not offered in this picker anymore.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup } from './ui/select';
import { TrashIcon, PlusIcon, ClipboardListIcon, PackageCheckIcon, LayoutTemplateIcon, CheckIcon } from 'lucide-react';
import WorkspaceSidebar from './WorkspaceSidebar';

let nextKey = 1;
function emptyLine() {
  return {
    key: nextKey++, source: 'bom', material_description: '', moc: '', size_spec: '', uomHint: '',
    projects: [{ key: nextKey++, project_id: '', qty_text: '' }],
    inventory_item_id: '', qty: '',
    category: '', categoryFields: {},
    item_id: null, // §3.2 — set only when picked from the catalog search; cleared on any hand-edit
  };
}

// CALC-CHANGES2.md §F — category tags a "project material" line with its physical shape, plus a
// small set of category-specific dimension fields (category_fields_json — same "shape varies,
// read/written whole" idiom calc_tables/calc_snapshots already use, not a wide sparse column set).
// Optional: a line can stay uncategorized, same as it does today.
const CATEGORY_LABEL = { plate: 'Plate', ms_section: 'MS Section', angle: 'Angle', standard: 'Standard / Fitting' };
const CATEGORY_FIELD_DEFS = {
  plate: [
    { key: 'material', label: 'Material' }, { key: 'length', label: 'Length' },
    { key: 'width', label: 'Width' }, { key: 'thickness', label: 'Thickness' }, { key: 'weight', label: 'Weight' },
  ],
  ms_section: [
    { key: 'section_type', label: 'Section type' }, { key: 'size', label: 'Size, e.g. ISMB 150' },
    { key: 'length', label: 'Length' }, { key: 'weight', label: 'Weight' },
  ],
  angle: [
    { key: 'size', label: 'Size, e.g. 50×50×6' }, { key: 'length', label: 'Length' }, { key: 'weight', label: 'Weight' },
  ],
  standard: [
    { key: 'item_master_ref', label: 'Item master reference' }, { key: 'qty', label: 'Qty' },
  ],
};

// Item Master's `group_name` (e.g. "MS PLATES", "SQUARE RODS", "FLANGES") suggests a category on
// pick — confident keyword matches only, same "don't invent, only match" precedent as
// lib/calc-import.mjs/applyTemplate. No default-to-'standard' guess: most groups (CABLE, TOOLS,
// ASSET, ...) aren't a physical-material shape at all, so guessing wrong there is worse than
// leaving it for the user to pick.
function guessCategory(groupName) {
  const g = (groupName || '').toUpperCase();
  if (g.includes('PLATE')) return 'plate';
  if (g.includes('ANGLE')) return 'angle';
  if (/SECTION|CHANNEL|BEAM|JOIST|\bBAR\b|\bROD\b/.test(g)) return 'ms_section';
  return '';
}

// Search-as-you-type over the Item Master catalog (GET /api/items) — picking a match autofills the
// description/spec fields; typing straight through without picking anything is just free text, the
// lean fallback the client asked for.
function ItemSearchField({ line, onChange }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  async function onType(v) {
    // §3.2 — hand-editing after a pick invalidates the catalog link; the description no longer
    // provably matches the row item_id pointed at, so the tie is dropped rather than left stale.
    onChange({ material_description: v, item_id: null });
    if (v.trim().length < 2) { setResults([]); setOpen(false); return; }
    try {
      const rows = await api(`/api/items?search=${encodeURIComponent(v.trim())}`);
      setResults(rows);
      setOpen(rows.length > 0);
    } catch { /* catalog search is best-effort — free text still works */ }
  }

  function pick(item) {
    const category = guessCategory(item.group_name);
    onChange({
      material_description: item.item_name, size_spec: item.detail_desc || '', uomHint: item.uom || '',
      item_id: item.id,
      ...(category && { category, categoryFields: {} }),
    });
    setOpen(false);
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <Label>Item description {line.uomHint && <span className="font-normal text-muted-foreground">(UoM: {line.uomHint})</span>}</Label>
      <Input value={line.material_description} onChange={e => onType(e.target.value)}
        onFocus={() => setOpen(results.length > 0)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search the item catalog, or just type a description" />
      {line.item_id && <p className="text-xs text-success">✓ Linked to catalog — real matching against Inventory now possible for this line.</p>}
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

const SOURCE_LABEL = { bom: 'Project material', stock: 'Build stock' };

function LineCard({ line, projects, inventoryItems, showSourcePicker, onChange, onRemove, removable }) {
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

      {showSourcePicker && (
        <div className="flex flex-col gap-1.5">
          <Label>Kind</Label>
          <Select value={line.source} onValueChange={v => setLine({ source: v })}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(SOURCE_LABEL).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {line.source === 'bom' && (
        <div className="flex flex-col gap-1.5">
          <Label>Category (optional)</Label>
          <Select value={line.category || '__none__'} onValueChange={v => setLine({ category: v === '__none__' ? '' : v, categoryFields: {} })}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Uncategorized</SelectItem>
              {Object.entries(CATEGORY_LABEL).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {line.source === 'bom' && line.category && (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-dashed p-2.5 sm:grid-cols-3">
          {CATEGORY_FIELD_DEFS[line.category].map(f => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <Label className="text-xs">{f.label}</Label>
              <Input value={line.categoryFields[f.key] || ''}
                onChange={e => setLine({ categoryFields: { ...line.categoryFields, [f.key]: e.target.value } })} />
            </div>
          ))}
        </div>
      )}

      {line.source === 'bom' && (
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
      )}

      {line.source === 'stock' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Inventory item</Label>
            <Select value={line.inventory_item_id} onValueChange={v => setLine({ inventory_item_id: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>
                {inventoryItems.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.description}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Quantity to build</Label>
            <Input type="number" value={line.qty} onChange={e => setLine({ qty: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}

function RaisePrTab({ departments, projects, inventoryItems = [] }) {
  const router = useRouter();
  const [dept, setDept] = useState(departments[0] || '');
  const [lines, setLines] = useState([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const showSourcePicker = dept === 'Stores';

  function updateLine(key, next) { setLines(ls => ls.map(l => l.key === key ? next : l)); }
  function addLine() { setLines(ls => [...ls, emptyLine()]); }
  function removeLine(key) { setLines(ls => ls.filter(l => l.key !== key)); }

  async function submit() {
    if (!dept) return showToast('Pick a department', 'error');
    for (const l of lines) {
      if (!l.material_description.trim()) return showToast('Every line needs a description', 'error');
      const source = showSourcePicker ? l.source : 'bom';
      if (source === 'bom' && l.projects.some(p => !p.project_id || !p.qty_text.trim())) {
        return showToast('Every project split needs a project and a quantity', 'error');
      }
      if (source === 'stock' && (!l.inventory_item_id || !l.qty || Number(l.qty) <= 0)) {
        return showToast('Pick an inventory item and a quantity to build', 'error');
      }
    }
    setBusy(true);
    try {
      const res = await api('/api/purchase-requisitions', {
        method: 'POST',
        body: {
          raised_by_dept: dept,
          lines: lines.map(l => {
            const source = showSourcePicker ? l.source : 'bom';
            const base = { material_description: l.material_description, moc: l.moc || undefined, size_spec: l.size_spec || undefined, source, item_id: l.item_id || undefined };
            if (source === 'stock') return { ...base, inventory_item_id: Number(l.inventory_item_id), qty: Number(l.qty) };
            return {
              ...base, category: l.category || undefined, category_fields: l.category ? l.categoryFields : undefined,
              projects: l.projects.map(p => ({ project_id: Number(p.project_id), qty_text: p.qty_text })),
            };
          }),
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
          <LineCard key={l.key} line={l} projects={projects} inventoryItems={inventoryItems}
            showSourcePicker={showSourcePicker} onChange={next => updateLine(l.key, next)}
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

// Release BOM = a deliberate, whole-project action ("everything's ready together"), not something
// inferred from the first item landing on the BOM — a project's BOM usually gets built up
// piecemeal over days (app/api/projects/[id]/release-bom's own comment explains why). This tab is
// just that button plus enough status to know whether it's already been pressed.
function ReleaseBomTab({ projects }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState(null); // { bomCount, released } | null
  const [loading, setLoading] = useState(false);
  const [releasing, setReleasing] = useState(false);

  useEffect(() => {
    if (!projectId) { setStatus(null); return; }
    let cancelled = false;
    setLoading(true);
    api(`/api/projects/${projectId}/release-bom`)
      .then(s => !cancelled && setStatus(s))
      .catch(err => !cancelled && showToast(err.message, 'error'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [projectId]);

  async function release() {
    setReleasing(true);
    try {
      await api(`/api/projects/${projectId}/release-bom`, { method: 'POST' });
      showToast('BOM released');
      setStatus(s => ({ ...s, released: true }));
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setReleasing(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Release BOM</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Select a project" /></SelectTrigger>
          <SelectContent><SelectGroup>
            {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
        {!projectId ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Pick a project to release its BOM to Procurement.</p>
        ) : loading || !status ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm">{status.bomCount} BOM item{status.bomCount === 1 ? '' : 's'} on this project</span>
            {status.released ? (
              <span className="flex items-center gap-1 text-sm text-success"><CheckIcon className="size-4" />Released</span>
            ) : (
              <Button size="sm" disabled={releasing || !status.bomCount} onClick={release}>
                {releasing ? 'Releasing…' : 'Release BOM'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Reusable per-boiler-model material lists — a new project's BOM can start from a real template
// instead of a blank Raise PR form every time. No prior template concept existed in the BOM/PR
// code (confirmed by search); this is a genuinely new page, not a rename of an existing one.
function TemplateItemsEditor({ items, onChange }) {
  function update(i, patch) { onChange(items.map((it, idx) => idx === i ? { ...it, ...patch } : it)); }
  function add() { onChange([...items, { material_description: '', moc: '', size_spec: '', section: '', qty_text: '' }]); }
  function remove(i) { onChange(items.filter((_, idx) => idx !== i)); }

  return (
    <div className="flex flex-col gap-2">
      <Label>Items</Label>
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-5 gap-2">
          <Input className="col-span-2" placeholder="Description" value={it.material_description}
            onChange={e => update(i, { material_description: e.target.value })} />
          <Input placeholder="MOC" value={it.moc} onChange={e => update(i, { moc: e.target.value })} />
          <Input placeholder="Size / spec" value={it.size_spec} onChange={e => update(i, { size_spec: e.target.value })} />
          <div className="flex gap-1">
            <Input placeholder="Qty" value={it.qty_text} onChange={e => update(i, { qty_text: e.target.value })} />
            <Button size="icon-sm" variant="ghost" onClick={() => remove(i)}><TrashIcon className="size-4" /></Button>
          </div>
        </div>
      ))}
      <Button size="sm" variant="outline" className="w-fit" onClick={add}><PlusIcon data-icon="inline-start" />Add item</Button>
    </div>
  );
}

function NewTemplateDialog({ onClose, router }) {
  const [name, setName] = useState('');
  const [series, setSeries] = useState('');
  const [items, setItems] = useState([{ material_description: '', moc: '', size_spec: '', section: '', qty_text: '' }]);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return showToast('Name is required', 'error');
    setSaving(true);
    try {
      await api('/api/bom-templates', {
        method: 'POST',
        body: { name: name.trim(), series: series.trim() || undefined, items: items.filter(i => i.material_description.trim()) },
      });
      showToast('Template created');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>New template</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 3 TPH Solid Fuel Fired Boiler" autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Series / model (optional)</Label>
            <Input value={series} onChange={e => setSeries(e.target.value)} />
          </div>
        </div>
        <TemplateItemsEditor items={items} onChange={setItems} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Create template'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ApplyTemplateDialog({ template, projects, onClose, router }) {
  const [projectId, setProjectId] = useState('');
  const [applying, setApplying] = useState(false);

  async function apply() {
    if (!projectId) return showToast('Choose a project', 'error');
    setApplying(true);
    try {
      const res = await api(`/api/bom-templates/${template.id}/apply`, { method: 'POST', body: { project_id: Number(projectId) } });
      showToast(`${res.inserted} item(s) added to the project's BOM`);
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setApplying(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Apply "{template.name}" to a project</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Select a project" /></SelectTrigger>
          <SelectContent><SelectGroup>
            {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={applying} onClick={apply}>{applying ? 'Applying…' : 'Apply to project'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TemplatesTab({ projects }) {
  const router = useRouter();
  const [templates, setTemplates] = useState(null);
  const [creating, setCreating] = useState(false);
  const [applyTarget, setApplyTarget] = useState(null);

  function load() {
    api('/api/bom-templates').then(setTemplates).catch(err => showToast(err.message, 'error'));
  }
  useEffect(load, []);

  async function remove(t) {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api(`/api/bom-templates/${t.id}`, { method: 'DELETE' });
      showToast('Template deleted');
      load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  if (creating) {
    return <NewTemplateDialog router={router} onClose={() => { setCreating(false); load(); }} />;
  }
  if (applyTarget) {
    return <ApplyTemplateDialog template={applyTarget} projects={projects} router={router} onClose={() => setApplyTarget(null)} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>BOM Templates</CardTitle>
        <CardAction><Button size="sm" onClick={() => setCreating(true)}><PlusIcon data-icon="inline-start" />New template</Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col divide-y p-0">
        {!templates ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No templates yet — create one from a project's material list.</p>
        ) : templates.map(t => (
          <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div>
              <span className="text-sm font-medium">{t.name}</span>
              {t.series && <Badge variant="outline" className="ml-2 text-xs font-normal">{t.series}</Badge>}
              <span className="ml-2 text-xs text-muted-foreground">{t.item_count} item{t.item_count === 1 ? '' : 's'}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => setApplyTarget(t)}>Apply to project</Button>
              <Button size="icon-sm" variant="ghost" className="text-danger" onClick={() => remove(t)}><TrashIcon className="size-3.5" /></Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function PrWorkspace({ departments, projects, inventoryItems = [] }) {
  const [tab, setTab] = useState('raise');
  const navItems = [
    { key: 'raise', label: 'Raise PR', icon: ClipboardListIcon },
    { key: 'release', label: 'Release BOM', icon: PackageCheckIcon },
    { key: 'templates', label: 'Templates', icon: LayoutTemplateIcon },
  ];

  return (
    <WorkspaceSidebar title="Requests" icon={ClipboardListIcon} items={navItems} activeKey={tab} onChange={setTab}>
      {tab === 'raise' && <RaisePrTab departments={departments} projects={projects} inventoryItems={inventoryItems} />}
      {tab === 'release' && <ReleaseBomTab projects={projects} />}
      {tab === 'templates' && <TemplatesTab projects={projects} />}
    </WorkspaceSidebar>
  );
}
