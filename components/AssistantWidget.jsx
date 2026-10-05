'use client';

// The help assistant: a button at the bottom right that opens a chat panel, for every staff login
// (app/layout.js; not customers). Admin also sees how each answer was routed. The conversation lives in this component's state, so it
// lasts until the page is reloaded and is never stored.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { MessageCircleQuestionIcon, XIcon, SendIcon, RotateCcwIcon } from 'lucide-react';

export default function AssistantWidget({ showRoute = false }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { role, content, sources?, error? }
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, open]);
  // On a phone the panel covers the screen: stop the page behind it from scrolling.
  useEffect(() => {
    if (!open || !window.matchMedia('(max-width: 767px)').matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  async function send(preset) {
    const q = (typeof preset === 'string' ? preset : text).trim();
    if (!q || busy) return;
    const history = [...messages.filter(m => !m.error), { role: 'user', content: q }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setText(''); setBusy(true);
    const patch = p => setMessages(ms => ms.map((m, i) => (i === ms.length - 1 ? { ...m, ...(typeof p === 'function' ? p(m) : p) } : m)));
    try {
      const res = await fetch('/api/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), path }) });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw Object.assign(new Error(e?.error || `Request failed (${res.status})`), { link: e?.link, linkLabel: e?.linkLabel });
      }
      let sources = [];
      try { sources = JSON.parse(decodeURIComponent(res.headers.get('x-sources') || '%5B%5D')); } catch { /* no sources */ }
      const route = decodeURIComponent(res.headers.get('x-route') || '');
      const reader = res.body.getReader(), decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        patch(m => ({ content: m.content + chunk }));
      }
      patch(m => ({ sources, route, content: m.content.trim() || 'No answer came back. Try again or pick another model in Settings.' }));
    } catch (err) {
      patch({ content: err.message, error: true, link: err.link, linkLabel: err.linkLabel });
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="icon" aria-label="Open help assistant"
        className="fixed bottom-24 right-4 z-40 size-12 rounded-full shadow-lg md:bottom-6 md:right-6 print:hidden">
        <MessageCircleQuestionIcon className="size-5" />
      </Button>
    );
  }
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex h-dvh flex-col bg-background md:inset-x-auto md:top-auto md:bottom-6 md:right-6 md:h-[min(36rem,calc(100vh-3rem))] md:w-[24rem] md:rounded-xl md:border md:shadow-2xl print:hidden">
      <div className="flex items-center justify-between border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div>
          <p className="text-sm font-semibold">Help assistant</p>
          <p className="text-[11px] text-muted-foreground">Ask how to do something in the app.</p>
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="size-10 md:size-8" aria-label="Clear conversation" disabled={busy || !messages.length} onClick={() => setMessages([])}><RotateCcwIcon className="size-4" /></Button>
          <Button size="icon" variant="ghost" className="size-10 md:size-8" aria-label="Close" onClick={() => setOpen(false)}><XIcon className="size-4" /></Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {!messages.length && (
          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">Ask how to do something in the app.</p>
            <div className="flex flex-col gap-2">
              {['How do I raise a purchase request?', 'Where do I see my open tasks?', 'How do I change my alerts?'].map(q => (
                <button key={q} type="button" onClick={() => send(q)} className="rounded-full border px-3.5 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted active:bg-muted">{q}</button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'self-end' : 'self-start'} style={{ maxWidth: '90%' }}>
              <div className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed md:px-3 md:py-2 md:text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : m.error ? 'bg-destructive/10 text-destructive' : 'bg-muted'}`}>
                {m.content.replace(/\*\*/g, '') || (busy && i === messages.length - 1 ? 'Thinking…' : '')}
              </div>
              {m.link && <a href={m.link} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-primary underline underline-offset-2">{m.linkLabel || m.link}</a>}
              {showRoute && m.route && <p className="mt-1 text-[10px] text-muted-foreground/80">{m.route}</p>}
              {!!m.sources?.length && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {m.sources.map(s => <Link key={s.href} href={s.href} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground md:px-2 md:py-0.5 md:text-[11px]" onClick={() => { if (window.matchMedia('(max-width: 767px)').matches) setOpen(false); }}>{s.label}</Link>)}
                </div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>
      <form className="flex items-end gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" onSubmit={e => { e.preventDefault(); send(); }}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={1} maxLength={2000} placeholder="Ask a question"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border bg-background px-3.5 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9 md:rounded-md md:px-3 md:py-2 md:text-sm" />
        <Button type="submit" size="icon" className="size-11 rounded-full md:size-9 md:rounded-md" disabled={busy || !text.trim()} aria-label="Send"><SendIcon className="size-4" /></Button>
      </form>
    </div>
  );
}
