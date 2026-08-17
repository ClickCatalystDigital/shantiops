'use client';

// A small "+" next to a Select for the masters that had no admin UI at all — operations,
// workstations, trades. Posts { name } to `endpoint`, then hands the new row back via onAdded so
// the caller can select it immediately instead of just refreshing into an unchanged picker.
import { useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { PlusIcon } from 'lucide-react';

export default function QuickAddInline({ endpoint, placeholder, onAdded }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return showToast('Name is required', 'error');
    setBusy(true);
    try {
      const { id } = await api(endpoint, { method: 'POST', body: { name: name.trim() } });
      onAdded({ id, name: name.trim() });
      setName('');
      setOpen(false);
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Add new"><PlusIcon /></Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <form onSubmit={submit} className="flex gap-2">
          <Input autoFocus placeholder={placeholder} value={name} onChange={e => setName(e.target.value)} />
          <Button type="submit" size="sm" disabled={busy}>{busy ? '…' : 'Add'}</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
