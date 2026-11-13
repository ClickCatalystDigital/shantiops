'use client';

// QC → Acceptance Rules: the limits measured values are judged against (lib/acceptance.mjs). The app holds
// no limits of its own; every rule names its source. A rule is never edited: Revise makes a new version and
// retires the old one, so past results keep the rule they were judged by.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { describeRule } from '@/lib/acceptance.mjs';
import { Card, CardHeader, CardTitle, CardContent, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { PlusIcon } from 'lucide-react';

export default function AcceptanceRules({ canEdit = false }) {
  const [rules, setRules] = useState(null);
  const [edit, setEdit] = useState(null); // {} new, or the rule being revised
  const [showOld, setShowOld] = useState(false);
  const load = useCallback(() => api('/api/acceptance-rules').then(setRules).catch(e => showToast(e.message, 'error')), []);
  useEffect(() => { load(); }, [load]);
  const shown = useMemo(() => (rules || []).filter(r => showOld || !r.retired_at), [rules, showOld]);
  async function retire(r) {
    if (!window.confirm(`Retire ${r.characteristic} v${r.version}? New inspections will have no rule for it.`)) return;
    try { await api(`/api/acceptance-rules/${r.id}/retire`, { method: 'POST' }); load(); } catch (e) { showToast(e.message, 'error'); }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Acceptance rules</CardTitle>
        <CardAction className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowOld(v => !v)}>{showOld ? 'Hide old versions' : 'Show old versions'}</Button>
          {canEdit && <Button size="sm" onClick={() => setEdit({})}><PlusIcon /> Rule</Button>}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">Enter limits from the customer’s or purchaser’s specification, or from your licensed code edition, with the source. Values entered in another unit are refused rather than converted.</p>
        {!rules ? <p className="text-sm text-muted-foreground">Loading…</p> : shown.length === 0 ? <p className="text-sm text-muted-foreground">No rules yet. Inspections still record values; they just get no automatic verdict.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1.5">Characteristic</th><th>Limit</th><th>Applies to</th><th>Source</th><th>Version</th><th /></tr></thead>
            <tbody>{shown.map(r => (
              <tr key={r.id} className={`border-t ${r.retired_at ? 'text-muted-foreground' : ''}`}>
                <td className="py-1.5 font-medium">{r.characteristic}</td>
                <td>{describeRule(r)}</td>
                <td>{r.scope === 'global' ? 'Everything' : `${r.scope}: ${r.scope_value}`}</td>
                <td>{r.source}{r.edition ? ` · ${r.edition}` : ''}</td>
                <td>v{r.version}{r.retired_at ? ` · retired ${formatDate(String(r.retired_at).slice(0, 10))}` : ''}</td>
                <td className="whitespace-nowrap text-right">{canEdit && !r.retired_at && <>
                  <Button size="xs" variant="outline" onClick={() => setEdit(r)}>Revise</Button>
                  <Button size="xs" variant="ghost" onClick={() => retire(r)}>Retire</Button>
                </>}</td>
              </tr>))}</tbody>
          </table>
        )}
      </CardContent>
      {edit && <RuleDialog r={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </Card>
  );
}

function RuleDialog({ r, onClose, onSaved }) {
  const revising = !!r.id;
  const [f, setF] = useState({ characteristic: r.characteristic || '', unit: r.unit || '', min: r.min ?? '', max: r.max ?? '',
    min_inclusive: r.id ? !!r.min_inclusive : true, max_inclusive: r.id ? !!r.max_inclusive : true,
    scope: r.scope || 'global', scope_value: r.scope_value || '', source: '', edition: r.edition || '', effective_from: '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      if (revising) await api(`/api/acceptance-rules/${r.id}/revise`, { method: 'POST', body: f });
      else await api('/api/acceptance-rules', { method: 'POST', body: f });
      showToast(revising ? `Saved as version ${r.version + 1}` : 'Rule added'); onSaved();
    } catch (e) { showToast(e.message, 'error'); setBusy(false); }
  }
  const inp = (k, l, props = {}) => <div className="flex flex-col gap-1"><Label>{l}</Label><Input value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} {...props} /></div>;
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{revising ? `Revise ${r.characteristic} (v${r.version} → v${r.version + 1})` : 'New acceptance rule'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {inp('characteristic', 'Characteristic', { disabled: revising, placeholder: 'Hardness' })}
          {inp('unit', 'Unit', { placeholder: 'HBW, FN, ppm…' })}
          <div className="flex flex-col gap-1"><Label>Minimum</Label><Input inputMode="decimal" value={f.min} onChange={e => setF({ ...f, min: e.target.value })} />
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={f.min_inclusive} onChange={e => setF({ ...f, min_inclusive: e.target.checked })} /> exactly the minimum passes</label></div>
          <div className="flex flex-col gap-1"><Label>Maximum</Label><Input inputMode="decimal" value={f.max} onChange={e => setF({ ...f, max: e.target.value })} />
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={f.max_inclusive} onChange={e => setF({ ...f, max_inclusive: e.target.checked })} /> exactly the maximum passes</label></div>
          <div className="flex flex-col gap-1"><Label>Applies to</Label>
            <Select value={f.scope} onValueChange={v => setF({ ...f, scope: v })} disabled={revising}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Everything</SelectItem><SelectItem value="customer">One customer</SelectItem>
                <SelectItem value="project">One project</SelectItem><SelectItem value="material">One material</SelectItem>
              </SelectContent>
            </Select></div>
          {f.scope !== 'global' ? inp('scope_value', f.scope === 'project' ? 'Project no.' : f.scope === 'customer' ? 'Customer name' : 'Material', { disabled: revising }) : <div />}
          <div className="sm:col-span-2">{inp('source', 'Source (required)', { placeholder: 'e.g. Customer spec XYZ-100 §4.2' })}</div>
          {inp('edition', 'Edition / revision')}{inp('effective_from', 'Effective from', { type: 'date' })}
        </div>
        {revising && <p className="text-xs text-muted-foreground">Results already recorded keep version {r.version}.</p>}
        <DialogFooter><Badge variant="outline" className="mr-auto">{describeRule({ ...f, min: f.min === '' ? null : Number(f.min), max: f.max === '' ? null : Number(f.max) })}</Badge>
          <Button disabled={busy} onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
