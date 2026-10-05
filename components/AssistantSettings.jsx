'use client';

// Settings → Assistant (admin only): the OpenRouter key and which model answers.
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import SearchableSelect from '@/components/SearchableSelect';
import { api, showToast } from '@/lib/client';

const price = v => (v === null ? 'varies' : v === 0 ? 'free' : `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`);

// Live-data answers: off until the customer's approval is recorded (name, role, who recorded it, when).
function DataAccess({ settings, onChange }) {
  const d = settings.dataAccess || { on: false };
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  async function put(dataAccess) {
    setBusy(true);
    try { onChange(await api('/api/assistant/settings', { method: 'PUT', body: { dataAccess } })); setOpen(false); setName(''); setRole(''); setConfirmed(false); showToast(dataAccess.on ? 'Live-data answers switched on' : 'Live-data answers switched off'); }
    catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border bg-muted/30 p-3 lg:col-span-2">
      <Badge variant={d.on ? 'default' : 'outline'}>{d.on ? 'On' : 'Off'}</Badge>
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Answers about live data (orders, stock, payments)</p>
        {d.on
          ? <p>Approved by {d.approver_name}{d.approver_role ? `, ${d.approver_role}` : ''}. Recorded by {d.recorded_by} on {new Date(d.at).toLocaleString('en-IN')}. For these questions the rows looked up are sent to OpenRouter to be worded. Each person only gets look-ups their department may see.</p>
          : <p>Off. The assistant sends only help text and the question to OpenRouter, never company data. Switching this on sends the rows needed for an answer, so it needs the customer's approval of OpenRouter's terms, recorded here.</p>}
      </div>
      {d.on
        ? <Button size="sm" variant="outline" disabled={busy} onClick={() => put({ on: false })}>Switch off</Button>
        : <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Record approval and switch on</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Record the customer's approval</DialogTitle></DialogHeader>
          <div className="grid gap-3 text-sm">
            <p className="text-muted-foreground">
              With this on, a question such as "how much does a customer owe" sends the matching order, stock or payment rows to OpenRouter and the model it routes to.
              The customer should read <a className="underline" href="https://openrouter.ai/terms" target="_blank" rel="noreferrer">OpenRouter's terms</a> and <a className="underline" href="https://openrouter.ai/privacy" target="_blank" rel="noreferrer">privacy policy</a> first.
            </p>
            <div className="grid gap-1.5"><Label>Approved by (person at the customer)</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" /></div>
            <div className="grid gap-1.5"><Label>Their role</Label><Input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Director" /></div>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
              <span>This person has read OpenRouter's terms and privacy policy and agrees that company data may be sent to OpenRouter to answer questions. This is saved with my username and the time, and written to the audit log.</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy || !name.trim() || !confirmed} onClick={() => put({ on: true, approver_name: name, approver_role: role, confirmed })}>Switch on</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AssistantSettings() {
  const [settings, setSettings] = useState(null);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [mode, setMode] = useState('llm');
  const [saving, setSaving] = useState(false);

  const load = () => api('/api/assistant/settings').then(s => { setSettings(s); setModel(s.model); setMode(s.mode); }).catch(err => showToast(err.message, 'error'));
  useEffect(() => {
    load();
    api('/api/assistant/models').then(r => setModels(r.models)).catch(err => showToast(err.message, 'error'));
  }, []);
  const options = useMemo(() => models.map(m => ({ value: m.id, label: `${m.name} · in ${price(m.in)} / out ${price(m.out)} per million · ${m.id}` })), [models]);
  const picked = models.find(m => m.id === model);

  async function save() {
    setSaving(true);
    try {
      const s = await api('/api/assistant/settings', { method: 'PUT', body: { model, mode, ...(key ? { key } : {}) } });
      setSettings(s); setKey(''); showToast('Assistant settings saved');
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  async function removeKey() {
    setSaving(true);
    try { setSettings(await api('/api/assistant/settings', { method: 'PUT', body: { key: '' } })); showToast('Key removed'); }
    catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  if (!settings) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Help assistant</CardTitle>
        <CardDescription>A chat button at the bottom right that answers from the help guide. Every staff login has it; each person is answered only about their own departments. Admin and the Accounts Head manage the key and the AI credit here.</CardDescription>
        <CardAction><Button size="sm" onClick={save} disabled={saving || (!key && model === settings.model && mode === settings.mode)}>{saving ? 'Saving…' : 'Save'}</Button></CardAction>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <Label>OpenRouter key</Label>
          <div className="flex gap-2">
            <Input type="password" autoComplete="off" value={key} placeholder={settings.hasKey ? 'Saved. Paste a new key to replace it' : 'sk-or-…'} onChange={e => setKey(e.target.value)} />
            {settings.hasKey && <Button size="sm" variant="ghost" disabled={saving} onClick={removeKey}>Remove</Button>}
          </div>
          <p className="text-xs text-muted-foreground">Stored encrypted and never shown again. Create one at openrouter.ai → Keys.</p>
          {settings.hasKey && (
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              {settings.balance ? (
                <>
                  <span className={settings.balance.left <= 0.05 ? 'font-semibold text-destructive' : 'font-semibold'}>
                    ${settings.balance.left.toFixed(2)} left{settings.balance.left <= 0.05 ? ' (too low to answer)' : ''}
                  </span>
                  <span className="text-muted-foreground">${settings.balance.used.toFixed(2)} used of ${settings.balance.bought.toFixed(2)} bought</span>
                </>
              ) : <span className="text-muted-foreground">Credit could not be read. Check the key.</span>}
              <span className="ml-auto flex gap-3">
                <button type="button" className="underline underline-offset-2" onClick={load}>Refresh</button>
                <a href={settings.creditsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">Add credit</a>
              </span>
            </div>
          )}
        </div>
        <div className="grid content-start gap-1.5">
          <Label>Writing model</Label>
          <SearchableSelect value={model} onChange={setModel} options={options} displayValue={picked ? picked.name : model} placeholder="Search models…" />
          <p className="text-xs text-muted-foreground">
            {picked ? `${picked.id} · input ${price(picked.in)}, output ${price(picked.out)} per million tokens · reads up to ${Number(picked.context).toLocaleString('en-IN')} tokens` : model}
          </p>
        </div>
        <div className="grid gap-2 lg:col-span-2">
          <Label>How answers are produced</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {[['llm', 'Decide, then write', 'The decision model finds the right guide section; the writing model words a short answer from it.'],
              ['guide', 'Decide, then show the guide', 'When the decision model is sure, the guide section is shown as it is. The writing model is used only when it is not sure. Cheapest.']].map(([v, title, text]) => (
              <button key={v} type="button" onClick={() => setMode(v)} className={`rounded-lg border p-3 text-left transition-colors ${mode === v ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{text}</p>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Decision model: {settings.jevModel} (fixed). It sorts each question (how-to, live data, greeting, unrelated), then picks the department and the section.
            Greetings, unrelated and live-data questions get a fixed reply with no writing model.
          </p>
        </div>
        <DataAccess settings={settings} onChange={setSettings} />
      </CardContent>
    </Card>
  );
}
