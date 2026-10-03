'use client';

// Portal header "i" button — an overlay that explains, in plain words, where the order is now and what
// each stage means. Text lives in lib/portal-explain.mjs.
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InfoIcon, CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STAGE_EXPLAIN, currentSummary } from '@/lib/portal-explain.mjs';

const STATUS_TEXT = { done: 'Completed', in_progress: 'In progress', awaiting_customer: 'Needs your approval', upcoming: 'Upcoming' };

export default function PortalInfoButton({ phases, isSplitOrder = false, unitCount = 0 }) {
  const sum = currentSummary(phases);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="About your order" title="About your order"><InfoIcon className="size-4" /></Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="gap-2 border-b bg-muted/30 px-6 py-5 text-left">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">About your order</span>
          <DialogTitle className="text-xl font-semibold tracking-tight">{sum.title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-foreground/80">{sum.body}</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: 'calc(88vh - 9rem)' }}>
          <ol className="flex flex-col">
            {phases.map((p, i) => {
              const done = p.status === 'done';
              const live = p.status === 'in_progress' || p.status === 'awaiting_customer';
              return (
                <li key={p.key} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px]',
                      done ? 'border-success bg-success text-white' : live ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground')}>
                      {done ? <CheckIcon className="size-3.5" /> : live ? <span className="size-2 rounded-full bg-primary" /> : i + 1}
                    </span>
                    {i < phases.length - 1 && <span className="my-1 w-px flex-1 bg-border" />}
                  </div>
                  <div className="flex flex-col gap-1 pb-5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold">{p.label}</span>
                      <span className={cn('text-xs', live ? 'text-primary' : 'text-muted-foreground')}>{STATUS_TEXT[p.status]}</span>
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">{STAGE_EXPLAIN[p.key]}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          {isSplitOrder && (
            <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              Your order has {unitCount} units. Stages that happen on each unit show how many units have reached that point, for example “3 of {unitCount} units”.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
