import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';

export async function POST(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name || !['earning', 'deduction'].includes(b.component_type)) {
    return NextResponse.json({ error: 'name and component_type (earning|deduction) are required' }, { status: 400 });
  }
  const calcType = b.calc_type === 'percent_of_basic' ? 'percent_of_basic' : 'flat';
  const maxOrder = await queryOne('SELECT COALESCE(MAX(sort_order), -1) AS n FROM salary_structure_components WHERE salary_structure_id = ?', [params.id]);
  const { lastId } = await execute(
    `INSERT INTO salary_structure_components (salary_structure_id, name, component_type, calc_type, amount, percent, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [params.id, name, b.component_type, calcType, calcType === 'flat' ? (b.amount || 0) : null, calcType === 'percent_of_basic' ? (b.percent || 0) : null, maxOrder.n + 1]
  );
  return NextResponse.json({ id: Number(lastId) });
}
