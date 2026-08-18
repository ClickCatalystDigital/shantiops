'use client';

// Settings card: per-action Responsibility gate. One department at a time (only Procurement is
// wired to actually enforce anything so far — lib/action-permissions.js's ACTION_CATALOG is the
// list this reads; adding a department there and to the routes it covers is what "wiring in" a
// new department means, this card itself needs no change). requires_head=false (the default, no
// row yet) means "everyone with department access" — same open-by-default behavior every one of
// these actions had before this table existed.
import { useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function ActionPermissionsPanel({ catalog, permissions: initialPermissions }) {
  const departments = Object.keys(catalog);
  const [department, setDepartment] = useState(departments[0] || '');
  const [permissions, setPermissions] = useState(initialPermissions);

  function requiresHead(dept, key) {
    return !!permissions.find(p => p.department === dept && p.action_key === key)?.requires_head;
  }

  async function setAction(actionKey, value) {
    const requires_head = value === 'head';
    setPermissions(prev => {
      const next = prev.filter(p => !(p.department === department && p.action_key === actionKey));
      next.push({ department, action_key: actionKey, requires_head });
      return next;
    });
    try {
      await api('/api/action-permissions', {
        method: 'PATCH',
        body: { department, action_key: actionKey, requires_head },
      });
    } catch (err) { showToast(err.message, 'error'); }
  }

  if (!departments.length) return null;

  return (
    <Card>
      <CardHeader><CardTitle>Action Permissions</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          A Head can always do everything below. Set an action to "Head only" to keep it out of a
          Member's hands — everything not touched here stays open to anyone with department access.
        </p>
        {departments.length > 1 && (
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <div className="flex flex-col divide-y rounded-md border">
          {catalog[department].map(a => (
            <div key={a.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm">{a.label}</span>
              <select
                className="h-8 rounded-md border bg-background px-2 text-xs"
                value={requiresHead(department, a.key) ? 'head' : 'everyone'}
                onChange={e => setAction(a.key, e.target.value)}
              >
                <option value="everyone">Everyone</option>
                <option value="head">Head only</option>
              </select>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
