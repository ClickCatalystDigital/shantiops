'use client';

// components/TemplateLinesDialog.jsx — a Head marks each line of a Structure Template as Required, Usual or Optional.
// The marks are what "Add subsystem" pre-ticks (required and usual ticked, optional not) and what the "possibly
// missing" check looks for (required only). Saves only the lines that changed; the template version moves when any did.
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, showToast } from '@/lib/client';

const OPTIONS = [['required', 'Required'], ['usual', 'Usual'], ['optional', 'Optional']];
const keyOf = (idxPath, i) => `${idxPath.join('.')}:${i}`;

function NodeLines({ nodes, idxPath, depth, marks, setMark }) {
  return nodes.map((n, ni) => {
    const ip = [...idxPath, ni];
    return (
      <div key={ip.join('.')} className="flex flex-col">
        <div className="bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground" style={{ paddingLeft: 12 + depth * 16 }}>{n.name}</div>
        {(n.items || []).map((it, i) => (
          <div key={i} className="flex items-center justify-between gap-3 border-t px-3 py-1.5 text-sm" style={{ paddingLeft: 12 + depth * 16 }}>
            <span className="min-w-0">
              <span className="block truncate">{it.material_description}</span>
              {(it.size_spec || it.qty_text) && <span className="block truncate text-xs text-muted-foreground">{[it.size_spec, it.qty_text].filter(Boolean).join(' · ')}</span>}
            </span>
            <Select value={marks[keyOf(ip, i)] || 'required'} onValueChange={v => setMark(ip, i, v)}>
              <SelectTrigger className="h-8 w-28 shrink-0"><SelectValue /></SelectTrigger>
              <SelectContent>{OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ))}
        <NodeLines nodes={n.children || []} idxPath={ip} depth={depth + 1} marks={marks} setMark={setMark} />
      </div>
    );
  });
}

export default function TemplateLinesDialog({ template, onClose, onSaved }) {
  const [tree, setTree] = useState(null);
  const [initial, setInitial] = useState({});
  const [marks, setMarks] = useState({});
  const [saving, setSaving] = useState(false);
  const [family, setFamily] = useState(template.family || '');

  useEffect(() => {
    api(`/api/bom-structure-templates/${template.id}`).then(t => {
      const start = {};
      (function walk(nodes, idxPath) {
        (nodes || []).forEach((n, ni) => {
          const ip = [...idxPath, ni];
          (n.items || []).forEach((it, i) => { if (it.presence) start[keyOf(ip, i)] = it.presence; });
          walk(n.children, ip);
        });
      })(t.tree, []);
      setTree(t.tree || []); setInitial(start); setMarks(start);
    }).catch(err => { showToast(err.message, 'error'); onClose(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  const setMark = (ip, i, v) => setMarks(m => ({ ...m, [keyOf(ip, i)]: v }));
  const changed = useMemo(() => {
    const keys = new Set([...Object.keys(initial), ...Object.keys(marks)]);
    return [...keys].filter(k => (initial[k] || 'required') !== (marks[k] || 'required'));
  }, [initial, marks]);

  const familyChanged = family.trim() !== (template.family || '');

  async function save() {
    setSaving(true);
    try {
      const body = changed.map(k => {
        const [p, i] = k.split(':');
        return { path: p.split('.').map(Number), item: Number(i), presence: marks[k] && marks[k] !== 'required' ? marks[k] : null };
      });
      await api(`/api/bom-structure-templates/${template.id}`, { method: 'PATCH', body: { ...(body.length ? { marks: body } : {}), ...(familyChanged ? { family: family.trim() } : {}) } });
      showToast('Saved');
      onSaved?.();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Family and lines — “{template.name}”</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>Subsystem family</Label>
          <Input value={family} onChange={e => setFamily(e.target.value)} placeholder="e.g. FD Fan Blower (leave empty if this is not a subsystem build)" />
        </div>
        <p className="text-sm text-muted-foreground">
          <b>Required</b>: every build has it. <b>Usual</b>: most do — ticked when added. <b>Optional</b>: only some — unticked when added.
          Saving changes the template version; BOMs already built from it are not touched.
        </p>
        {tree === null ? <Skeleton className="h-48 w-full" /> : (
          <div className="max-h-[55vh] overflow-y-auto rounded-md border"><NodeLines nodes={tree} idxPath={[]} depth={0} marks={marks} setMark={setMark} /></div>
        )}
        <DialogFooter className="m-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || (!changed.length && !familyChanged)}>{saving ? 'Saving…' : changed.length ? `Save ${changed.length} line change${changed.length === 1 ? '' : 's'}` : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
