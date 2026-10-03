'use client';

// Sales → WhatsApp. Left: conversations (a member's own; the Sales Head sees everyone's and can hand
// one over). Right: the thread. Inside 24 hours of the customer's last message you type freely; after
// that WhatsApp only accepts an approved template, so the box switches to a template picker.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, CheckIcon, CheckCheckIcon, AlertCircleIcon, MessageCircleIcon, PlusIcon, SendIcon, SearchIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { cn } from '@/lib/utils';
import { fillTemplate } from '@/lib/whatsapp.mjs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const utc = s => new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}Z`);
const IST = 'Asia/Kolkata';
const dayKey = d => d.toLocaleDateString('en-CA', { timeZone: IST });
const timeOf = s => utc(s).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' });
function when(s) {
  if (!s) return '';
  const d = utc(s);
  return dayKey(d) === dayKey(new Date()) ? timeOf(s) : d.toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
}
const nameOf = c => c.lead_name || c.customer_name || c.contact_name || `+${c.wa_id}`;

function Tick({ m }) {
  if (m.direction !== 'out') return null;
  if (m.status === 'failed') return <AlertCircleIcon className="size-3.5 text-danger" />;
  if (m.status === 'read') return <CheckCheckIcon className="size-3.5 text-primary" />;
  if (m.status === 'delivered') return <CheckCheckIcon className="size-3.5" />;
  return <CheckIcon className="size-3.5" />;
}

