import { NextResponse } from 'next/server';
import { getFreshSessionUser, isPM, isDepartmentHead } from '@/lib/auth';
import { getProjectDeletePreview } from '@/lib/project-delete';

// Same gate as DELETE /api/projects/[id] — lets the dialog show the real document-inventory
// overlay (§ Delete Entire Project) before the person decides whether to proceed elsewhere.
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!(isPM(user) || isDepartmentHead(user, 'Design') || isDepartmentHead(user, 'Engineering'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const preview = await getProjectDeletePreview(params.id);
  if (!preview) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(preview);
}
