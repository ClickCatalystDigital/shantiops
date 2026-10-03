// Read-only QC roll-up on a project's page — each statutory document (certificates live inside them)
// with its completeness, plus NCRs. All the actual add/edit/delete lives in the /qc
// workspace, so the "Manage" buttons deep-link there with this project preselected. Buttons are
// gated on `canManage` (QC-department access) because /qc redirects anyone else away.
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { FileTextIcon, AlertTriangleIcon, UsersIcon } from 'lucide-react';
import { seriesLabel, isExtraSeries } from '@/lib/qc-extra-series.mjs';
import { TONE_CLASS } from '@/lib/status-styles';

// One statutory document: the main boiler set, or an extra (Pressure Reducing Station, Steam Header …).
function DocRow({ doc, canManage, projectId }) {
  const done = doc.total_parts > 0 && doc.linked_parts === doc.total_parts;
  const body = (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5 transition-colors hover:bg-muted/50">
      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          {seriesLabel(doc.series)}
          {isExtraSeries(doc.series) && <Badge variant="outline" className="text-[10px] font-normal">Extra</Badge>}
        </span>
        <span className="truncate text-xs text-muted-foreground">{doc.doc_id}</span>
      </div>
      {doc.customer_visible ? (
        <Badge variant="outline" className={`${TONE_CLASS.info} gap-1 text-[10px]`}><UsersIcon className="size-3" />Shared</Badge>
      ) : null}
      <Badge variant="outline" className={done ? TONE_CLASS.success : TONE_CLASS.warning}>
        {done ? 'Complete' : `${doc.linked_parts} of ${doc.total_parts} linked`}
      </Badge>
    </div>
  );
  return canManage ? <Link href={`/projects/${projectId}/qc/${doc.id}`}>{body}</Link> : body;
}

function Row({ icon: Icon, label, value, href, canManage, cta }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Icon className="size-4 text-muted-foreground" />
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{value}</span>
      </div>
      {canManage && (
        <Button asChild size="sm" variant="outline" className="ml-auto">
          <Link href={href}>{cta}</Link>
        </Button>
      )}
    </div>
  );
}

export default function QcProjectSummary({ projectId, summary = {}, canManage = false }) {
  const { docs_total = 0, docs_finalized = 0, docs = [], ncrs_total = 0, ncrs_open = 0 } = summary;
  return (
    <Card>
      <CardHeader>
        <CardTitle>QC Documents</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        <Row icon={FileTextIcon} label="Statutory Documents"
          value={docs_total === 0 ? 'None filed yet' : `${docs_finalized} of ${docs_total} finalized`}
          href={`/qc?tab=docs&project=${projectId}`} canManage={canManage} cta="Manage documents" />
        {docs.length > 0 && (
          <div className="flex flex-col gap-2 py-3 pl-7">
            {docs.map(d => <DocRow key={d.id} doc={d} canManage={canManage} projectId={projectId} />)}
          </div>
        )}
        {ncrs_total > 0 && (
          <Row icon={AlertTriangleIcon} label="NCRs"
            value={ncrs_open === 0 ? `${ncrs_total} raised, none open` : `${ncrs_open} of ${ncrs_total} open`}
            href={`/qc?tab=ncr&project=${projectId}`} canManage={canManage} cta="Manage NCRs" />
        )}
      </CardContent>
    </Card>
  );
}
