'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProfilePhoto } from '@/components/AlertSettings';

export default function ProfileForm({ user }) {
  const router = useRouter();
  const [f, setF] = useState({ display_name: user.display_name || '', contact_number: user.contact_number || '' });
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/account/profile', { method: 'PATCH', body: f });
      showToast('Profile updated');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ProfilePhoto user={user} />
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5"><Label>Display Name</Label>
              <Input value={f.display_name} onChange={e => setF({ ...f, display_name: e.target.value })} /></div>
            <div className="flex flex-col gap-1.5"><Label>Contact Number</Label>
              <Input value={f.contact_number} onChange={e => setF({ ...f, contact_number: e.target.value })} /></div>
          </div>
          <div><Button disabled={busy}>{busy ? 'Saving…' : 'Save Profile'}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}
