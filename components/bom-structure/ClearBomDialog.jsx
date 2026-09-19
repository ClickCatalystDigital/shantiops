'use client';

// components/bom-structure/ClearBomDialog.jsx — confirmation for "Delete entire BOM". Same Dialog
// shape as SaveBomAsTemplateDialog. onConfirm throws on refusal (the server is all-or-nothing and
// names the reason), so the message is shown inline and the dialog stays open.
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangleIcon } from 'lucide-react';

export default function ClearBomDialog({ projectLabel, itemCount, nodeCount, onClose, onConfirm }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setDeleting(true); setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not delete the BOM.');
    } finally { setDeleting(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && !deleting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete entire BOM?</DialogTitle>
          <DialogDescription>
            This permanently deletes all {nodeCount} node{nodeCount === 1 ? '' : 's'} and {itemCount} item{itemCount === 1 ? '' : 's'} of{' '}
            <span className="font-medium text-foreground">{projectLabel}</span>. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            Consider using <span className="font-medium text-foreground">Save Entire BOM as Template</span> first if you may want this structure again.
          </p>
          <p>
            The delete is refused, and nothing is removed, if the BOM has been released, contains lines raised through Purchase Requests,
            or has any item with downstream activity (quotes, purchase orders, receipts, QC records). Import history is kept.
          </p>
        </div>
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete entire BOM'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
