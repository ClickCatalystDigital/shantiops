'use client';

// Phase 1 nav refactor (SYSTEM.md Engineering/Requests reorg) — extracted out of PrWorkspace.jsx's
// former TemplatesTab. Same bom_templates/bom_template_items data and /api/bom-templates* routes,
// just rendered from two module locations now: Engineering ("BOM Templates" tab, kind="bom") and
// Requests ("PR Templates" tab renders kind="pr" always, plus kind="bom" again for Stores heads
// specifically — they have Requests access but not Engineering access, so this is how they keep
// reaching a feature the app's own help docs already describe them using).
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup } from './ui/select';
import { TrashIcon, PlusIcon } from 'lucide-react';
import SearchableSelect from './SearchableSelect';
import CategoryFieldsBlock from './CategoryFieldsBlock';
import { categoryDisplaySpec } from '@/lib/section-shapes';
import { NamedPartsEditor, ItemSearchField, CATEGORY_OPTIONS, defaultCategoryFields, finalizeCategoryFields } from './BomLineFields';

// Reusable per-boiler-model material lists — a new project's BOM can start from a real template
// instead of a blank Raise PR form every time.
function emptyTemplateItem() {
  return { material_description: '', moc: '', size_spec: '', section: '', qty_text: '', item_id: null, uomHint: '', category: '', categoryFields: {}, namedParts: [] };
}

// Templates store the same reusable identity a BOM line does — Item Code (via item_id, §3.2),
// category + dimensions (so a template-applied line is remnant-matchable from day one, not just
// hand-typed rows). Reuses ItemSearchField/CategoryFieldsBlock as-is — no second picker
// implementation. Deliberately NOT stored: drawing/revision — those are project-specific, never
// standard across boiler models (confirmed by how this codebase already scopes drawings to one
// project, calc_drawings.project_id NOT NULL).
function TemplateItemsEditor({ items, onChange }) {
  function update(i, patch) { onChange(items.map((it, idx) => idx === i ? { ...it, ...patch } : it)); }
  function add() { onChange([...items, emptyTemplateItem()]); }
  function remove(i) { onChange(items.filter((_, idx) => idx !== i)); }

  return (
    <div className="flex flex-col gap-3">
      <Label>Items</Label>
      {items.map((it, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border p-2.5">
          <div className="flex items-start gap-2">
            <div className="flex-1"><ItemSearchField line={it} onChange={patch => update(i, patch)} /></div>
            <Button size="icon-sm" variant="ghost" className="mt-6 shrink-0" onClick={() => remove(i)}><TrashIcon className="size-4" /></Button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Input placeholder="MOC" value={it.moc} onChange={e => update(i, { moc: e.target.value })} />
            <Input placeholder="Size / spec" value={it.size_spec} onChange={e => update(i, { size_spec: e.target.value })} />
            <SearchableSelect value={it.category || ''} placeholder="Category" options={CATEGORY_OPTIONS}
              onChange={v => update(i, { category: v, categoryFields: defaultCategoryFields(v) })} />
            <Input placeholder="Qty, e.g. 4 Nos" value={it.qty_text} onChange={e => update(i, { qty_text: e.target.value })} />
          </div>
          {it.category && (
            <CategoryFieldsBlock category={it.category} fields={it.categoryFields || {}}
              onChange={categoryFields => update(i, {
                categoryFields, size_spec: it.size_spec || categoryDisplaySpec(it.category, categoryFields),
              })} />
          )}
          {it.category && (
            <NamedPartsEditor parts={it.namedParts || []} onChange={namedParts => update(i, { namedParts })} />
          )}
        </div>
      ))}
      <Button size="sm" variant="outline" className="w-fit" onClick={add}><PlusIcon data-icon="inline-start" />Add item</Button>
    </div>
  );
}

