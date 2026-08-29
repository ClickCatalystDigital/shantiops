// components/LinkifiedText.jsx
'use client';

// Renders free text with entity-reference tokens (JC-1004, BM-88, DWG-3, ...) turned into links,
// each with a hover tooltip showing that entity's current status/progress (lib/entity-refs.js's
// `detail: {status, meta}` shape — one generic tooltip here, not five bespoke ones per type).
// Resolution is NOT done here — a resolved-code -> ref map is passed in (`refs`), built once per
// TicketsPanel batch (see lib/entity-refs.js's header comment on why: avoids an N+1 fetch across
// the several TicketsPanel instances one Operations view can render). An unresolved token (typo,
// or an entity that no longer exists) simply isn't in `refs` and renders as plain text — same
// degrade as a typo'd GitHub #issue reference, never an error.
import Link from 'next/link';
import { findEntityRefTokens } from '@/lib/entity-ref-tokens';
import { RefTooltip } from '@/components/EntityRefLink';

export default function LinkifiedText({ text, refs = {}, className }) {
  if (!text) return null;
  const tokens = findEntityRefTokens(text);
  if (tokens.length === 0) return <span className={className}>{text}</span>;

  const re = new RegExp(`(${tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  const parts = text.split(re);

  return (
    <span className={className}>
      {parts.map((part, i) => {
        const ref = refs[part];
        if (!ref) return part;
        const node = ref.href
          ? <Link key={i} href={ref.href} onClick={e => e.stopPropagation()} className="font-medium text-primary hover:underline">{ref.label}</Link>
          : <span key={i} className="font-medium">{ref.label}</span>;
        return <RefTooltip key={i} entityRef={ref}>{node}</RefTooltip>;
      })}
    </span>
  );
}
