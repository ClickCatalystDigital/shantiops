'use client';

// components/DeleteTemplateDialog.jsx — confirmation for the bin on BOM templates (Structure Templates
// and flat BOM/PR templates). `usage` is the human phrase for where the template is already used
// ("6 nodes in 1 project" / "4 BOM lines"), or null when unused. A used template is archived by the
// server (hidden from every list, record kept so those BOMs keep their template reference); an unused
// one is truly deleted — the wording and the button follow that so the user is never surprised.
// onConfirm throws on failure so the message shows inline and the dialog stays open.
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangleIcon } from 'lucide-react';

export default function DeleteTemplateDialog({ name, usage, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const used = !!usage;

  async function submit() {
    setBusy(true); setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not delete the template.');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{used ? 'Remove this template?' : 'Delete this template?'}</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{name}</span>
            {used
              ? ` is already used on ${usage}. It will be removed from the template list and can no longer be applied, but those BOMs keep their content and template reference — nothing in them changes.`
              : ' is not used in any BOM. It will be permanently deleted and cannot be recovered.'}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? 'Working…' : used ? 'Remove template' : 'Delete template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