// Create (no templateId) and edit (templateId given) share this one form — an edit that's opened
// and left untouched is what "view a template's items" actually is, no separate read-only viewer
// needed. `kind` is fixed by which section's "+ New" button opened it for create; on edit it's
// whatever the template already is (never re-picked here — no reason a template should switch
// kind mid-life, and the loaded value is only ever echoed back unchanged since PATCH doesn't
// accept it).
function TemplateFormDialog({ templateId, kind, onClose, router }) {
  const editing = !!templateId;
  const [loading, setLoading] = useState(editing);
  const [name, setName] = useState('');
  const [series, setSeries] = useState('');
  const [items, setItems] = useState([emptyTemplateItem()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) return;
    api(`/api/bom-templates/${templateId}`).then(t => {
      setName(t.name || '');
      setSeries(t.series || '');
      setItems(t.items.length ? t.items.map(it => ({
        material_description: it.material_description || '', moc: it.moc || '', size_spec: it.size_spec || '',
        section: it.section || '', qty_text: it.qty_text || '', item_id: it.item_id || null, uomHint: '',
        category: it.category || '', categoryFields: it.category_fields_json ? JSON.parse(it.category_fields_json) : {},
        namedParts: it.named_parts_json ? JSON.parse(it.named_parts_json) : [],
      })) : [emptyTemplateItem()]);
    }).catch(err => showToast(err.message, 'error')).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, templateId]);

  async function save() {
    if (!name.trim()) return showToast('Name is required', 'error');
    setSaving(true);
    try {
      const body = {
        name: name.trim(), series: series.trim() || undefined,
        items: items.filter(i => i.material_description.trim()).map(i => ({
          material_description: i.material_description, moc: i.moc, size_spec: i.size_spec, qty_text: i.qty_text,
          item_id: i.item_id || undefined, category: i.category || undefined,
          category_fields: i.category ? finalizeCategoryFields(i.category, i.categoryFields || {}) : undefined,
          named_parts: i.category && i.namedParts?.length ? i.namedParts : undefined,
        })),
      };
      if (editing) await api(`/api/bom-templates/${templateId}`, { method: 'PATCH', body });
      else await api('/api/bom-templates', { method: 'POST', body: { ...body, kind } });
      showToast(editing ? 'Template saved' : 'Template created');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  if (loading) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>;

  return (
    <Card>
      <CardHeader><CardTitle>{editing ? 'Edit template' : `New ${kind === 'pr' ? 'PR' : 'BOM'} template`}</CardTitle></CardHeader>
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
          <Button disabled={saving} onClick={save}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create template'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ApplyTemplateDialog({ template, projects, onClose, router }) {
  const [projectId, setProjectId] = useState('');
  const [applying, setApplying] = useState(false);

  async function apply(confirm = false) {
    if (!projectId) return showToast('Choose a project', 'error');
    setApplying(true);
    try {
      const res = await api(`/api/bom-templates/${template.id}/apply`, { method: 'POST', body: { project_id: Number(projectId), confirm } });
      if (res.needsConfirm) {
        setApplying(false);
        if (window.confirm(`This project already has: ${res.duplicates.join(', ')}. Add this template's items anyway?`)) await apply(true);
        return;
      }
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
          <Button disabled={applying} onClick={() => apply(false)}>{applying ? 'Applying…' : 'Apply to project'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// One section (a card + list) per kind — same row actions either way except the one action whose
// meaning genuinely differs (Apply direct-inserts a BOM template; a PR template has no equivalent
// single-project action, so it hands off to Raise PR instead).
function TemplateSection({ title, kind, templates, onNew, onEdit, onDelete, onApply, onUseInRaisePr }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction><Button size="sm" onClick={onNew}><PlusIcon data-icon="inline-start" />New</Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col divide-y p-0">
        {!templates ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No {kind === 'pr' ? 'PR' : 'BOM'} templates yet.
          </p>
        ) : templates.map(t => (
          <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div>
              <span className="text-sm font-medium">{t.name}</span>
              {t.series && <Badge variant="outline" className="ml-2 text-xs font-normal">{t.series}</Badge>}
              <span className="ml-2 text-xs text-muted-foreground">{t.item_count} item{t.item_count === 1 ? '' : 's'}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => onEdit(t)}>View/Edit</Button>
              {kind === 'bom'
                ? <Button size="sm" variant="outline" onClick={() => onApply(t)}>Apply</Button>
                : <Button size="sm" variant="outline" onClick={() => onUseInRaisePr(t)}>Use in Raise PR</Button>}
              <Button size="icon-sm" variant="ghost" className="text-danger" onClick={() => onDelete(t)}><TrashIcon className="size-3.5" /></Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// The reusable card, one kind at a time — the previous combined TemplatesTab (PrWorkspace.jsx)
// rendered both PR and BOM sections side by side; this phase splits them into two module
// locations (Engineering owns "BOM Templates", Requests owns "PR Templates" — see SYSTEM.md's
// Phase 1 nav reorg), so each caller now owns exactly the section it needs. `onUseInRaisePr` is
// only ever passed by Requests' own kind="pr" instance — Engineering's kind="bom" instance has no
// equivalent handoff, so that action never renders there (TemplateSection already branches on
// `kind` for this, not on whether the prop exists).
export default function BomTemplateManager({ kind, title, projects, onUseInRaisePr }) {
  const router = useRouter();
  const [templates, setTemplates] = useState(null);
  const [formTarget, setFormTarget] = useState(null); // { templateId?, kind }
  const [applyTarget, setApplyTarget] = useState(null); // a BOM template

  function load() {
    api(`/api/bom-templates?kind=${kind}`).then(setTemplates).catch(err => showToast(err.message, 'error'));
  }
  useEffect(load, [kind]);

  async function remove(t) {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api(`/api/bom-templates/${t.id}`, { method: 'DELETE' });
      showToast('Template deleted');
      load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function useInRaisePr(t) {
    try {
      const full = await api(`/api/bom-templates/${t.id}`);
      onUseInRaisePr(full.items);
    } catch (err) { showToast(err.message, 'error'); }
  }

  if (formTarget) {
    return <TemplateFormDialog templateId={formTarget.templateId} kind={formTarget.kind} router={router}
      onClose={() => { setFormTarget(null); load(); }} />;
  }
  if (applyTarget) {
    return <ApplyTemplateDialog template={applyTarget} projects={projects} router={router} onClose={() => setApplyTarget(null)} />;
  }

  return (
    <TemplateSection title={title} kind={kind} templates={templates}
      onNew={() => setFormTarget({ kind })} onEdit={t => setFormTarget({ templateId: t.id, kind })}
      onDelete={remove} onApply={setApplyTarget} onUseInRaisePr={onUseInRaisePr ? useInRaisePr : undefined} />
  );
}
