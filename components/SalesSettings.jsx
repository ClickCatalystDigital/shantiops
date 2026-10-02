'use client';

// components/SalesSettings.jsx — the Sales Head's section of the /settings page: Team (members + auto-assign),
// Email (company mailboxes, test/live switch, their own mailbox) and Data retention.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ContactIcon, MailIcon, ClockIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import SalesTeamManager from '@/components/SalesTeamManager';
import SalesRetentionPanel from '@/components/SalesRetentionPanel';
import { EmailSetupTab } from '@/components/SalesSetupPanels';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];


function AutoAssignCard({ users, departments }) {
  const [rules, setRules] = useState({});
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(null);

  function load() {
    api('/api/assignment-rules').then(rows => {
      const byDept = Object.fromEntries(rows.map(r => [r.owner_dept, r]));
      setRules(byDept);
      setDrafts(Object.fromEntries(CRM_DEPARTMENTS.map(d => [d, (byDept[d]?.usernames || []).join(', ')])));
    }).catch(() => {});
  }
  useEffect(load, []);

  async function save(dept) {
    setSaving(dept);
    try {
      const usernames = drafts[dept].split(',').map(s => s.trim()).filter(Boolean);
      await api('/api/assignment-rules', { method: 'PUT', body: { owner_dept: dept, usernames } });
      showToast('Assignment rule saved');
      load();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(null); }
  }

  function toggle(dept, username) {
    const cur = (drafts[dept] || '').split(',').map(x => x.trim()).filter(Boolean);
    const next = cur.includes(username) ? cur.filter(x => x !== username) : [...cur, username];
    setDrafts(prev => ({ ...prev, [dept]: next.join(', ') }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auto-assign</CardTitle>
        <CardDescription>Your {CRM_DEPARTMENTS.filter(d => departments.includes(d)).join(' / ')} people. Tick who new enquiries are shared between, in turn; leave everyone unticked to stop auto-assigning.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {CRM_DEPARTMENTS.filter(d => departments.includes(d)).map(dept => {
          const members = users.filter(u => u.departments.includes(dept));
          const picked = new Set((drafts[dept] || '').split(',').map(x => x.trim()).filter(Boolean));
          return (
            <div key={dept} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{dept} — {members.length} {members.length === 1 ? 'person' : 'people'}</Label>
                <Button size="sm" variant="outline" onClick={() => save(dept)} disabled={saving === dept}>{saving === dept ? 'Saving…' : 'Save auto-assign'}</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead className="w-16 sm:w-24">Auto-assign</TableHead><TableHead>Name</TableHead><TableHead className="hidden sm:table-cell">Username</TableHead><TableHead className="hidden sm:table-cell">Designation</TableHead><TableHead>Role</TableHead></TableRow></TableHeader>
                <TableBody>
                  {members.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No one has {dept} access yet.</TableCell></TableRow> : members.map(u => (
                    <TableRow key={u.id}>
                      <TableCell><Checkbox checked={picked.has(u.username)} onCheckedChange={() => toggle(dept, u.username)} aria-label={`Auto-assign to ${u.display_name || u.username}`} /></TableCell>
                      <TableCell className="font-medium">{u.display_name || u.username}<span className="block text-xs font-normal text-muted-foreground sm:hidden">{u.designation || u.username}</span></TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">{u.username}</TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">{u.designation || '—'}</TableCell>
                      <TableCell><Badge variant={u.departmentRoles?.[dept] === 'head' ? 'default' : 'outline'}>{u.departmentRoles?.[dept] === 'head' ? 'Head' : 'Member'}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}


export default function SalesSettings({ users, meUsername }) {
  return (
    <Tabs defaultValue="team" className="min-w-0">
      <TabsList variant="line" className="w-max">
        <TabsTrigger value="team" className="gap-1.5"><ContactIcon className="size-3.5" />Team</TabsTrigger>
        <TabsTrigger value="email" className="gap-1.5"><MailIcon className="size-3.5" />Email</TabsTrigger>
        <TabsTrigger value="retention" className="gap-1.5"><ClockIcon className="size-3.5" />Data retention</TabsTrigger>
      </TabsList>
      <TabsContent value="team" className="flex flex-col gap-4 pt-2">
        <SalesTeamManager meUsername={meUsername} />
        <AutoAssignCard users={users} departments={['Sales']} />
      </TabsContent>
      <TabsContent value="email" className="pt-2"><EmailSetupTab /></TabsContent>
      <TabsContent value="retention" className="pt-2"><SalesRetentionPanel /></TabsContent>
    </Tabs>
  );
}
