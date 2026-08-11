// CALC-CHANGES2.md §E — Design's master table on Operations, same columns/spirit as
// MasterBomTable but without its search/pagination (Design's row count is small — projects with
// any calc_sheets/calc_drawings at all — so that machinery isn't earning its keep here; add it
// back if that stops being true). Plain server component, no client state needed.
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';

export default function DesignMasterTable({ designWork }) {
  if (!designWork.length) return null;
  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-base">Design</CardTitle>
        <CardAction className="text-xs text-muted-foreground tnum">{designWork.length} project{designWork.length !== 1 ? 's' : ''}</CardAction>
      </CardHeader>
      <CardContent className="pt-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="w-32 py-2 font-medium">Project</th>
              <th className="py-2 font-medium">Customer</th>
              <th className="w-32 py-2 font-medium">Design Progress</th>
              <th className="py-2 font-medium">Bottleneck</th>
              <th className="w-28 py-2 font-medium">Calc Status</th>
              <th className="w-24 py-2 font-medium">Drawings</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {designWork.map((w) => (
              <tr key={w.id} className="hover:bg-muted/40">
                <td className="py-2.5 pr-3"><Link href={`/projects/${w.id}`} className="font-medium text-primary hover:underline">{w.project_no}</Link></td>
                <td className="truncate py-2.5 pr-3 text-muted-foreground">{w.customer_name}</td>
                <td className="py-2.5 pr-3 tnum text-muted-foreground">{w.designProgress.done}/{w.designProgress.total}</td>
                <td className="py-2.5 pr-3 text-muted-foreground">{w.bottleneck || '—'}</td>
                <td className="py-2.5 pr-3 tnum text-muted-foreground">{w.calcStatus.done}/{w.calcStatus.total}</td>
                <td className="py-2.5 tnum text-muted-foreground">{w.drawings.done}/{w.drawings.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
