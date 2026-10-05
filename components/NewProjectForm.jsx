'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PlusIcon, UploadIcon, XIcon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import ProjectFormFields from '@/components/ProjectFormFields';
import { defaultCompany } from '@/lib/company-profiles';

// V3_CHANGES.md §12 Phase 2f — customer picker wires the new nullable projects.customer_id.
// customer_name stays required/free-text exactly as before (backward-compat with the 6
// pre-existing projects); picking a customer here just autofills it and sets the id alongside.
export default function NewProjectForm({ customers = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    series: '', is_sib: false, model_capacity: '', model_pressure: '', model_design: '',
    project_no: '', customer_name: '', customer_id: '', description: '', order_date: '',
    company: defaultCompany(), sale_order_id: '', skip_so_file: false,
  });
  const [busy, setBusy] = useState(false);
  const [sosFile, setSosFile] = useState(null); // optional Scope of Supply document, uploaded right after the project is created

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { sale_order_label, ...body } = f;
      const { id, bomTemplates = [], sosId } = await api('/api/projects', { method: 'POST', body });
      let fileFailed = false;
      if (sosFile) {
        try {
          // A project made without a Sale Order has no SoS yet — start one to hold the file.
          const headerId = sosId || (await api('/api/scope-of-supply', { method: 'POST', body: { project_id: id, title: 'Scope of Supply' } })).id;
          const fd = new FormData();
          fd.append('file', sosFile);
          await api(`/api/scope-of-supply/${headerId}/file`, { method: 'POST', body: fd });
        } catch { fileFailed = true; }
      }
      const built = bomTemplates.filter(t => t.nodes);
      const failed = bomTemplates.find(t => t.error);
      showToast(fileFailed ? 'Project created, but the Scope of Supply file did not upload — attach it from Edit Project.' : failed ? `Project created. ${failed.error}` : built.length ? `Project created — BOM tree started from ${built.map(t => t.name).join(', ')}` : 'Project created', failed || fileFailed ? 'error' : undefined);
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
          <ProjectFormFields f={f} setF={setF} customers={customers} saleOrderPicker="new" />
          <div className="flex flex-col gap-1.5">
            <Label>Scope of Supply document <span className="font-normal text-muted-foreground">(optional)</span></Label>
            {sosFile ? (
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="flex-1 truncate">{sosFile.name}</span>
                <Button type="button" variant="ghost" size="icon" onClick={() => setSosFile(null)}><XIcon className="size-4" /></Button>
              </div>
            ) : (
              <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40">
                <UploadIcon className="size-4" />Attach a file
                <input type="file" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) setSosFile(file); e.target.value = ''; }} />
              </label>
            )}
            {f.sale_order_id && !f.skip_so_file && <p className="text-xs text-muted-foreground">Replaces the Order Acknowledgement carried over from the Sale Order, if there is one.</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
