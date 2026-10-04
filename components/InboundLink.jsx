'use client';

// "Inbound": opens the supplier's page for a purchase order (the PO copy to download, and where the
// supplier or Procurement records the dispatch: LR / vehicle / tracking link / invoice / photos). The same
// page the supplier got with their RFQ; a PO bought without an RFQ gets its own link on first use.
import { Button } from '@/components/ui/button';
import { PackageOpenIcon } from 'lucide-react';

export default function InboundLink({ poId, size = 'sm', variant = 'outline', className = '' }) {
  if (!poId) return null;
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <a href={`/api/purchase-orders/${poId}/supplier-link`} target="_blank" rel="noreferrer"
        title="Supplier's page: purchase order copy and delivery details" onClick={e => e.stopPropagation()}>
        <PackageOpenIcon className="size-3.5" /> Inbound
      </a>
    </Button>
  );
}
