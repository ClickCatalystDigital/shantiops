'use client';

// The nav bell — unread ticket notifications, polled every ~20s. Uses a plain fetch, not
// router.refresh(): Nav is mounted on every page, so a refresh tick here would re-fetch every
// page's server data on a timer, unlike the 5s router.refresh() polls elsewhere in the app which
// each sit on a single force-dynamic page. Identity comes from the httpOnly cookie server-side —
// no user prop needed here.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BellIcon, BellOffIcon } from 'lucide-react';
import { api, formatDate } from '@/lib/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { beep, warmAudio } from '@/lib/beep';

const POLL_MS = 20000;

export default function NotificationBell() {
  const [data, setData] = useState({ unread: 0, items: [] });
  const [muted, setMuted] = useState(false);
  const prevUnread = useRef(null); // null = "haven't polled yet" — never chime on the first load

  useEffect(() => {
    setMuted(localStorage.getItem('notifySound') === 'off');
    const warm = () => warmAudio();
    document.addEventListener('pointerdown', warm, { once: true });

    let alive = true;
    const tick = () => api('/api/notifications').then(d => {
      if (!alive) return;
      // Chime only on an INCREASE, and never on the page's first load holding pre-existing
      // unread — otherwise every navigation would chime.
      if (prevUnread.current !== null && d.unread > prevUnread.current
        && localStorage.getItem('notifySound') !== 'off') beep();
      prevUnread.current = d.unread;
      setData(d);
    }).catch(() => {});
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(t); document.removeEventListener('pointerdown', warm); };
  }, []);

  async function markRead(id) {
    setData(await api('/api/notifications', { method: 'PATCH', body: { id } }));
  }
  async function markAllRead() {
    setData(await api('/api/notifications', { method: 'PATCH', body: {} }));
  }
  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStorage.setItem('notifySound', next ? 'off' : 'on');
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label="Notifications">
          <BellIcon />
          {data.unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center
                             rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white tnum">
              {data.unread > 9 ? '9+' : data.unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-end gap-1 px-3 py-2.5">
          <Button variant="ghost" size="icon-sm" aria-label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
            {muted ? <BellOffIcon className="size-3.5" /> : <BellIcon className="size-3.5" />}
          </Button>
          {data.unread > 0 && (
            <button onClick={markAllRead} className="text-xs text-primary hover:underline">Mark all read</button>
          )}
        </div>
        <div className="flex max-h-80 flex-col divide-y overflow-y-auto border-t">
          {data.items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
          )}
          {data.items.map(n => (
            <Link key={n.id} href={n.project_id ? `/projects/${n.project_id}` : '/notifications'}
              onClick={() => !n.read_at && markRead(n.id)}
              className={cn('flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-muted', !n.read_at && 'bg-accent/40')}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{n.title}</p>
                {n.body && <p className="truncate text-xs text-muted-foreground">{n.body}</p>}
                <p className="text-[11px] text-muted-foreground">{formatDate(n.created_at)}</p>
              </div>
              {!n.read_at && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
            </Link>
          ))}
        </div>
        <Link href="/notifications" className="block px-3 py-2 text-center text-xs text-muted-foreground hover:bg-muted">
          View all
        </Link>
      </PopoverContent>
    </Popover>
  );
}
