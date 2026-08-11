'use client';

// CALC-CHANGES2.md §A — "New Calculation Sheet" dialog on /calc/project/[projectId], same
// Dialog+api()+router.push shape as NewProjectForm.jsx.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusIcon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';

export default function NewCalcSheetForm({ projectId }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { id } = await api('/api/calc-sheets', { method: 'POST', body: { projectId, name: name.trim() } });
      showToast('Calculation sheet created');
      setOpen(false);
      router.push(`/calc/project/${projectId}/${id}`);
    } catch (err) { showToast(err.message, 'error'); setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><PlusIcon data-icon="inline-start" />New Calculation Sheet</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Calculation Sheet</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sheet-name">Name</Label>
            <Input id="sheet-name" placeholder="e.g. Nozzle Design" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
