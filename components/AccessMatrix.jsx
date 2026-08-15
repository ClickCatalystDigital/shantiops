'use client';

// Rows: functional heads. Columns: departments. Toggling a cell grants/revokes department access.
import { useState } from 'react';
import { api, showToast } from '@/lib/client';
import { DEPARTMENTS } from '@/lib/milestones';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function AccessMatrix({ heads: initialHeads, canAssignHead = false }) {
  const [heads, setHeads] = useState(initialHeads);

  async function toggle(head, dept) {
    const has = head.departments.includes(dept);
    const next = has ? head.departments.filter(d => d !== dept) : [...head.departments, dept];
    setHeads(hs => hs.map(h => (h.id === head.id ? { ...h, departments: next } : h)));
    try {
      await api(`/api/users/${head.id}`, { method: 'PATCH', body: { departments: next } });
    } catch (err) {
      showToast(err.message, 'error');
      setHeads(hs => hs.map(h => (h.id === head.id ? { ...h, departments: head.departments } : h)));
    }
  }

  async function setDepartmentRole(head, dept, role) {
    const nextRoles = { ...head.departmentRoles, [dept]: role };
    setHeads(hs => hs.map(h => h.id === head.id ? { ...h, departmentRoles: nextRoles } : h));
    try { await api(`/api/users/${head.id}`, { method: 'PATCH', body: { departmentRoles: nextRoles } }); }
    catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Access Matrix</CardTitle></CardHeader>
      <CardContent>
        {heads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No functional heads yet — create one below.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Head</TableHead>
                  {DEPARTMENTS.map(d => <TableHead key={d} className="text-center">{d}</TableHead>)}
                  <TableHead>Design responsibility</TableHead>
                  <TableHead>Engineering responsibility</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {heads.map(h => (
                  <TableRow key={h.id}>
                    <TableCell>
                      <div className="font-medium">{h.display_name || h.username}</div>
                      <div className="text-xs text-muted-foreground">@{h.username}</div>
                    </TableCell>
                    {DEPARTMENTS.map(d => (
                      <TableCell key={d} className="text-center">
                        <Checkbox checked={h.departments.includes(d)} onCheckedChange={() => toggle(h, d)} />
                      </TableCell>
                    ))}
                    <TableCell>
                      <select
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                        value={h.departmentRoles?.Design || 'designer'}
                        disabled={!canAssignHead || !h.departments.includes('Design')}
                        onChange={e => setDepartmentRole(h, 'Design', e.target.value)}
                      >
                        <option value="designer">Designer</option>
                        <option value="head">Design Head</option>
                      </select>
                    </TableCell>
                    <TableCell>
                      <select className="h-8 rounded-md border bg-background px-2 text-xs" value={h.departmentRoles?.Engineering || 'designer'} disabled={!canAssignHead || !h.departments.includes('Engineering')} onChange={e => setDepartmentRole(h, 'Engineering', e.target.value)}>
                        <option value="designer">Engineer</option><option value="head">Engineering Head</option>
                      </select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
