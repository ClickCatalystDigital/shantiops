// QR sticker PDF for the boiler nameplate. One page for a normal project; one page per unit for a
// split order. Every QR opens the order's customer portal page (login needed) — units point at
// their master's page, because the customer's login is scoped to the order, not to each unit.
import { NextResponse } from 'next/server';
import { queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { appUrl } from '@/lib/app-url';
import { renderNameplateStickerPdf } from '@/lib/nameplate-sticker-pdf';
import { defaultCompany } from '@/lib/company-profiles';

export const runtime = 'nodejs';

const COLS = 'id, project_no, customer_name, company, series, model_design, model_capacity, model_pressure, master_project_id';
const modelOf = p => [p.series, p.model_design, p.model_capacity && `${p.model_capacity} kg/hr`, p.model_pressure && `${p.model_pressure} kg/cm²`].filter(Boolean).join(' · ');

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const project = await queryOne(`SELECT ${COLS} FROM projects WHERE id = ?`, [params.id]);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const units = await queryAll(`SELECT ${COLS} FROM projects WHERE master_project_id = ? ORDER BY id`, [project.id]);
  const portalId = project.master_project_id || project.id;
  const path = `/portal/${portalId}`;
  const url = appUrl(path) || `${new URL(req.url).origin}${path}`;
  const stickers = (units.length ? units : [project]).map(p => ({
    company: p.company || project.company || defaultCompany(), project_no: p.project_no,
    customer_name: p.customer_name || project.customer_name, model: modelOf(p) || modelOf(project), url,
  }));
  const pdf = await renderNameplateStickerPdf(stickers);
  return new NextResponse(pdf, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="QR-${project.project_no.replace(/[^a-z0-9]+/gi, '-')}.pdf"` },
  });
}
