'use client';

// The "Hand over to Dispatch" overlay, shared by Shop Floor > Dispatch and the job card's DISPATCH
// stage so both ask exactly the same questions: (1) only when a project's last packing list is already
// packed — start a new draft or pull that list back to draft; (2) always — does Production approve the
// items for dispatch. Backed by /api/production/handovers(/preview); nothing is decided client-side.
import { useEffect, useMemo, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertTriangleIcon } from 'lucide-react';

export const subKey = l => `${l.indent_project_id}:${l.unit_project_id || 0}:${l.group_id || 0}`;

// Lines (from GET /api/production/handovers) grouped into finished-subsystem cards.
export function buildSubsystems(data) {
  const g = new Map();
  (data?.lines || []).forEach(l => {
    if (l.required_qty && l.remaining <= 0) return;
    const k = subKey(l);
    if (!g.has(k)) g.set(k, { key: k, project_id: l.indent_project_id, project_no: l.indent_project_no, customer: l.customer_name,
      unit: l.unit_project_no, group_id: l.group_id, name: l.group_name, lines: [] });
    g.get(k).lines.push(l);
  });
  return [...g.values()].map(s => ({
    ...s,
    ready: s.lines.filter(l => l.required_qty && l.remaining > 0),
    unclear: s.lines.filter(l => !l.required_qty).length,
    waiting: s.unit ? 0 : (data?.waiting?.[`${s.project_id}:${s.group_id || 0}`] || 0),
  }));
}

const itemsOf = subs => subs.flatMap(s => s.ready.map(l => ({
  bom_item_id: l.bom_item_id, child_project_id: l.unit_project_id || undefined, qty: l.remaining,
})));

// subsystems: what could be handed over. selectable: show a tick list inside the overlay (job card
// flow, everything pre-ticked); otherwise exactly these subsystems are handed over (Shop Floor screen).
export default function HandoverDialog({ subsystems, selectable = false, initialNote = '', onClose, onDone }) {
  const withReady = useMemo(() => subsystems.filter(s => s.ready.length), [subsystems]);
  const [picked, setPicked] = useState(() => new Set(withReady.map(s => s.key)));
  const [note, setNote] = useState(initialNote);
  const [groups, setGroups] = useState(null); // preview of what happens to each project's packing list
  const [choices, setChoices] = useState({}); // group key -> 'new' | list id
  const [approve, setApprove] = useState(null);
  const [busy, setBusy] = useState(false);

  const chosen = withReady.filter(s => picked.has(s.key));
  const items = useMemo(() => itemsOf(chosen), [picked, withReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ask the server what will happen to each packing list whenever the selection changes.
  useEffect(() => {
    if (!items.length) { setGroups([]); return; }
    let live = true;
    setGroups(null);
    api('/api/production/handovers/preview', { method: 'POST', body: { items } }).then(r => {
      if (!live) return;
      setGroups(r.groups);
      setChoices(c => { const n = {}; r.groups.forEach(g => { if (g.reopenable) n[g.key] = c[g.key] ?? 'new'; }); return n; });
    }).catch(err => { if (live) { showToast(err.message, 'error'); setGroups([]); } });
    return () => { live = false; };
  }, [items]);

  async function confirm() {
    setBusy(true);
    try {
      const list_choices = {};
      Object.entries(choices).forEach(([k, v]) => { if (v !== 'new') list_choices[k] = v; });
      const r = await api('/api/production/handovers', { method: 'POST', body: { items, note: note || undefined, approve, list_choices } });
      const lists = [...new Set((r.packing || []).filter(p => p.packing_no).map(p => p.packing_no))];
      const failed = (r.packing || []).filter(p => p.error);
      showToast(`${chosen.length} subsystem${chosen.length === 1 ? '' : 's'} handed over to Dispatch${lists.length ? ` — on packing list ${lists.length > 3 ? `${lists.slice(0, 3).join(', ')} +${lists.length - 3} more` : lists.join(', ')}` : ''}`);
      if (failed.length) showToast(`Handed over, but a packing list could not be updated (${failed[0].error}). Dispatch can add the items from Pending Items.`, 'error');
      onDone?.();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  const toggle = k => setPicked(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hand over to Dispatch</DialogTitle>
          <DialogDescription>
            {chosen.length} subsystem{chosen.length === 1 ? '' : 's'} ({items.length} item{items.length === 1 ? '' : 's'}).
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {selectable && (
            <div className="divide-y rounded-lg border text-sm">
              {subsystems.map(s => (
                <div key={s.key} className="px-3 py-2">
                  <label className="flex items-center gap-3">
                    <Checkbox checked={picked.has(s.key)} disabled={!s.ready.length} onCheckedChange={() => toggle(s.key)} />
                    <span className="font-medium">{s.name}</span>
                    {s.unit && <span className="text-xs text-muted-foreground">Unit {s.unit}</span>}
                    <span className="ml-auto text-xs text-muted-foreground tnum">{s.ready.length} item{s.ready.length === 1 ? '' : 's'}</span>
                  </label>
                  {(s.waiting > 0 || s.unclear > 0) && (
                    <p className="mt-1 flex items-start gap-1.5 pl-7 text-xs text-warning">
                      <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
                      <span>
                        {s.waiting > 0 && `${s.waiting} more made item${s.waiting === 1 ? '' : 's'} ${s.waiting === 1 ? 'is' : 'are'} not with Production yet. `}
                        {s.unclear > 0 && `${s.unclear} item${s.unclear === 1 ? ' has' : 's have'} an unclear quantity and won't be handed over.`}
                      </span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {selectable && <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Note for Dispatch (optional)" className="h-9" />}
          {(groups || []).filter(g => g.reopenable || g.blocked).map(g => (
            <fieldset key={g.key} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
              <legend className="px-1 text-xs font-medium text-muted-foreground">{g.project_no}{g.unit ? ` · Unit ${g.unit}` : ''}</legend>
              {g.reopenable ? (<>
                <p>
                  Packing list <span className="font-medium">{g.reopenable.packing_no}</span> is already packed
                  {g.reopenable.review ? ' and in review' : ''}. Where should these {g.items} item{g.items === 1 ? '' : 's'} go?
                </p>
                <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={choices[g.key] === 'new'}
                  onChange={() => setChoices(c => ({ ...c, [g.key]: 'new' }))} />
                  <span>Start a new draft list</span></label>
                <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={choices[g.key] === g.reopenable.id}
                  onChange={() => setChoices(c => ({ ...c, [g.key]: g.reopenable.id }))} />
                  <span>Add to {g.reopenable.packing_no}<span className="block text-xs text-muted-foreground">
                    It goes back to draft{g.reopenable.review ? ', its review is withdrawn and it has to be submitted again' : ''}.</span></span></label>
              </>) : (
                <p>{g.blocked.packing_no} is already packed and can't be reopened ({g.blocked.reason}). These items start a new draft list.</p>
              )}
            </fieldset>
          ))}
          <fieldset className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Production approval</legend>
            <p>Do you approve these items for dispatch?</p>
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" name="ho-approve" checked={approve === true}
              onChange={() => setApprove(true)} /><span>Yes, approved</span></label>
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" name="ho-approve" checked={approve === false}
              onChange={() => setApprove(false)} /><span>Not yet<span className="block text-xs text-muted-foreground">You can approve later from Approvals.</span></span></label>
          </fieldset>
        </div>
        <DialogFooter className="m-0">
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || approve === null || groups === null || !items.length} onClick={confirm}>{busy ? 'Handing over…' : 'Hand over'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
