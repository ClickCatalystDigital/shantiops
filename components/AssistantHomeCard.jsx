'use client';

// Home: ask OPS AI from the top of the page. It opens the chat panel (components/AssistantWidget.jsx)
// with the question already sent.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SparklesIcon, ArrowRightIcon } from 'lucide-react';

const ask = q => window.dispatchEvent(new CustomEvent('ops-ai:ask', { detail: q }));

export default function AssistantHomeCard() {
  const [text, setText] = useState('');
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); if (text.trim()) { ask(text.trim()); setText(''); } }}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><SparklesIcon className="size-4" /></span>
        <input value={text} onChange={e => setText(e.target.value)} maxLength={2000} placeholder="Ask OPS AI how to do something"
          className="h-10 min-w-0 flex-1 rounded-full border bg-background px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm" />
        <Button type="submit" size="icon" className="size-10 shrink-0 rounded-full" disabled={!text.trim()} aria-label="Ask OPS AI"><ArrowRightIcon className="size-4" /></Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {['How do I raise a purchase request?', 'Where do I see my open tasks?', 'How do I change my alerts?'].map(q => (
          <button key={q} type="button" onClick={() => ask(q)} className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">{q}</button>
        ))}
      </div>
    </div>
  );
}
