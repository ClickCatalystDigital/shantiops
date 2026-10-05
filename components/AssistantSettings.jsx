'use client';

// Settings → Assistant (admin only): the OpenRouter key and which model answers.
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import SearchableSelect from '@/components/SearchableSelect';
import { api, showToast } from '@/lib/client';

const price = v => (v === null ? 'varies' : v === 0 ? 'free' : `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`);

export default function AssistantSettings() {
  const [settings, setSettings] = useState(null);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [mode, setMode] = useState('llm');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/api/assistant/settings').then(s => { setSettings(s); setModel(s.model); setMode(s.mode); }).catch(err => showToast(err.message, 'error'));
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
        <CardDescription>A chat button at the bottom right that answers from the help guide. Only admin sees it for now.</CardDescription>
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
            <p className={`text-xs ${settings.balance !== null && settings.balance <= 0.05 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
              {settings.balance === null ? 'Balance could not be read.' : `Balance: $${settings.balance.toFixed(2)}${settings.balance <= 0.05 ? '. Too low to answer.' : ''}`}{' '}
              <a href={settings.creditsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">Add credit</a>
            </p>
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
        <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3 lg:col-span-2">
          <Badge variant="outline">Off</Badge>
          <div className="text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Answers about live data (orders, stock, payments)</p>
            <p>Not available yet. The assistant sends only help text and the question to OpenRouter, never company data. Turning this on will need the customer's recorded approval of OpenRouter's terms.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
