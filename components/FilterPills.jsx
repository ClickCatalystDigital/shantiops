// components/FilterPills.jsx
'use client';

// Shared multi-select filter pill row (DESIGN-OPS-REDESIGN.md, Cross-cutting: "Summary chips
// become multi-select filter pills... shared, not Design-only — build as one reusable component
// so every department's Operations view gets it"). This component only tracks/renders selection —
// callers own what "filtered" means for their own list (see OperationsAttentionSection for the
// current consumer).
import { cn } from '@/lib/utils';

export default function FilterPills({ options, selected, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const isSelected = selected.includes(opt.key);
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onToggle(opt.key)}
            aria-pressed={isSelected}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm shadow-sm transition-colors',
              isSelected
                ? 'border-primary/50 bg-primary/10 ring-1 ring-inset ring-primary/30'
                : 'border-border bg-card hover:bg-muted/50'
            )}
          >
            <span className={cn('size-2 rounded-full', opt.dot)} />
            <span className={cn('font-semibold tnum', isSelected ? 'text-primary' : 'text-foreground')}>{opt.value}</span>
            <span className={isSelected ? 'text-primary/80' : 'text-muted-foreground'}>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}