// components/EntityRefLink.jsx
'use client';

// The Link+Tooltip rendering LinkifiedText.jsx already used for one resolved ref inside parsed
// free text, extracted so RelatedItemsCard.jsx (structural relations, not free-text parsing) can
// render the exact same visual language instead of a second one. `RefTooltip` stays exported for
// LinkifiedText's own per-token wrapping.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { api } from '@/lib/client';

// Type disambiguation is the tooltip's own label line, not color (rejected during the original
// tagging round — too many entity types for distinct colors to stay legible, and color already
// means BOM purchase-stage elsewhere, STAGE_BAR_COLORS in lib/bom-fields.mjs).
const TYPE_LABELS = {
  job_card: 'Job Card', work_order: 'Work Order', bom_item: 'Material',
  drawing: 'Drawing', calc_sheet: 'Calc Sheet', ncr: 'NCR', inventory_item: 'Inventory Item',
  grn: 'GRN', gir: 'Gate Inward (GIR)', gate_pass: 'Gate Pass',
  purchase_requisition: 'Purchase Requisition', rfq: 'RFQ', purchase_order: 'Purchase Order',
  quotation: 'Quotation', sale_order: 'Sale Order', packing_list: 'Packing List',
  fixed_asset: 'Fixed Asset', credit_note: 'Credit Note', debit_note: 'Debit Note',
  sales_invoice: 'Sales Invoice', vendor_bill: 'Vendor Bill',
};

export function RefTooltip({ entityRef, children }) {
  const { detail } = entityRef;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="flex-col items-start gap-1 text-left">
        <p className="font-medium">{TYPE_LABELS[entityRef.type] || entityRef.type}</p>
        {detail && (
          <>
            {detail.status && <p className="capitalize">{detail.status.replace(/_/g, ' ')}</p>}
            {detail.meta?.map(m => m.value != null && (
              <p key={m.label} className="text-background/70">{m.label}: {m.value}</p>
            ))}
          </>
        )}
        {entityRef.project_no && <p className="text-background/70">Project: {entityRef.project_no}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

// A single resolved ref, standalone — for anywhere a component already knows the ref object
// (RelatedItemsCard's relation chips, a raw-FK spot like JobCardBoard's material line) rather than
// having to parse it back out of free text like LinkifiedText does.
export default function EntityRefLink({ entityRef, className = 'font-medium text-primary hover:underline' }) {
  const node = entityRef.href
    ? <Link href={entityRef.href} onClick={e => e.stopPropagation()} className={className}>{entityRef.label}</Link>
    : <span className="font-medium">{entityRef.label}</span>;
  return <RefTooltip entityRef={entityRef}>{node}</RefTooltip>;
}

// For a spot that only has a raw code (e.g. a materialIssue row's bare `bom_item_id`, previously
// rendered as unlinked "BOM item #{id}" text) and nothing else — resolves it itself rather than
// duplicating href-construction rules that already live in lib/entity-refs.js. Falls back to the
// plain code while loading or if it never resolves (unknown/deleted/no permission) — same
// graceful-degrade convention as an unresolved token in free text.
export function EntityCode({ code, fallback }) {
  const [ref, setRef] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!code) return undefined;
    api(`/api/entity-refs/resolve?codes=${encodeURIComponent(code)}`)
      .then(d => { if (!cancelled) setRef(d.refs?.[code] || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [code]);
  if (!ref) return <span>{fallback || code}</span>;
  return <EntityRefLink entityRef={ref} />;
}
