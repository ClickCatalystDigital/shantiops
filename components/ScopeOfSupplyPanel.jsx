'use client';

// The confirmed order's handoff to Design + Engineering — replaces DesignPanel.jsx's inert
// "awaiting Work Order / Scope of Supply format" placeholder. One row is auto-created on project
// creation when a sale_order_id is set (app/api/projects/route.js); this panel is where Design/
// Engineering fill in and release it. `spec` is a plain textarea on purpose — an educated draft,
// not the real boiler-configuration format, which Shanti hasn't provided yet. Shared by both
// departments (same work order, not department-split), so this one component renders in both
// DesignPanel.jsx and DepartmentPanel.jsx's Engineering slot.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

function ScopeCard({ scope, canEdit, router }) {
  const [spec, setSpec] = useState(scope.spec || '');
  const [saving, setSaving] = useState(false);

  async function save(patch) {
    setSaving(true);
    try {
      await api(`/api/scope-of-supply/${scope.id}`, { method: 'PATCH', body: patch });
      showToast('Saved');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-2 rounded border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">{scope.title}</span>
        <Badge variant={scope.status === 'released' ? 'default' : 'outline'}>{scope.status}</Badge>
      </div>
      {canEdit ? (
        <>
          <Textarea
            value={spec} onChange={e => setSpec(e.target.value)} rows={4}
            placeholder="Configuration / specification notes — capacity, pressure, fuel, accessories, anything relevant until the real Scope of Supply format is provided."
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" disabled={saving} onClick={() => save({ spec })}>{saving ? 'Saving…' : 'Save spec'}</Button>
            {scope.status === 'draft' && (
              <Button size="sm" disabled={saving} onClick={() => save({ status: 'released' })}>Release</Button>
            )}
          </div>
        </>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{scope.spec || 'No spec yet.'}</p>
      )}
    </div>
  );
}

export default function ScopeOfSupplyPanel({ projectId, scopeOfSupply = [], canEdit = false }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);

  async function add() {
    if (!title.trim()) return;
    setAdding(true);
    try {
      await api('/api/scope-of-supply', { method: 'POST', body: { project_id: projectId, title: title.trim() } });
      setTitle('');
      showToast('Scope of Supply added');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setAdding(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scope of Supply / Work Order</CardTitle>
        {canEdit && <CardAction className="text-xs text-muted-foreground">Draft format — update once the real WO/SOS format is provided</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {scopeOfSupply.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Scope of Supply yet — created automatically when this project is linked to a Sale Order.</p>
        ) : (
          scopeOfSupply.map(s => <ScopeCard key={s.id} scope={s} canEdit={canEdit} router={router} />)
        )}
        {canEdit && (
          <div className="flex gap-2">
            <Input placeholder="New work order title" value={title} onChange={e => setTitle(e.target.value)} />
            <Button size="sm" variant="outline" disabled={adding} onClick={add}>Add</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
