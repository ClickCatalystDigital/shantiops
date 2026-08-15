'use client';

import { useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function DesignAccessPanel({ members: initialMembers = [] }) {
  const [members, setMembers] = useState(initialMembers);
  const [busy, setBusy] = useState(null);

  async function toggle(member) {
    if (!member.user_id) return;
    const enabled = String(member.departments || '').split(',').includes('Design');
    const nextDepartments = enabled ? String(member.departments || '').split(',').filter(d => d && d !== 'Design') : [...String(member.departments || '').split(',').filter(Boolean), 'Design'];
    setBusy(member.user_id);
    try {
      await api(`/api/users/${member.user_id}`, { method: 'PATCH', body: { departments: nextDepartments, departmentRoles: enabled ? {} : { Design: 'designer' } } });
      setMembers(ms => ms.map(m => m.id === member.id ? { ...m, departments: nextDepartments.join(','), departmentRoles: enabled ? {} : { Design: 'designer' } } : m));
      showToast(enabled ? 'Designer access removed' : 'Designer access granted');
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(null);
  }

  return <Card>
    <CardHeader><CardTitle>Design team access</CardTitle><p className="text-sm text-muted-foreground">Grant or remove Designer access for active Design employees already linked to a system account.</p></CardHeader>
    <CardContent className="overflow-x-auto">
      <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>HR status</TableHead><TableHead>System access</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>{members.map(m => {
          const enabled = String(m.departments || '').split(',').includes('Design');
          return <TableRow key={m.id}><TableCell><div className="font-medium">{m.name}</div><div className="text-xs text-muted-foreground">{m.employee_code}</div></TableCell><TableCell>{m.user_id ? 'Linked' : 'No login account'}</TableCell><TableCell>{enabled ? 'Designer' : 'Not granted'}</TableCell><TableCell className="text-right"><Button size="sm" variant={enabled ? 'outline' : 'default'} disabled={!m.user_id || busy === m.user_id} onClick={() => toggle(m)}>{!m.user_id ? 'Ask admin to link' : enabled ? 'Remove access' : 'Grant access'}</Button></TableCell></TableRow>;
        })}</TableBody>
      </Table>
    </CardContent>
  </Card>;
}
