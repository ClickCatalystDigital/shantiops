// Customer-uploaded drawings (portal -> Design review). Shared by the customer-drawings routes and
// the portal data loaders. Rows never expose file_key.
import { queryAll, queryOne } from '@/lib/db';

export const CUSTOMER_DRAWING_TYPES = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export const CUSTOMER_DRAWING_MAX = 15 * 1024 * 1024;

// A split unit's uploads live on its master — the project the customer actually has.
export async function resolveDrawingProjectId(projectId) {
  const p = await queryOne('SELECT id, master_project_id FROM projects WHERE id = ?', [projectId]);
  return p ? (p.master_project_id || p.id) : null;
}

const COLS = 'id, project_id, label, file_name, file_size, mime, uploaded_by, uploaded_by_name, status, review_note, reviewed_by, reviewed_at, created_at';

export async function getCustomerDrawings(projectId) {
  return queryAll(`SELECT ${COLS} FROM customer_drawing_uploads WHERE project_id = ? ORDER BY id DESC`, [projectId]);
}
