'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { PlusIcon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import ProjectFormFields from '@/components/ProjectFormFields';

// V3_CHANGES.md §12 Phase 2f — customer picker wires the new nullable projects.customer_id.
// customer_name stays required/free-text exactly as before (backward-compat with the 6
// pre-existing projects); picking a customer here just autofills it and sets the id alongside.
export default function NewProjectForm({ customers = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    series: '', model_capacity: '', model_pressure: '', model_design: '',
    project_no: '', customer_name: '', customer_id: '', description: '', order_date: '',
    company: 'Shanti Boilers',
  });
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await api('/api/projects', { method: 'POST', body: f });
      showToast('Project created');
      setOpen(false);
      router.push(`/projects/${id}`);
    } catch (err) { showToast(err.message, 'error'); setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><PlusIcon data-icon="inline-start" />New Project</Button>
      </DialogTrigger>
      {/* onInteractOutside disabled — this form has 3 native Selects nested inside the dialog;
          Radix's own outside-interaction detection for those (even with modal={false} on each)
          still sometimes bubbles up and closes this Dialog too when a click lands elsewhere in the
          form while a dropdown is open. Escape / Cancel / X / submit still all close normally. */}
      <DialogContent className="sm:max-w-2xl" onInteractOutside={e => e.preventDefault()}>
        <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <ProjectFormFields f={f} setF={setF} customers={customers} />
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
