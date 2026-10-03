'use client';

// Settings → Photo & alerts: profile photo, the address alert emails go to, and per-alert choices
// (bell on/off, email Off / Now / Daily summary). Only the alerts this person can actually receive
// are listed (lib/notification-catalog.mjs, filtered server-side by department and Head role).
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellIcon, BellOffIcon, MailIcon, CameraIcon, ChevronRightIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { OTHER_KIND } from '@/lib/notification-catalog.mjs';

const EMAIL_OPTS = [['off', 'Off'], ['instant', 'Now'], ['daily', 'Daily']];

export function Avatar({ userId, name, version, size = 40, className }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [version]);
  const initials = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (version && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/users/${userId}/avatar?v=${version}`} alt="" style={style} onError={() => setBroken(true)}
      className={cn('shrink-0 rounded-full object-cover ring-1 ring-border', className)} />;
  }
  return <span style={style} className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary ring-1 ring-primary/15', className)}>{initials}</span>;
}

// The Profile card's photo: shows the photo (or initials) with a camera button to change it.
export function ProfilePhoto({ user }) {
  const router = useRouter();
  const [v, setV] = useState(user.avatar_key || null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  async function upload(file) {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/account/avatar', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Upload failed');
      setV(String(Date.now())); showToast('Photo updated'); router.refresh();
    } catch (e) { showToast(e.message, 'error'); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }
  async function remove() {
    try { await api('/api/account/avatar', { method: 'DELETE' }); setV(null); router.refresh(); } catch (e) { showToast(e.message, 'error'); }
  }
  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar userId={user.id} name={user.display_name || user.username} version={v} size={56} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Change photo"
          className="absolute -bottom-1 -right-1 inline-flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground">
          <CameraIcon className="size-3.5" />
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => upload(e.target.files?.[0])} />
      </div>
      <div className="min-w-0">
        <p className="font-medium">{user.display_name || user.username}</p>
        <p className="text-xs text-muted-foreground">@{user.username}</p>
        {v ? <button type="button" onClick={remove} className="text-xs text-muted-foreground underline-offset-2 hover:underline">Remove photo</button>
          : <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="text-xs text-primary underline-offset-2 hover:underline">{busy ? 'Uploading…' : 'Add a photo'}</button>}
      </div>
    </div>
  );
}

function BellSwitch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cn('inline-flex size-8 items-center justify-center rounded-md transition-colors',
        on ? 'text-foreground hover:bg-muted' : 'text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground')}>
      {on ? <BellIcon className="size-4" /> : <BellOffIcon className="size-4" />}
    </button>
  );
}

function Segmented({ value, onChange, disabled, label }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-md bg-muted p-0.5', disabled && 'opacity-50')}>
      {EMAIL_OPTS.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)}
          className={cn('rounded px-2.5 py-1 text-xs font-medium transition-colors',
            value === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {l}
        </button>
      ))}
    </div>
  );
}

export default function AlertSettings() {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(new Set(['General'])); // sections shown expanded
  const toggle = key => setOpen(o => { const n = new Set(o); n.has(key) ? n.delete(key) : n.add(key); return n; });

  useEffect(() => {
    api('/api/account/alerts').then(d => { setData(d); setEmail(d.notify_email); })
      .catch(e => showToast(e.message, 'error'));
  }, []);
  if (!data) return <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading alerts…</CardContent></Card>;

  const pref = kind => ({ in_app: true, email: 'off', ...data.prefs[kind] });
  async function save(kinds, patch) {
    const before = data.prefs;
    const next = { ...before };
    for (const k of kinds) next[k] = { ...pref(k), ...patch };
    setData(d => ({ ...d, prefs: next }));
    try { await api('/api/account/alerts', { method: 'PUT', body: kinds.length === 1 ? { kind: kinds[0], ...patch } : { kinds, ...patch } }); }
    catch (e) { setData(d => ({ ...d, prefs: before })); showToast(e.message, 'error'); }
  }
  async function saveEmail() {
    try { await api('/api/account/alerts', { method: 'PUT', body: { notify_email: email } }); setData(d => ({ ...d, notify_email: email })); showToast(email ? 'Alert email saved' : 'Alert email removed'); }
    catch (e) { showToast(e.message, 'error'); }
  }
  const noEmail = !data.notify_email;
  const groups = [...data.groups, { key: OTHER_KIND, label: 'Everything else', alerts: [{ kind: OTHER_KIND, label: 'Other alerts', hint: 'Anything not listed above.' }] }];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alerts</CardTitle>
        <CardDescription>Choose which alerts reach your bell and which also come by email — right away, or once a day as a morning summary.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-sm">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="alert-email">Send my alert emails to</label>
            <Input id="alert-email" className="h-8" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <Button size="sm" variant="outline" onClick={saveEmail} disabled={email === data.notify_email}>Save</Button>
        </div>

        {(noEmail || !data.email_ready) && (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {noEmail ? 'Add your alert email above to choose email delivery.' : 'Alert emails start once the sender is switched on for this system — your choices are saved and apply from then.'}
          </p>
        )}

        {groups.map(g => {
          const kinds = g.alerts.map(a => a.kind);
          const allEmail = kinds.every(k => pref(k).email === pref(kinds[0]).email) ? pref(kinds[0]).email : null;
          const isOpen = open.has(g.key);
          const bellOn = kinds.filter(k => pref(k).in_app).length;
          const emailOn = kinds.filter(k => pref(k).email !== 'off').length;
          return (
            <section key={g.key} className="flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                <button type="button" onClick={() => toggle(g.key)} aria-expanded={isOpen} className="flex min-w-0 items-center gap-1.5 text-left">
                  <ChevronRightIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                  <h3 className="text-sm font-semibold">{g.label}</h3>
                  <span className="truncate text-xs text-muted-foreground">
                    · {kinds.length} alert{kinds.length === 1 ? '' : 's'} · bell {bellOn === kinds.length ? 'on' : `${bellOn}/${kinds.length}`}{emailOn ? ` · email ${emailOn}` : ''}
                  </span>
                </button>
                {kinds.length > 1 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MailIcon className="size-3.5" /> All
                    <Segmented value={allEmail} disabled={noEmail} label={`Email for all ${g.label} alerts`} onChange={v => save(kinds, { email: v })} />
                  </div>
                )}
              </div>
              {isOpen && <ul className="divide-y">
                {g.alerts.map(a => {
                  const p = pref(a.kind);
                  return (
                    <li key={a.kind} className="flex flex-wrap items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm', !p.in_app && p.email === 'off' && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{a.label}</p>
                        <p className="text-xs text-muted-foreground">{a.hint}</p>
                      </div>
                      <BellSwitch on={p.in_app} label={`Bell for ${a.label}`} onChange={v => save([a.kind], { in_app: v })} />
                      <Segmented value={p.email} disabled={noEmail} label={`Email for ${a.label}`} onChange={v => save([a.kind], { email: v })} />
                    </li>
                  );
                })}
              </ul>}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
