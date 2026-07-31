'use client';

// The bell's "View all" destination — same data as the popover (getNotifications), just more of
// it and full-width. Kept generic off n.title/n.body/n.created_at/n.project_id, no per-kind
// branching, so a future notification kind needs no UI change here.
import { useState } from 'react';
import Link from 'next/link';
import { api, formatDate } from '@/lib/client';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function NotificationsPanel({ initial }) {
  const [data, setData] = useState(initial);

  async function markRead(id) {
    setData(await api('/api/notifications', { method: 'PATCH', body: { id } }));
  }
  async function markAllRead() {
    setData(await api('/api/notifications', { method: 'PATCH', body: {} }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        {data.unread > 0 && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={markAllRead}>Mark all read</Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {data.items.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
        )}
        {data.items.map(n => {
          const rowClass = cn('flex items-start gap-2.5 py-3 text-left hover:bg-muted/40 -mx-2 px-2 rounded', !n.read_at && 'bg-accent/40');
          const row = (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-sm">{n.title}</p>
                {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                <p className="text-[11px] text-muted-foreground">{formatDate(n.created_at)}</p>
              </div>
              {!n.read_at && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
            </>
          );
          return n.project_id ? (
            <Link key={n.id} href={`/projects/${n.project_id}`} onClick={() => !n.read_at && markRead(n.id)} className={rowClass}>
              {row}
            </Link>
          ) : (
            <button key={n.id} onClick={() => !n.read_at && markRead(n.id)} className={rowClass}>
              {row}
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
