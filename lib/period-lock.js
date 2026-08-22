// lib/period-lock.js — one row per company, "locked_through" a date. Checked from the single
// choke point every journal entry funnels through (lib/ledger-post.js's insertEntryWithLines()),
// so this covers auto-posted documents, manual journals, and reversals alike — nothing routes
// around it.
import { execute, queryOne } from './db';

export async function getPeriodLock(company) {
  return queryOne('SELECT * FROM company_period_locks WHERE company = ?', [company]);
}

export async function setPeriodLock(company, lockedThrough, lockedBy) {
  await execute(
    `INSERT INTO company_period_locks (company, locked_through, locked_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(company) DO UPDATE SET locked_through = excluded.locked_through, locked_by = excluded.locked_by, updated_at = CURRENT_TIMESTAMP`,
    [company, lockedThrough, lockedBy ?? null]
  );
}

export async function assertPeriodOpen(company, entryDate) {
  const lock = await getPeriodLock(company);
  if (lock && entryDate <= lock.locked_through) {
    throw new Error(`Books are locked through ${lock.locked_through} — cannot post an entry dated ${entryDate}`);
  }
}
