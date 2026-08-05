// V2-CHANGES.md Phase 5.0b — the per-project procurement stage bar: "which stage and how many
// remaining," rhyming visually with PortfolioDelayTimeline.jsx's milestone bar rather than pulling
// in a charting library (none exist in this repo — the whole design system is hand-built Tailwind,
// and a segmented proportion bar across a handful of ordered stages is exactly what flexbox + the
// theme's own status tokens already do well). Pure props, renders server- or client-side, same
// precedent as BomProgress.jsx.
//
// Color vocabulary is read straight from STAGE_BAR_COLORS (lib/bom-fields.mjs) rather than
// duplicated here — ProcurementFlow.jsx's TONE_CLASSES was built to mirror STAGE_BAR_COLORS
// exactly (see that file's header), so the two need to stay in lockstep. A hand-copied legend
// array used to live in this file and quietly drifted after the Phase 5.0b stage split
// (Comparison/Ordered used to share one coarser "info" bucket; they're now their own tokens) — the
// legend kept showing both as info/50 and info long after the bar itself, and ProcurementFlow, had
// moved on. Deriving the legend from STAGE_BAR_COLORS instead of copying it makes that class of
// drift structurally impossible going forward.
//
// Cancelled/In-Stock follow ProcurementFlow's tones too, not invented ones of their own: In-Stock
// is `info`, not `success` — success is Received's color, and reusing it here would visually
// conflate "fulfilled from stock" with "received via procurement," two different outcomes.
// Cancelled keeps its number neutral and only tints the glyph + label word, matching the restraint
// ProcurementFlow's header traces back to client feedback ("a full red border/text treatment
// looked heavier than the rest") — a solid-red count here would reintroduce exactly that.
import { ACTIVE_STAGES, EXIT_STAGES, STAGE_BAR_COLORS } from '@/lib/bom-fields.mjs';
import { cn } from '@/lib/utils';

// The bar itself only shows the 5 active/"still moving" stages, proportioned against their own
// total — Cancelled/In-Stock are terminal exits, not pipeline progress, so they render as side
// chips instead of bar segments (an item that's cancelled shouldn't visually read as "done").
export default function BomStageBar({ counts, size = 'full' }) {
  const activeTotal = ACTIVE_STAGES.reduce((a, s) => a + (counts[s] || 0), 0);
  const height = size === 'compact' ? 'h-1.5' : 'h-2.5';

  return (
    <div className="flex flex-col gap-1.5">
      {/* sm and up: a small horizontal bar chart, one row per active stage — label and count are
          always visible (no hover needed), and each bar's length is relative to the *largest*
          stage count, not the running total. That second choice matters: sizing against the total
          (like the old single-strip bar did) tells you proportion-of-whole, which needs a legend
          to decode; sizing against the max tells you "where's the backlog" on sight, which is the
          actual question this card exists to answer. Stages always render (even at 0) so the row
          set doesn't jump around as items move between stages. */}
      <div className="hidden flex-col gap-1 sm:flex">
        {(() => {
          const max = Math.max(1, ...ACTIVE_STAGES.map(stage => counts[stage] || 0));
          return ACTIVE_STAGES.map(stage => {
            const n = counts[stage] || 0;
            return (
              <div key={stage} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2">
                <span className="truncate text-xs text-muted-foreground">{stage}</span>
                <div className={cn('overflow-hidden rounded-full bg-muted', height)}>
                  <div className={cn('h-full rounded-full', STAGE_BAR_COLORS[stage])}
                    style={{ width: n === 0 ? 0 : `${Math.max((n / max) * 100, 4)}%` }} />
                </div>
                <span className="text-right tnum text-xs text-foreground">{n}</span>
              </div>
            );
          });
        })()}
      </div>

      {/* Below sm: a stacked list instead of the bar. Two reasons, not just "smaller screen" —
          touch has no hover, so the bar's per-segment title attr never surfaces on phones, and a
          5-way split on a ~320-360px track gets thin enough that a stage's color reads as a
          sliver, not a labeled segment. Same data, always-visible counts instead. */}
      <div className="flex flex-col gap-1 sm:hidden">
        {activeTotal === 0 ? (
          <span className="text-xs text-muted-foreground">No items in procurement</span>
        ) : (
          ACTIVE_STAGES.map(stage => {
            const n = counts[stage] || 0;
            if (!n) return null;
            return (
              <div key={stage} className="flex items-center gap-2">
                <span className={cn('size-2 shrink-0 rounded-full', STAGE_BAR_COLORS[stage])} />
                <span className="flex-1 text-xs text-muted-foreground">{stage}</span>
                <span className="tnum text-xs text-foreground">{n}</span>
              </div>
            );
          })
        )}
      </div>

      {EXIT_STAGES.some(s => counts[s] > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {counts.Cancelled > 0 && (
            <span className="flex items-center gap-1">
              <span className="text-danger/70">✕</span>
              <span className="tnum text-foreground">{counts.Cancelled}</span>
              <span className="text-danger/90">cancelled</span>
            </span>
          )}
          {counts['In-Stock'] > 0 && (
            <span className="flex items-center gap-1 text-info">
              <span>◈</span>
              <span className="tnum">{counts['In-Stock']}</span>
              <span>in-stock</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Legend swatches are pulled straight from STAGE_BAR_COLORS, not a second hand-maintained array
// (see file header) — so this can never fall out of sync with the bar above it or with
// ProcurementFlow's flowchart again.
export function BomStageLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {ACTIVE_STAGES.map(stage => (
        <span key={stage} className="flex items-center gap-1.5">
          <span className={cn('size-2 rounded-full', STAGE_BAR_COLORS[stage])} />{stage}
        </span>
      ))}
      <span className="flex items-center gap-1.5 text-danger">✕ Cancelled</span>
      <span className="flex items-center gap-1.5 text-info">◈ In-Stock</span>
    </div>
  );
}