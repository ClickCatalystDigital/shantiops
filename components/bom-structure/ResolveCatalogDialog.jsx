'use client';

// components/bom-structure/ResolveCatalogDialog.jsx — review queue for BOM lines not linked to the Item Master. Same aggregated-count
// -becomes-a-queue idea as ResolveCategoriesDialog / ResolveUnassignedDialog, but a checklist rather than one-at-a-time: matching is
// mostly "accept the confident ones in bulk, look at the rest". The server (GET /api/projects/[id]/catalog-suggestions) does the
// matching (lib/item-match.mjs); confident matches (memory / family / attribute) come pre-ticked, suggestions and misses do not.
// Linking goes through POST .../catalog-suggestions -> linkBomItem, so every accepted link is remembered for the next import and a bare
// quantity picks up the catalog unit.
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import SearchableSelect from '@/components/SearchableSelect';
import { api, showToast } from '@/lib/client';

const LEVEL_LABEL = { memory: 'linked before', family: 'same family', attribute: 'exact size match', suggest: 'suggestions', none: 'no match' };

export default function ResolveCatalogDialog({ projectId, onClose }) {
  const [rows, setRows] = useState(null);
  const [pick, setPick] = useState({});      // bom_item_id -> chosen catalog id (0 = none)
  const [ticked, setTicked] = useState(new Set());
  const [names, setNames] = useState({});    // catalog id -> name, for rows found by search
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const r = await api(`/api/projects/${projectId}/catalog-suggestions`);
      setRows(r.items);
      setPick(Object.fromEntries(r.items.map(i => [i.id, i.itemId || 0])));
      setTicked(new Set(r.items.filter(i => i.itemId).map(i => i.id)));
    } catch (err) { setError(err.message); setRows([]); }
  }
  useEffect(() => { load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const links = useMemo(() => (rows || []).filter(r => ticked.has(r.id) && pick[r.id]).map(r => ({ bom_item_id: r.id, item_id: pick[r.id] })), [rows, ticked, pick]);

  async function link() {
    setSaving(true);
    try {
      // Chunks: each link is a handful of database writes (link, remember, audit), so a long list goes in small batches.
      let linked = 0, unitsFilled = 0, skipped = 0;
      for (let i = 0; i < links.length; i += 25) {
        setProgress(`${Math.min(i + 25, links.length)} of ${links.length}`);
        const r = await api(`/api/projects/${projectId}/catalog-suggestions`, { method: 'POST', body: { links: links.slice(i, i + 25) } });
        linked += r.linked; unitsFilled += r.unitsFilled; skipped += r.skipped?.length || 0;
      }
      setProgress('');
      showToast(`Linked ${linked} item${linked === 1 ? '' : 's'}` + (unitsFilled ? ` — ${unitsFilled} got their unit from the catalog` : '') + (skipped ? `, ${skipped} skipped` : ''));
      await load();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  const autoCount = (rows || []).filter(r => r.itemId).length;

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Link items to the Item Master</DialogTitle>
          <DialogDescription>
            {rows == null ? 'Matching…' : `${rows.length} not linked yet — ${autoCount} with a confident match (pre-ticked). Every link you accept is remembered, so the next import links it by itself.`}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex max-h-[28rem] flex-col divide-y overflow-y-auto rounded-md border">
          {(rows || []).map(r => {
            const value = pick[r.id] || 0;
            const options = [{ value: 0, label: '— no link —' }, ...r.candidates.map(c => ({ value: c.id, label: c.name }))];
            return (
              <div key={r.id} className="flex items-start gap-2 px-2 py-2 text-xs">
                <input type="checkbox" className="mt-1" checked={ticked.has(r.id) && !!value} disabled={!value}
                  onChange={e => setTicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                <div className="flex w-2/5 min-w-0 flex-col">
                  <span className="truncate font-medium" title={r.description}>{r.description}</span>
                  <span className="truncate text-muted-foreground" title={`${r.moc || ''} ${r.size_spec || ''}`}>{[r.moc, r.size_spec].filter(Boolean).join(' · ') || '—'}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <SearchableSelect
                    className="w-full" inputClassName="h-8" value={value} options={options} placeholder="Search the catalog…"
                    displayValue={value ? (r.candidates.find(c => c.id === value)?.name || names[value] || `Item ${value}`) : ''}
                    onChange={v => { setPick(p => ({ ...p, [r.id]: v })); setTicked(t => { const n = new Set(t); if (v) n.add(r.id); else n.delete(r.id); return n; }); }}
                    asyncOptions={async q => (await api(`/api/items?search=${encodeURIComponent(q)}`)).slice(0, 8).map(x => { names[x.id] = x.item_name; return { value: x.id, label: x.item_name }; })}
                  />
                  <span className={r.level === 'suggest' ? 'text-warning' : 'text-muted-foreground'}>
                    {LEVEL_LABEL[r.level]}{r.reason ? ` — ${r.reason}` : ''}
                    {r.unitAfter && r.unitAfter !== r.qty_text ? ` · quantity becomes ${r.unitAfter}` : ''}
                  </span>
                  {r.level === 'suggest' && !value && r.candidates.length > 0 && (
                    <span className="flex flex-col items-start gap-0.5">
                      {r.candidates.slice(0, 3).map(c => (
                        <button key={c.id} type="button" className="max-w-full truncate text-left text-primary hover:underline" title={c.name}
                          onClick={() => { setPick(p => ({ ...p, [r.id]: c.id })); setTicked(t => new Set(t).add(r.id)); }}>
                          Use: {c.name}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {rows && rows.length === 0 && !error && <p className="p-4 text-sm text-muted-foreground">Every item is linked.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={link} disabled={saving || links.length === 0}>{saving ? `Linking ${progress}…` : `Link ${links.length} selected`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
