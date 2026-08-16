'use client';

// Contextual "i" button — same guide-step shape as /help's PM_GUIDE entries (title/body pairs),
// so a section can be surfaced right where it's needed (Approvals) without duplicating the copy.
import { InfoIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

export default function InfoPopover({ guide }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={guide.title}>
          <InfoIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex flex-col gap-3">
        <div className="text-sm font-medium">{guide.title}</div>
        {guide.steps.map((s, i) => (
          <div key={s.title} className="flex gap-2.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{i + 1}</span>
            <div>
              <div className="text-xs font-medium">{s.title}</div>
              <p className="text-xs text-muted-foreground">{s.body}</p>
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
