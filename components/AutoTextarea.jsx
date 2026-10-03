'use client';

// A text box that looks like a one-line Input but grows downward as the text wraps, so nothing is
// ever hidden. Uses CSS field-sizing where the browser has it, else resizes itself on input.
import { useLayoutEffect, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const native = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');

export default function AutoTextarea({ className, value, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (native || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <Textarea ref={ref} rows={1} value={value} className={cn('min-h-8 resize-none overflow-hidden py-1.5 leading-snug', className)} {...props} />;
}
