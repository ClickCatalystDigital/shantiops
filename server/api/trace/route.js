// Heat trace: ?heat=H123 | ?cert=<test_certificates.id> | ?project=<project id> (docs/gulf-coast-asme-plan.md, Phase 1b).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { traceHeat, traceCertificate, traceProject } from '@/lib/trace';
import { forbidden, err } from '@/lib/quality-routes';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!['QC', 'Stores', 'Production', 'Procurement'].some(d => canAccessDepartment(user, d))) return forbidden();
  const q = new URL(req.url).searchParams;
  if (q.get('heat')?.trim()) return NextResponse.json(await traceHeat(q.get('heat').trim()));
  if (Number(q.get('cert'))) return NextResponse.json(await traceCertificate(Number(q.get('cert'))));
  if (Number(q.get('project'))) return NextResponse.json(await traceProject(Number(q.get('project'))));
  return err('Give a heat, certificate or project');
}
