// Project View redesign, Decision N — Dispatch's accumulated-context card: count, status,
// packed/dispatched quantities, downloadable Excel, deep link. The one action kept inline (per the
// brief: "Generate Draft Packing List already exists on /dispatch; reuse it rather than a second
// implementation") is a plain deep-link to /dispatch, not a duplicated button here.
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardAction, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { DownloadIcon, ArrowRightIcon } from 'lucide-react';

const STATUS_CLASS = {
  draft: 'border-warning/30 bg-warning-surface text-warning',
  packed: 'border-info/30 bg-info-surface text-info',
  dispatched: 'border-success/30 bg-success-surface text-success',
};

export default function DispatchSummaryCard({ projectId, packingLists = [] }) {
  const dispatched = packingLists.filter(l => l.status === 'dispatched').length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Packing &amp; Dispatch</CardTitle>
        <CardAction className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={`/api/projects/${projectId}/packing-lists/xlsx`}><DownloadIcon data-icon="inline-start" />Excel</a>
          </Button>
          <Button asChild size="sm" variant="outline"><Link href="/dispatch">Open Dispatch workspace <ArrowRightIcon className="size-3.5" /></Link></Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col divide-y p-0">
        {packingLists.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No packing lists yet.</p>}
        {packingLists.length > 0 && (
          <p className="px-4 py-2 text-xs text-muted-foreground">{dispatched} of {packingLists.length} dispatched</p>
        )}
        {packingLists.map(l => (
          <Link key={l.id} href={`/packing/${l.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40">
            <span className="text-sm font-medium">{l.packing_no}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{l.item_count} item(s)</span>
              <Badge className={STATUS_CLASS[l.status]} variant="outline">{l.status}</Badge>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
