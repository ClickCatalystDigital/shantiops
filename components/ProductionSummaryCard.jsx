// Project View redesign, Decision L — Production's accumulated-context card, locked to exactly
// three fields: Job Cards, Material Indents, and QC-held Job Cards. Concise summary + deep links,
// never a recreation of /production's own operational UI.
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardAction, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ArrowRightIcon } from 'lucide-react';

export default function ProductionSummaryCard({ jobCards = [], materialIndents = [] }) {
  const done = jobCards.filter(jc => jc.status === 'done').length;
  const held = jobCards.filter(jc => jc.requires_qc_hold && !jc.qc_released_at);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Production</CardTitle>
        <CardAction>
          <Button asChild size="sm" variant="outline"><Link href="/production">Open Production workspace <ArrowRightIcon className="size-3.5" /></Link></Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium">Job Cards</p>
          <p className="text-xs text-muted-foreground">{jobCards.length === 0 ? 'None raised yet' : `${done} of ${jobCards.length} done`}</p>
        </div>

        {held.length > 0 && (
          <div>
            <p className="text-sm font-medium text-warning">Held for QC</p>
            <div className="mt-1 flex flex-col gap-1">
              {held.map(jc => (
                <div key={jc.id} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{jc.jc_no || `#${jc.id}`} · {jc.section}</span>
                  <Badge variant="outline" className="border-warning/30 bg-warning-surface text-warning">Awaiting QC release</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-sm font-medium">Material Indents</p>
          {materialIndents.length === 0 ? (
            <p className="text-xs text-muted-foreground">None raised yet</p>
          ) : (
            <div className="mt-1 flex flex-col gap-1">
              {materialIndents.slice(0, 6).map(ind => (
                <div key={ind.id} className="flex items-center justify-between text-xs">
                  <span>{ind.indent_no} · {ind.item_count} item(s)</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{ind.status}</Badge>
                    <a href={`/api/material-indents/${ind.id}/pdf`} target="_blank" rel="noreferrer" className="text-muted-foreground underline">PDF</a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
