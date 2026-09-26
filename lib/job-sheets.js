// Server helpers for the 33-stage Job Card sheet.
import { execute, queryOne } from './db';

export const isISODate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Header start = earliest stage start; header end = latest stage end once every stage is finished.
export async function recomputeSheetDates(sheetId) {
  const r = await queryOne(
    `SELECT MIN(start_date) AS s, MAX(end_date) AS e, COUNT(*) AS n,
            SUM(CASE WHEN end_date IS NULL THEN 1 ELSE 0 END) AS open
       FROM job_sheet_stages WHERE sheet_id = ?`, [sheetId]);
  const end = r.n > 0 && Number(r.open) === 0 ? r.e : null;
  await execute('UPDATE job_sheets SET start_date = ?, end_date = ? WHERE id = ?', [r.s || null, end, sheetId]);
}
