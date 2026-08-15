'use client';

// Create / deactivate functional-head accounts (PM only). Department access is via the matrix above.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const BLANK = { employeeId: '', username: '', password: '' };

export default function UserManagement({ heads: initialHeads, availableEmployees = [], isAdmin = false }) {
  const router = useRouter();
  const [heads, setHeads] = useState(initialHeads);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/users', { method: 'POST', body: f });
      showToast('System access created and linked to HR');
      setF(BLANK);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function toggleActive(head) {
    const active = !head.active;
    setHeads(hs => hs.map(h => (h.id === head.id ? { ...h, active } : h)));
    try {
      await api(`/api/users/${head.id}`, { method: 'PATCH', body: { active } });
    } catch (err) {
      showToast(err.message, 'error');
      setHeads(hs => hs.map(h => (h.id === head.id ? { ...h, active: head.active } : h)));
    }
  }

  async function toggleSafePass(head) {
    const safe_pass = !head.safe_pass;
    setHeads(hs => hs.map(h => (h.id === head.id ? { ...h, safe_pass } : h)));
    try {
      await api(`/api/users/${head.id}`, { method: 'PATCH', body: { safe_pass } });
    } catch (err) {
      showToast(err.message, 'error');
      setHeads(hs => hs.map(h => (h.id === head.id ? { ...h, safe_pass: head.safe_pass } : h)));
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>User Management</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {heads.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Head</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead>Safe Pass</TableHead>}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {heads.map(h => (
                  <TableRow key={h.id}>
                    <TableCell>{h.display_name || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">@{h.username}</TableCell>
                    <TableCell>{h.active ? 'Active' : 'Deactivated'}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Button variant={h.safe_pass ? 'default' : 'outline'} size="sm" onClick={() => toggleSafePass(h)}>
                          {h.safe_pass ? 'Granted' : 'Grant'}
                        </Button>
                      </TableCell>
                    )}
                    <TableCell><Button variant="outline" size="sm" onClick={() => toggleActive(h)}>{h.active ? 'Deactivate' : 'Reactivate'}</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <form onSubmit={create} className="grid items-end gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
          <div className="flex flex-col gap-1.5"><Label>HR employee *</Label>
            <select required value={f.employeeId} onChange={e => setF({ ...f, employeeId: e.target.value })} className="h-10 rounded-md border bg-background px-3 text-sm">
              <option value="">Select an active HR employee</option>
              {availableEmployees.map(e => <option key={e.id} value={e.id}>{e.name} · {e.employee_code} · {e.department || 'Unassigned'}</option>)}
            </select></div>
          <div className="flex flex-col gap-1.5"><Label>Username *</Label>
            <Input required value={f.username} onChange={e => setF({ ...f, username: e.target.value })} /></div>
          <div className="flex flex-col gap-1.5"><Label>Password *</Label>
            <Input type="password" required minLength={6} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></div>
          <Button disabled={busy || availableEmployees.length === 0}>{busy ? 'Creating…' : 'Create access'}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
