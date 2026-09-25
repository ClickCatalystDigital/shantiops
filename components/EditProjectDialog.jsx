'use client';

// Edit path for a project's own identity/model-spec fields + its Scope of Supply document —
// PM + Design/Engineering heads (matches PATCH /api/projects/[id]'s own requireCalcAccess gate).
// Reuses ProjectFormFields (same fields NewProjectForm renders) and, additively, a one-file
// attach/replace/remove for the project's Scope of Supply header (POST /api/scope-of-supply/[id]).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PencilIcon, FileTextIcon, UploadIcon, XIcon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import ProjectFormFields from '@/components/ProjectFormFields';

export default function EditProjectDialog({ project, customers = [], scopeOfSupply = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    series: project.series || '', model_capacity: project.model_capacity ?? '',
    model_pressure: project.model_pressure ?? '', model_design: project.model_design || '',
    project_no: project.project_no || '', customer_name: project.customer_name || '',
    customer_id: project.customer_id ? String(project.customer_id) : '',
    description: project.description || '', order_date: project.order_date || '',
    company: project.company || 'Shanti Boilers',
    sale_order_id: project.sale_order_id ? String(project.sale_order_id) : '',
    sale_order_label: project.sale_order_no || (project.sale_order_id ? `Order #${project.sale_order_id}` : ''),
  });
  const [busy, setBusy] = useState(false);
  // The document's own header row — mostly always exactly one, auto-created at project creation
  // when there's a Sale Order (§5h); a project without one yet gets its header created on first
  // upload below. Local mirror so upload/delete reflect immediately without waiting on a refetch.
  const [sos, setSos] = useState(scopeOfSupply[0] || null);
  const [sosBusy, setSosBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { sale_order_label, ...body } = f;
      await api(`/api/projects/${project.id}`, { method: 'PATCH', body: { ...body, customer_id: f.customer_id ? Number(f.customer_id) : null, sale_order_id: f.sale_order_id ? Number(f.sale_order_id) : null } });
      showToast('Project updated');
      setOpen(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setBusy(false); }
  }

  async function uploadSos(file) {
    setSosBusy(true);
    try {
      let header = sos;
      if (!header) {
        header = await api('/api/scope-of-supply', {
          method: 'POST', body: { project_id: project.id, title: 'Scope of Supply' },
        });
      }
      const formData = new FormData();
      formData.append('file', file);
      const data = await api(`/api/scope-of-supply/${header.id}/file`, { method: 'POST', body: formData });
      setSos({ id: header.id, pdf_key: data.pdf_key, pdf_url: data.pdf_url });
      showToast('Scope of Supply document attached');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSosBusy(false); }
  }

  async function removeSos() {
    if (!sos?.pdf_key) return;
    setSosBusy(true);
    try {
      await api(`/api/scope-of-supply/${sos.id}/file`, { method: 'DELETE' });
      setSos({ ...sos, pdf_key: null, pdf_url: null });
      showToast('Document removed');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSosBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><PencilIcon data-icon="inline-start" />Edit</Button>
      </DialogTrigger>
      {/* onInteractOutside disabled — see the identical note in NewProjectForm.jsx: the nested
          Selects' own outside-interaction closing can bubble up and close this Dialog too. */}
      <DialogContent className="sm:max-w-2xl" onInteractOutside={e => e.preventDefault()}>
        <DialogHeader><DialogTitle>Edit Project</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <ProjectFormFields f={f} setF={setF} customers={customers} saleOrderPicker="edit" />

          <div className="flex flex-col gap-1.5">
            <Label>Scope of Supply document</Label>
            {sos?.pdf_key ? (
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <a href={sos.pdf_url || `/api/scope-of-supply/${sos.id}/file`} target="_blank" rel="noreferrer"
                  className="flex-1 truncate text-primary hover:underline">
                  {(sos.pdf_key || '').split('/').pop()}
                </a>
                <Button type="button" variant="ghost" size="icon" disabled={sosBusy} onClick={removeSos}>
                  <XIcon className="size-4" />
                </Button>
              </div>
            ) : (
              <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40">
                <UploadIcon className="size-4" />
                {sosBusy ? 'Uploading…' : 'Attach Scope of Supply document'}
                <input type="file" className="hidden" disabled={sosBusy}
                  onChange={e => { const file = e.target.files?.[0]; if (file) uploadSos(file); e.target.value = ''; }} />
              </label>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
