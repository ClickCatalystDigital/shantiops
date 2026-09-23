'use client';

// components/MarketingWorkspace.jsx — Marketing's own workspace, split off from
// components/SalesWorkspace.jsx (2026-09-24) so Marketing has its own tab/URL (/market) instead
// of sharing Sales' /sales route. Campaigns/AddCampaignDialog moved here verbatim, unchanged —
// they never depended on any Sales-only state.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { PlusIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';

function AddCampaignDialog({ onClose, router }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!name.trim()) return showToast('Name is required', 'error');
    setSaving(true);
    try {
      await api('/api/campaigns', { method: 'POST', body: { name: name.trim() } });
      showToast('Campaign added');
      router.refresh();
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Campaign</DialogTitle></DialogHeader>
        <div className="grid gap-1.5"><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Campaign'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignsTab({ campaigns, router }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaigns</CardTitle>
        <CardAction><Button size="sm" onClick={() => setDialogOpen(true)}><PlusIcon />New Campaign</Button></CardAction>
      </CardHeader>
      <CardContent>
        {campaigns.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No campaigns yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Owner</TableHead></TableRow></TableHeader>
            <TableBody>
              {campaigns.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{c.owner_dept}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {dialogOpen && <AddCampaignDialog router={router} onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

export default function MarketingWorkspace({ campaigns = [] }) {
  const router = useRouter();
  return <CampaignsTab campaigns={campaigns} router={router} />;
}
