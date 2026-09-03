'use client';

// components/bom-structure/SaveAsTemplateDialog.jsx — captures the selected node (its own name/type
// + every descendant + their items) as a new Structure Template. Same Dialog shape
// MoveAssemblyDialog.jsx already uses, not a new pattern.
import { useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NODE_TYPE_SUGGESTIONS, effectiveNodeLevel } from '@/lib/bom-tree.mjs';

export default function SaveAsTemplateDialog({ node, byId, onClose, onSave }) {
  const [name, setName] = useState(node.name);
  const [level, setLevel] = useState(effectiveNodeLevel(node, byId));
  const [series, setSeries] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), level, series: series.trim() || null, description: description.trim() || null });
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Save "{node.name}" as a template</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Template name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. Standard 500kg/hr Boiler" />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Level</p>
            <div className="flex flex-wrap gap-1.5">
              {NODE_TYPE_SUGGESTIONS.map(l => (
                <button
                  key={l} type="button" onClick={() => setLevel(l)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${level === l ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Model / series (optional)</Label>
            <Input value={series} onChange={e => setSeries(e.target.value)} placeholder="e.g. SF" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save template'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
