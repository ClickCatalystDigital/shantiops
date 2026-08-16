// Read-only QC roll-up on a project's QC tab — certificates uploaded / with a PDF, and statutory
// documents finalized (all parts linked) / total. All the actual add/edit/delete lives in the /qc
// workspace, so the "Manage" buttons deep-link there with this project preselected. Buttons are
// gated on `canManage` (QC-department access) because /qc redirects anyone else away.
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { FlaskConicalIcon, FileTextIcon } from 'lucide-react';

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
  const { certs_total = 0, certs_with_pdf = 0, docs_total = 0, docs_finalized = 0 } = summary;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Certificates &amp; Documents</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        <Row icon={FlaskConicalIcon} label="Test Certificates"
          value={certs_total === 0 ? 'None uploaded yet' : `${certs_with_pdf} of ${certs_total} with PDF`}
          href={`/qc?tab=tc&project=${projectId}`} canManage={canManage} cta="Manage certificates" />
        <Row icon={FileTextIcon} label="Statutory Documents"
          value={docs_total === 0 ? 'None filed yet' : `${docs_finalized} of ${docs_total} finalized`}
          href={`/qc?tab=docs&project=${projectId}`} canManage={canManage} cta="Manage documents" />
      </CardContent>
    </Card>
  );
}
