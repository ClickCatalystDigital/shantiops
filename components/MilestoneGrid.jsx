'use client';

// Bulk / spreadsheet edit mode for the whole project — power-user path for many rows at once.
import { useState } from 'react';
import { api, showToast } from '@/lib/client';
import { todayISO } from '@/lib/date';
import StatusBadge from './StatusBadge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STATUSES = ['pending', 'in_progress', 'done', 'blocked'];
// IST, not UTC — see lib/date.js. This is the client-side mirror of the server's auto-stamp rule
// (set the same day the drawer/server would), so it must use the same calendar-day definition.
const today = todayISO;

export default function MilestoneGrid({ milestones }) {
  const [rows, setRows] = useState(milestones);

  async function patch(id, field, value) {
    setRows(rs => rs.map(m => {
      if (m.id !== id) return m;
      const next = { ...m, [field]: value };
      if (field === 'status' && value === 'done' && !next.actual_end) next.actual_end = today();
      return next;
    }));
    try {
      await api(`/api/milestones/${id}`, { method: 'PATCH', body: { [field]: value } });
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Milestone</TableHead><TableHead>Assignee</TableHead>
            <TableHead>Plan Start</TableHead><TableHead>Plan End</TableHead>
            <TableHead>Act Start</TableHead><TableHead>Act End</TableHead>
            <TableHead>Status</TableHead><TableHead>SLA</TableHead><TableHead>Delay Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(m => (
            <TableRow key={m.id}>
              <TableCell className="whitespace-nowrap font-medium">{m.milestone_label}</TableCell>
              <TableCell><Input className="min-w-24" defaultValue={m.assignee || ''}
                onBlur={e => e.target.value !== (m.assignee || '') && patch(m.id, 'assignee', e.target.value)} /></TableCell>
              <TableCell><Input type="date" defaultValue={m.planned_start || ''} onChange={e => patch(m.id, 'planned_start', e.target.value)} /></TableCell>
              <TableCell><Input type="date" defaultValue={m.planned_end || ''} onChange={e => patch(m.id, 'planned_end', e.target.value)} /></TableCell>
              <TableCell><Input type="date" defaultValue={m.actual_start || ''} onChange={e => patch(m.id, 'actual_start', e.target.value)} /></TableCell>
              <TableCell><Input type="date" value={m.actual_end || ''} onChange={e => patch(m.id, 'actual_end', e.target.value)} /></TableCell>
              <TableCell>
                <Select value={m.status} onValueChange={v => patch(m.id, 'status', v)}>
                  <SelectTrigger className="min-w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>)}</SelectContent>
                </Select>
              </TableCell>
              <TableCell><StatusBadge m={m} /></TableCell>
              <TableCell><Input className="min-w-32" defaultValue={m.delay_reason || ''}
                onBlur={e => e.target.value !== (m.delay_reason || '') && patch(m.id, 'delay_reason', e.target.value)} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
