// Project View — the project's real BOM, restored to the full-featured shared BomTable per direct
// instruction: same card as before the redesign, all its capabilities (search/filter, Add/Edit/
// Delete, department-scoped editable columns, Cancel, Receive, Prod. Done, import history) — the
// only thing dropped is the PMB-upload control, since importing now happens from the Engineering
// BOM workspace's own "Import PMB (.xlsx)" button. Not collapsible (same as the old BomPanel.jsx).
'use client';

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardAction, CardContent } from './ui/card';
import { Button } from './ui/button';
import { DownloadIcon } from 'lucide-react';
import BomTable from './BomTable';

export default function CommonBomCard({
  projectId, bom = [], pendingIds = [], editableFields = [], department, canCancel = false,
  assemblies = [], imports = [],
}) {
  const canStructure = editableFields.includes('material_description');
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Bill of Materials <span className="text-xs font-normal text-muted-foreground">({bom.length} item{bom.length === 1 ? '' : 's'})</span>
        </CardTitle>
        <CardAction className="flex items-center gap-3">
          {canStructure && (
            <Link href="/engineering?tab=structure" className="text-sm text-primary hover:underline">
              Manage assemblies
            </Link>
          )}
          <Button asChild size="sm" variant="outline">
            <a href={`/api/projects/${projectId}/bom/xlsx`}><DownloadIcon data-icon="inline-start" />Download Excel</a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <BomTable projectId={projectId} bom={bom} pendingIds={pendingIds} editableFields={editableFields}
          department={department} canCancel={canCancel} assemblies={assemblies} />
        {imports.length > 0 && (
          <div className="flex flex-col gap-1 border-t pt-3">
            <span className="text-xs font-medium">Import history</span>
            {imports.map(imp => (
              <div key={imp.id} className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <a href={`/api/bom-imports/${imp.id}/file`} className="hover:underline">
                  Rev {imp.revision} · {imp.filename}
                </a>
                <span>{new Date(imp.created_at).toLocaleDateString()} · {imp.imported_by}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
