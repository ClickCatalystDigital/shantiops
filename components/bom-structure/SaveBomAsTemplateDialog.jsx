'use client';

// components/bom-structure/SaveBomAsTemplateDialog.jsx — captures a project's ENTIRE current BOM
// (every top-level root + full descendants) as one whole-BOM Structure Template. Same Dialog shape
// as SaveAsTemplateDialog.jsx, minus the level picker — a whole-BOM template is always level=System
// (the only level "Build from Templates" applies at the project root), so there's nothing to choose.
import { useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function SaveBomAsTemplateDialog({ rootCount, onClose, onSave }) {
  const [name, setName] = useState('');
  const [series, setSeries] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), series: series.trim() || null, description: description.trim() || null });
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Save entire BOM as a template</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Captures all {rootCount} top-level node{rootCount === 1 ? '' : 's'} of this project's current BOM, with every
            descendant and item, as one reusable package — appears in "Build from Templates" alongside single-System templates.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label>Template name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. SF-500kg/hr Complete Package" />
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
