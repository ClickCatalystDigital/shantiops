'use client';

// components/bom-structure/AddSubsystemDialog.jsx — pick a subsystem (FD Fan Blower…), pick a build (5 HP, 10 HP…),
// see its lines with tick boxes, add. Required and usual lines start ticked, optional ones unticked; sizes, quantities
// and configuration are edited on the BOM afterwards (every editor already exists there). Nothing is written until Add.
// Applying goes through the same template routes as "Build from Templates" — this only adds the choice of lines.
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import SearchableSelect from '@/components/SearchableSelect';
import { api, showToast } from '@/lib/client';
import { itemSkipKey } from '@/lib/bom-structure.mjs';
import { subsystemFamily } from '@/lib/subsystem-family.mjs';

const presenceLabel = { usual: 'usual', optional: 'optional' };

function PreviewNodes({ nodes, idxPath, depth, ticked, toggle }) {
  return nodes.map((n, ni) => {
    const ip = [...idxPath, ni];
    return (
      <div key={ip.join('.')} className="flex flex-col">
        <div className="bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground" style={{ paddingLeft: 12 + depth * 16 }}>{n.name}</div>
        {(n.items || []).map((it, i) => {
          const k = itemSkipKey(ip, i);
          const on = ticked.has(k);
          return (
            <label key={k} className="flex cursor-pointer items-start gap-2 border-t px-3 py-1.5 text-sm hover:bg-muted/30" style={{ paddingLeft: 12 + depth * 16 }}>
              <Checkbox checked={on} onCheckedChange={() => toggle(k)} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate">{it.material_description}</span>
                  {presenceLabel[it.presence] && <Badge variant="outline" className="text-[10px] font-normal">{presenceLabel[it.presence]}</Badge>}
                </span>
                {(it.size_spec || it.qty_text) && <span className="block truncate text-xs text-muted-foreground">{[it.size_spec, it.qty_text].filter(Boolean).join(' · ')}</span>}
                {!on && !it.presence && <span className="block text-xs text-warning">Every build has this line — only untick it if this one really does not.</span>}
              </span>
            </label>
          );
        })}
        <PreviewNodes nodes={n.children || []} idxPath={ip} depth={depth + 1} ticked={ticked} toggle={toggle} />
      </div>
    );
  });
}

const allKeys = (nodes, idxPath = []) => (nodes || []).flatMap((n, ni) => {
  const ip = [...idxPath, ni];
  return [...(n.items || []).map((it, i) => ({ key: itemSkipKey(ip, i), presence: it.presence })), ...allKeys(n.children, ip)];
});

export default function AddSubsystemDialog({ onClose, onApply, parentNode, siblings, series, released }) {
  const [templates, setTemplates] = useState(null);
  const [familyKey, setFamilyKey] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [detail, setDetail] = useState(null);       // the chosen template with its tree
  const [ticked, setTicked] = useState(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/bom-structure-templates').then(list => setTemplates(list.filter(t => t.family && t.root_count === 1))).catch(() => setTemplates([]));
  }, []);

  const families = useMemo(() => {
    const m = new Map();
    for (const t of templates || []) {
      const k = subsystemFamily(t.family).key;
      if (!m.has(k)) m.set(k, { key: k, label: t.family, builds: [] });
      m.get(k).builds.push(t);
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [templates]);
  const family = families.find(f => f.key === familyKey);
  // default build first, then the project's own model, then by name
  const builds = useMemo(() => [...(family?.builds || [])].sort((a, b) =>
    (b.is_default - a.is_default) || ((b.series === series) - (a.series === series)) || a.name.localeCompare(b.name)), [family, series]);

  function pickFamily(k) { setFamilyKey(k); setDetail(null); setTemplateId(''); const f = families.find(x => x.key === k); if (f) { const first = [...f.builds].sort((a, b) => (b.is_default - a.is_default) || ((b.series === series) - (a.series === series)))[0]; setTemplateId(String(first.id)); } }

  useEffect(() => {
    if (!templateId) { setDetail(null); return; }
    setDetail(null);
    api(`/api/bom-structure-templates/${templateId}`).then(t => {
      setDetail(t);
      setTicked(new Set(allKeys(t.tree).filter(x => x.presence !== 'optional').map(x => x.key)));
    }).catch(err => showToast(err.message, 'error'));
  }, [templateId]);

  const keys = useMemo(() => allKeys(detail?.tree), [detail]);
  const toggle = k => setTicked(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const rootConfig = (detail?.tree?.[0]?.config || []).map(c => `${c.label}: ${c.value}${c.unit ? ' ' + c.unit : ''}`).join(' · ');
  const alreadyHas = family && (siblings || []).some(s => subsystemFamily(s.name).key === family.key);

  async function submit() {
    setBusy(true);
    try {
      const skip = keys.filter(x => !ticked.has(x.key)).map(x => x.key);
      await onApply({ templateId: detail.id, version: detail.version, skip });
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Add subsystem</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Added under <b>{parentNode ? parentNode.name : 'the top level of this BOM'}</b>. Sizes and quantities come from the build as saved — edit them on the BOM afterwards.
        </p>
        {templates === null ? <Skeleton className="h-24 w-full" /> : families.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subsystem builds saved yet. Save a subsystem node as a template (bookmark icon on the node) and give it a family; it then appears here.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Subsystem</Label>
                <SearchableSelect value={familyKey} onChange={pickFamily} placeholder="Search subsystems…"
                  options={families.map(f => ({ value: f.key, label: `${f.label} (${f.builds.length} build${f.builds.length === 1 ? '' : 's'})` }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Build</Label>
                <Select value={templateId} onValueChange={setTemplateId} disabled={!family}>
                  <SelectTrigger><SelectValue placeholder="Pick a subsystem first" /></SelectTrigger>
                  <SelectContent>{builds.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}{b.is_default ? ' ★' : ''}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {alreadyHas && <p className="text-xs text-warning">This place already has a “{family.label}”. Adding another creates a second one.</p>}
            {released && <p className="text-xs text-muted-foreground">This BOM is released — the new lines go to Procurement as ordinary lines.</p>}
            {templateId && detail === null && <Skeleton className="h-40 w-full" />}
            {detail && (
              <>
                {rootConfig && <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"><b>Configuration copied:</b> {rootConfig}</p>}
                <div className="max-h-[40vh] overflow-y-auto rounded-md border">
                  <PreviewNodes nodes={detail.tree || []} idxPath={[]} depth={0} ticked={ticked} toggle={toggle} />
                </div>
                <p className="text-xs text-muted-foreground">{keys.filter(x => ticked.has(x.key)).length} of {keys.length} lines will be added.</p>
              </>
            )}
          </>
        )}
        <DialogFooter className="m-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !detail}>{busy ? 'Adding…' : 'Add subsystem'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
