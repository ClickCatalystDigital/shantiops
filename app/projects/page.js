import Link from 'next/link';
import { getProjectsWithStatus, getCustomers } from '@/lib/data';
import { getFreshSessionUser, isDesignHead } from '@/lib/auth';
import StatusBadge from '@/components/StatusBadge';
import NewProjectForm from '@/components/NewProjectForm';
import PageHeader from '@/components/PageHeader';
import { DepartmentPills, DepartmentProgress } from '@/components/DepartmentStatus';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export default async function Projects() {
  const user = await getFreshSessionUser();
  const canCreate = isDesignHead(user);
  const [projects, customers] = await Promise.all([
    getProjectsWithStatus(), canCreate ? getCustomers() : [],
  ]);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Projects" description="Every customer order, design → commissioning">
        {canCreate && <NewProjectForm customers={customers} />}
      </PageHeader>

      {/* Mobile: cards. Desktop: table. */}
      <div className="grid gap-3 sm:hidden">
        {projects.map(p => (
          <Link key={p.id} href={`/projects/${p.id}`}>
            <Card className="transition-colors hover:border-primary/40">
              <CardContent className="flex flex-col gap-1 py-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-primary">{p.project_no}</span>
                  <StatusBadge status={p.roll} />
                </div>
                <div className="text-sm">{p.customer_name}</div>
                <div className="text-xs text-muted-foreground">{p.description || '—'}</div>
                <div className="mt-1"><DepartmentPills departmentProgress={p.departmentProgress} /></div>
                <div className="mt-1 flex items-center justify-between text-xs">
                  <DepartmentProgress departmentProgress={p.departmentProgress} />
                  <span className="text-muted-foreground">Overall {p.overallDone}/{p.overallTotal}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {projects.length === 0 && <p className="text-sm text-muted-foreground">No projects yet.</p>}
      </div>

      <Card className="hidden sm:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead><TableHead>Customer</TableHead>
                <TableHead>Description</TableHead><TableHead>Order Date</TableHead>
                <TableHead>Department Progress</TableHead><TableHead>Overall Progress</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map(p => (
                <TableRow key={p.id}>
                  <TableCell><Link href={`/projects/${p.id}`} className="font-medium text-primary hover:underline">{p.project_no}</Link></TableCell>
                  <TableCell>{p.customer_name}</TableCell>
                  <TableCell className="text-muted-foreground">{p.description || '—'}</TableCell>
                  <TableCell className="tnum">{p.order_date || '—'}</TableCell>
                  <TableCell className="tnum"><DepartmentProgress departmentProgress={p.departmentProgress} /></TableCell>
                  <TableCell className="tnum text-muted-foreground">{p.overallDone}/{p.overallTotal}</TableCell>
                  <TableCell>
                    <StatusBadge status={p.roll} />
                    <div className="mt-1"><DepartmentPills departmentProgress={p.departmentProgress} /></div>
                  </TableCell>
                </TableRow>
              ))}
              {projects.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-muted-foreground">No projects yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