function NewChatDialog({ open, onOpenChange, accounts, onCreated }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState(accounts[0]?.company || '');
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const r = await api('/api/whatsapp/conversations', { method: 'POST', body: { phone, name, company } });
      setPhone(''); setName(''); onOpenChange(false); onCreated(r.id);
    } catch (e) { showToast(e.message, 'error'); }
    setBusy(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New conversation</DialogTitle><DialogDescription>The first message to a customer must be one of your approved templates.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1"><Label>Mobile number</Label><Input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="98765 43210" /></div>
          <div className="grid gap-1"><Label>Name (optional)</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          {accounts.length > 1 && (
            <div className="grid gap-1"><Label>Send from</Label>
              <Select value={company} onValueChange={setCompany}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{accounts.map(a => <SelectItem key={a.company} value={a.company}>{a.company} · {a.display_phone}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter><Button disabled={busy || !phone.trim()} onClick={create}>{busy ? 'Opening…' : 'Open conversation'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Composer({ conv, windowOpen, onSent }) {
  const [text, setText] = useState('');
  const [templates, setTemplates] = useState(null);
  const [tplKey, setTplKey] = useState('');
  const [params, setParams] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (windowOpen) return;
    api(`/api/whatsapp/templates?conversation=${conv.id}`).then(setTemplates).catch(e => { setTemplates([]); showToast(e.message, 'error'); });
  }, [conv.id, windowOpen]);
  const tpl = templates?.find(t => `${t.name}|${t.language}` === tplKey);

  async function send(body) {
    setBusy(true);
    try { await api(`/api/whatsapp/conversations/${conv.id}`, { method: 'POST', body }); setText(''); setParams([]); onSent(); }
    catch (e) { showToast(e.message, 'error'); }
    setBusy(false);
  }

  if (windowOpen) {
    return (
      <form className="flex items-end gap-2 border-t p-3" onSubmit={e => { e.preventDefault(); if (text.trim()) send({ text }); }}>
        <Textarea rows={1} value={text} onChange={e => setText(e.target.value)} placeholder="Type a message" className="max-h-32 min-h-9 flex-1 resize-none"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim() && !busy) send({ text }); } }} />
        <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Send"><SendIcon /></Button>
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t p-3">
      <p className="text-xs text-muted-foreground">{conv.last_inbound_at ? 'More than 24 hours since the customer last wrote.' : 'The customer has not written yet.'} WhatsApp only allows an approved template now. Once they reply you can type freely.</p>
      {templates === null ? <p className="text-xs text-muted-foreground">Loading templates…</p>
        : templates.length === 0 ? <p className="text-xs text-muted-foreground">No approved templates yet. Create one in WhatsApp Manager → Message templates.</p> : (
        <>
          <Select value={tplKey} onValueChange={v => { setTplKey(v); setParams([]); }}>
            <SelectTrigger><SelectValue placeholder="Choose a template" /></SelectTrigger>
            <SelectContent>{templates.map(t => <SelectItem key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language})</SelectItem>)}</SelectContent>
          </Select>
          {tpl && (
            <>
              {Array.from({ length: tpl.params }, (_, i) => (
                <Input key={i} placeholder={`Value for {{${i + 1}}}`} value={params[i] || ''} onChange={e => setParams(p => { const n = [...p]; n[i] = e.target.value; return n; })} />
              ))}
              <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">{fillTemplate(tpl.body, params.map((v, i) => v || `{{${i + 1}}}`))}</p>
              <div><Button size="sm" disabled={busy} onClick={() => send({ template: { name: tpl.name, language: tpl.language, params } })}><SendIcon data-icon="inline-start" />{busy ? 'Sending…' : 'Send template'}</Button></div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Thread({ conv, seesAll, people, onBack, onChanged }) {
  const [data, setData] = useState(null);
  const endRef = useRef(null);
  const count = useRef(0);
  const load = useCallback(() => api(`/api/whatsapp/conversations/${conv.id}`).then(setData).catch(() => {}), [conv.id]);
  useEffect(() => { setData(null); count.current = 0; load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    const n = data?.messages.length || 0;
    if (n !== count.current) { count.current = n; endRef.current?.scrollIntoView({ block: 'end' }); }
  }, [data]);

  async function reassign(username) {
    try { await api(`/api/whatsapp/conversations/${conv.id}`, { method: 'PATCH', body: { assigned_to: username } }); showToast('Handed over'); onChanged(); }
    catch (e) { showToast(e.message, 'error'); }
  }

  let lastDay = null;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-3 py-2.5">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Back"><ArrowLeftIcon /></Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{nameOf(conv)}</p>
          <p className="truncate text-xs text-muted-foreground">+{conv.wa_id}{conv.lead_name ? ' · enquiry on file' : conv.customer_name ? ' · customer' : ' · not in Sales yet'}</p>
        </div>
        {seesAll ? (
          <Select value={conv.assigned_to || ''} onValueChange={reassign}>
            <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Unassigned" /></SelectTrigger>
            <SelectContent>{people.map(p => <SelectItem key={p.username} value={p.username}>{p.display_name || p.username}</SelectItem>)}</SelectContent>
          </Select>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto bg-muted/30 px-3 py-3">
        {!data ? <p className="m-auto text-sm text-muted-foreground">Loading…</p>
          : data.messages.length === 0 ? <p className="m-auto text-sm text-muted-foreground">No messages yet. Send a template to start.</p>
          : data.messages.map(m => {
            const day = dayKey(utc(m.created_at));
            const showDay = day !== lastDay; lastDay = day;
            const out = m.direction === 'out';
            return (
              <div key={m.id} className="flex flex-col">
                {showDay && <p className="my-2 self-center rounded-full bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border">{utc(m.created_at).toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' })}</p>}
                <div className={cn('max-w-[78%] rounded-2xl px-3 py-1.5 text-sm shadow-xs', out ? 'self-end rounded-br-sm bg-primary/10' : 'self-start rounded-bl-sm bg-background ring-1 ring-border')}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                    {out && seesAll && m.sent_by_name ? `${m.sent_by_name} · ` : ''}{timeOf(m.created_at)}<Tick m={m} />
                  </p>
                  {m.error && <p className="text-[11px] text-danger">Not delivered: {m.error}</p>}
                </div>
              </div>
            );
          })}
        <div ref={endRef} />
      </div>
      {data && <Composer key={`${conv.id}:${data.windowOpen}`} conv={conv} windowOpen={data.windowOpen} onSent={() => { load(); onChanged(); }} />}
    </div>
  );
}

export default function WhatsAppInbox({ isSalesHead }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [q, setQ] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [people, setPeople] = useState([]);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(() => api('/api/whatsapp/conversations').then(setData).catch(e => setError(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (data?.seesAll && !people.length) api('/api/sales-users').then(setPeople).catch(() => {}); }, [data?.seesAll, people.length]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.conversations || []).filter(c => (!mineOnly || c.assigned_to === data.me)
      && (!term || nameOf(c).toLowerCase().includes(term) || c.wa_id.includes(term.replace(/\D/g, '') || '~')));
  }, [data, q, mineOnly]);
  const active = data?.conversations.find(c => c.id === activeId);

  if (error) return <Card className="p-6 text-sm text-muted-foreground">{error}</Card>;
  if (!data) return <Card className="p-6 text-sm text-muted-foreground">Loading WhatsApp…</Card>;
  if (!data.accounts.length) {
    return (
      <Card className="items-center gap-2 p-10 text-center">
        <MessageCircleIcon className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">WhatsApp is not connected yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">{isSalesHead ? 'Connect your business number in Settings → Sales → WhatsApp. It takes about 15 minutes.' : 'Ask the Sales Head to connect the business number in Settings.'}</p>
        {isSalesHead && <Button asChild size="sm" className="mt-2"><a href="/settings">Open Settings</a></Button>}
      </Card>
    );
  }

  return (
    <Card className="h-[calc(100dvh-13rem)] min-h-[28rem] flex-row gap-0 overflow-hidden p-0">
      <div className={cn('flex w-full min-w-0 flex-col border-r md:w-80 md:shrink-0', active && 'hidden md:flex')}>
        <div className="flex items-center gap-2 border-b p-2.5">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or number" className="h-8 pl-8" />
          </div>
          <Button size="icon" variant="outline" className="size-8" onClick={() => setNewOpen(true)} aria-label="New conversation"><PlusIcon /></Button>
        </div>
        {data.seesAll && (
          <div className="flex gap-1 border-b px-2.5 py-1.5 text-xs">
            {[['Everyone', false], ['Mine', true]].map(([label, v]) => (
              <button key={label} type="button" onClick={() => setMineOnly(v)} className={cn('rounded-full px-2.5 py-0.5', mineOnly === v ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted')}>{label}</button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">{data.conversations.length ? 'Nothing matches.' : 'No conversations yet. They appear here when a customer writes to your number.'}</p>
            : list.map(c => (
              <button key={c.id} type="button" onClick={() => setActiveId(c.id)}
                className={cn('flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left hover:bg-muted/60', c.id === activeId && 'bg-muted')}>
                <span className="flex items-baseline gap-2">
                  <span className={cn('min-w-0 flex-1 truncate text-sm', c.unread ? 'font-semibold' : 'font-medium')}>{nameOf(c)}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{when(c.last_message_at)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{c.last_text || 'No messages yet'}</span>
                  {c.unread > 0 && <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">{c.unread}</span>}
                </span>
                {data.seesAll && <span className="truncate text-[11px] text-muted-foreground">{c.assigned_name || c.assigned_to || 'Unassigned'}</span>}
              </button>
            ))}
        </div>
      </div>
      {active ? <Thread key={active.id} conv={active} seesAll={data.seesAll} people={people} onBack={() => setActiveId(null)} onChanged={load} />
        : <div className="hidden flex-1 items-center justify-center text-sm text-muted-foreground md:flex">Pick a conversation</div>}
      <NewChatDialog open={newOpen} onOpenChange={setNewOpen} accounts={data.accounts} onCreated={id => { load().then(() => setActiveId(id)); }} />
    </Card>
  );
}
