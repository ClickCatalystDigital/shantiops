'use client';

// Settings → Connect Claude or ChatGPT: the MCP address to add as a connector, and this login's connections.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export default function AiConnections() {
  const [rows, setRows] = useState(null);
  const [url, setUrl] = useState('');
  const load = () => fetch('/api/assistant/connections').then(r => r.json()).then(d => setRows(d.connections || [])).catch(() => setRows([]));
  useEffect(() => { setUrl(`${window.location.origin}/mcp`); load(); }, []);
  const disconnect = async id => { await fetch(`/api/assistant/connections?id=${id}`, { method: 'DELETE' }); load(); };
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm">
      <p className="text-muted-foreground">Use SB Ops from Claude or ChatGPT: in the AI app add a custom connector with this address, then sign in here and press Allow. It acts as you, answers like Ember AI, and every change is shown to you there first and made only when you confirm.</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-md border bg-muted px-2.5 py-1.5 text-xs">{url}</code>
        <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(url)}>Copy</Button>
      </div>
      <div>
        <p className="mb-1.5 font-medium">Connected apps</p>
        {rows === null ? <p className="text-muted-foreground">Loading…</p> : !rows.length ? <p className="text-muted-foreground">None yet.</p> : (
          <ul className="flex flex-col divide-y">
            {rows.map(r => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span>{r.name}<span className="ml-2 text-xs text-muted-foreground">since {String(r.created_at).slice(0, 10)}{r.last_used_at ? ` · last used ${String(r.last_used_at).slice(0, 10)}` : ''}</span></span>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => disconnect(r.id)}>Disconnect</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
