'use client';

// components/bom-structure/NodeConfigCard.jsx — the "Configuration" card on a node's Overview tab: the
// datasheet fields of a System/Subsystem (for a fan: TYPE, FLOW cfm, STATIC HEAD, SPEED RPM, MOTOR
// RATING…). These are SPECIFICATION, not things to buy, so they live on the node instead of in the BOM
// item list (where they would count as items, block Release BOM and reach Procurement). Free-form
// label/value text — units stay inside the text. The whole list is saved at once with an explicit Save;
// rules/limits come from lib/bom-config.mjs so the server enforces the same ones.
import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PlusIcon, ArrowUpIcon, ArrowDownIcon, Trash2Icon, SlidersHorizontalIcon, AlertTriangleIcon } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';
import { CONFIG_LIMITS, CONFIG_UNIT_SUGGESTIONS } from '@/lib/bom-config.mjs';
import { api, showToast } from '@/lib/client';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function NodeConfigCard({ node, onSaveConfig, onConverted }) {
  const saved = node.config || [];
  const [rows, setRows] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset whenever the selected node changes or its saved configuration changes underneath us
  // (after a save, a template apply, or a reload) — never while the user is mid-edit on the same data.
  useEffect(() => { setRows(node.config || []); setError(''); }, [node.id, JSON.stringify(node.config || [])]); // eslint-disable-line react-hooks/exhaustive-deps

  // Items on THIS node that are really datasheet fields (imported as items before Configuration existed). Read-only
  // suggestion list from the server; converting is always a deliberate click. A 403/failure just shows nothing.
  const [cands, setCands] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [reviewing, setReviewing] = useState(false);
  const [converting, setConverting] = useState(false);
  useEffect(() => {
    setCands([]); setPicked(new Set()); setReviewing(false);
    if (!node.items?.length) return undefined;
    let cancelled = false;
    api(`/api/bom-assemblies/${node.id}/convert-items-to-config`)
      .then(r => {
        if (cancelled) return;
        setCands(r.candidates || []);
        setPicked(new Set((r.candidates || []).filter(c => c.suggested && c.convertible).map(c => c.id)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [node.id, node.items?.length]);

  async function convert() {
    setConverting(true);
    try {
      const r = await api(`/api/bom-assemblies/${node.id}/convert-items-to-config`, { method: 'POST', body: { item_ids: [...picked] } });
      showToast(`Converted ${r.converted} item${r.converted === 1 ? '' : 's'} to configuration`
        + (r.skipped?.length ? ` — ${r.skipped.length} could not be converted` : ''));
      setReviewing(false);
      onConverted?.();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setConverting(false); }
  }

  const pick = r => ({ label: r.label, value: r.value, unit: r.unit || '' });
  const dirty = !same(rows.map(pick), saved.map(pick));
  const labelKeys = rows.map(r => r.label.trim().toLowerCase()).filter(Boolean);
  const duplicated = new Set(labelKeys.filter((k, i) => labelKeys.indexOf(k) !== i));
  const canSave = dirty && !saving && duplicated.size === 0;

  function update(i, patch) { setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r)); }
  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  }

  async function save() {
    setSaving(true); setError('');
    try { await onSaveConfig(rows.filter(r => r.label.trim()).map(pick)); }
    catch (err) { setError(err.message || 'Could not save the configuration.'); }
    finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5"><SlidersHorizontalIcon className="size-3.5" />Configuration</Label>
        <div className="flex items-center gap-1.5">
          {dirty && <Button size="sm" variant="outline" onClick={() => { setRows(saved); setError(''); }} disabled={saving}>Discard</Button>}
          <Button size="sm" onClick={save} disabled={!canSave}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No configuration yet. Use this for the datasheet of this system, for example for a fan: type, flow, static head,
          speed and motor rating. These are specifications, not items to buy, so they don't appear in the BOM item list
          or in Procurement.
        </p>
      ) : (
        <div className="flex flex-col divide-y rounded-md border">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_5.5rem_auto] items-center gap-2 px-2 py-1.5">
              <Input
                value={r.label} maxLength={CONFIG_LIMITS.label} placeholder="Label (e.g. FLOW cfm)"
                className={`h-8 min-w-0 ${duplicated.has(r.label.trim().toLowerCase()) ? 'border-warning' : ''}`}
                onChange={e => update(i, { label: e.target.value })}
              />
              <Input
                value={r.value} maxLength={CONFIG_LIMITS.value} placeholder="Value (e.g. 2400)"
                className="h-8 min-w-0" onChange={e => update(i, { value: e.target.value })}
              />
              <SearchableSelect
                className="min-w-0" inputClassName="h-8" placeholder="Unit"
                value={r.unit || ''} displayValue={r.unit || ''}
                onChange={unit => update(i, { unit })} onTextChange={unit => update(i, { unit })}
                options={CONFIG_UNIT_SUGGESTIONS.map(u => ({ value: u, label: u }))}
              />
              <div className="flex shrink-0 items-center">
                <Button size="icon-sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUpIcon /></Button>
                <Button size="icon-sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down"><ArrowDownIcon /></Button>
                <Button size="icon-sm" variant="ghost" className="text-danger" onClick={() => setRows(rows.filter((_, idx) => idx !== i))} aria-label="Remove row"><Trash2Icon /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {cands.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            {cands.some(c => c.suggested) ? (
              <span>
                <strong>{cands.filter(c => c.suggested).length}</strong> item{cands.filter(c => c.suggested).length === 1 ? '' : 's'} on this node look like datasheet fields, not things to buy.
                Converting moves them here and removes them from the BOM item list.
              </span>
            ) : (
              <span>
                <strong>{cands.length}</strong> item{cands.length === 1 ? '' : 's'} on this node {cands.length === 1 ? 'has' : 'have'} no quantity or material, so {cands.length === 1 ? 'it' : 'they'} may be {cands.length === 1 ? 'a datasheet field' : 'datasheet fields'}.
                Tick any that are; converting moves them here and removes them from the BOM item list.
              </span>
            )}
            <Button size="sm" variant="outline" onClick={() => setReviewing(v => !v)}>{reviewing ? 'Hide' : 'Review & convert'}</Button>
          </div>
          {reviewing && (
            <div className="mt-2 flex flex-col gap-1.5">
              <div className="flex max-h-56 flex-col divide-y overflow-y-auto rounded-md border bg-background">
                {cands.map(c => (
                  <label key={c.id} className={`flex items-center gap-2 px-2 py-1.5 ${c.convertible ? '' : 'opacity-60'}`}>
                    <input
                      type="checkbox" disabled={!c.convertible} checked={picked.has(c.id)}
                      onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })}
                    />
                    <span className="w-1/3 shrink-0 truncate font-medium" title={c.label}>{c.label}{!c.suggested && <span className="ml-1 font-normal text-muted-foreground">(no quantity or material)</span>}</span>
                    <span className="flex-1 truncate" title={`${c.value} ${c.unit || ''}`}>{c.value ? `${c.value}${c.unit ? ' ' + c.unit : ''}` : <em className="text-muted-foreground">blank</em>}</span>
                    {!c.convertible && <span className="shrink-0 text-muted-foreground">{c.reason}</span>}
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Cannot be undone per item — the values are kept here as configuration.</span>
                <Button size="sm" onClick={convert} disabled={converting || picked.size === 0}>
                  {converting ? 'Converting…' : `Convert ${picked.size} to configuration`}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {duplicated.size > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangleIcon className="size-3.5 shrink-0" />Two rows have the same label. Make each label unique before saving.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div>
        <Button
          size="sm" variant="outline" disabled={rows.length >= CONFIG_LIMITS.rows}
          onClick={() => setRows([...rows, { label: '', value: '', unit: '' }])}
        >
          <PlusIcon data-icon="inline-start" />Add row
        </Button>
      </div>
    </div>
  );
}
