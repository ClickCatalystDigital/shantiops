// Project View redesign, Decision K — Stores' accumulated-context card. A project-specific
// summary/reference surface, not the full Stores operational workflow (that stays on /stores).
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardAction, CardContent } from './ui/card';
import { Button } from './ui/button';
import { DownloadIcon, ArrowRightIcon } from 'lucide-react';

export default function StoresSummaryCard({ projectId, inventoryCount = 0, deliveryLotsCount = 0 }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stores</CardTitle>
        <CardAction>
          <Button asChild size="sm" variant="outline"><Link href="/stores">Open Stores workspace <ArrowRightIcon className="size-3.5" /></Link></Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:gap-6">
        <div className="flex flex-1 items-center justify-between gap-3 rounded-md border px-4 py-3">
          <div>
            <p className="text-sm font-medium">Total project inventory</p>
            <p className="text-xs text-muted-foreground">{inventoryCount} item(s) received / in stock</p>
          </div>
          <Button asChild size="sm" variant="outline">
            <a href={`/api/projects/${projectId}/stores-inventory/xlsx`}><DownloadIcon data-icon="inline-start" />Excel</a>
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-between gap-3 rounded-md border px-4 py-3">
          <div>
            <p className="text-sm font-medium">Expected delivery lots</p>
            <p className="text-xs text-muted-foreground">{deliveryLotsCount} item(s) with a scheduled date</p>
          </div>
          <Button asChild size="sm" variant="outline">
            <a href={`/api/projects/${projectId}/delivery-lots/xlsx`}><DownloadIcon data-icon="inline-start" />Excel</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
