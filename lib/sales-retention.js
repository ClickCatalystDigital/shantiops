// lib/sales-retention.js — server side of the Sales retention window (rules: lib/sales-retention.mjs).
// Nothing here runs by itself: the window only decides what the Sales Head is OFFERED to clean up.
// A cleanup needs (1) the window on, (2) a backup workbook downloaded for the same window in the last
// hour, (3) an explicit confirm. The delete then touches only rows that are older than BOTH the
// backup's cutoff and today's window, with id <= the backup's max id, so extending the window or new
// rows arriving can only shrink what is deleted.
import * as XLSX from 'xlsx';
import { queryAll, queryOne, execute, getAppSetting, setAppSetting } from './db';
import { todayISO } from './date';
import { audit } from './usb';
import { deleteObject } from './r2';
import {
  RETENTION_SOURCES, RETENTION_SOURCE_KEYS, DEFAULT_RETENTION, BACKUP_VALID_MS, cutoffDate, effectiveCutoff, eligibleQuery, normalizeRetention,
} from './sales-retention.mjs';

const KEY = 'sales_retention', BACKUP_KEY = 'sales_retention_backup', LAST_KEY = 'sales_retention_last_run', LOCK_KEY = 'sales_retention_running';
const parse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };

export const getRetention = async () => normalizeRetention(parse(await getAppSetting(KEY), DEFAULT_RETENTION));
export async function setRetention(raw, actor) {
  const before = await getRetention(), next = normalizeRetention(raw);
  if (raw?.enabled && !next.enabled) throw new Error('Pick one of the listed windows');
  await setAppSetting(KEY, JSON.stringify(next));
  if (before.months !== next.months) await setAppSetting(BACKUP_KEY, ''); // a backup belongs to one window
  await audit('sales_retention_setting', { actor, detail: `${before.enabled ? before.months + 'm' : 'off'} → ${next.enabled ? next.months + 'm' : 'off'}` });
  return next;
}

// What is past the window right now (works whether or not the switch is on, so the head can look first).
export async function previewRetention() {
  const r = await getRetention();
  const last = parse(await getAppSetting(LAST_KEY), null);
  const backup = parse(await getAppSetting(BACKUP_KEY), null);
  const months = r.months ?? parse(await getAppSetting(KEY), {}).months ?? null;
  if (!months) return { ...r, sources: [], last, backupReady: false };
  const today = todayISO(), cutoff = cutoffDate(today, months);
  const sources = [];
  for (const key of RETENTION_SOURCE_KEYS) {
    const row = await queryOne(eligibleQuery(key, { cutoff, today }).sql, eligibleQuery(key, { cutoff, today }).args);
    sources.push({ key, label: RETENTION_SOURCES[key].label, count: Number(row.n), oldest: row.oldest || null });
  }
  const backupReady = !!(backup && backup.months === r.months && Date.now() - Date.parse(backup.at) < BACKUP_VALID_MS);
  return { ...r, months, cutoff, sources, last, backupReady, backupAt: backupReady ? backup.at : null };
}

// The exact rows a cleanup would delete, as an .xlsx (one sheet per source); records the backup.
export async function buildBackup(actor) {
  const r = await getRetention();
  if (!r.enabled) throw new Error('Turn the retention window on first');
  const today = todayISO(), cutoff = cutoffDate(today, r.months);
  const wb = XLSX.utils.book_new(), counts = {}, maxIds = {};
  for (const key of RETENTION_SOURCE_KEYS) {
    const s = RETENTION_SOURCES[key];
    const q = eligibleQuery(key, { cutoff, today }, s.columns);
    const rows = await queryAll(q.sql + ` ORDER BY ${s.alias}.id`, q.args);
    counts[key] = rows.length; maxIds[key] = rows.length ? Math.max(...rows.map(x => Number(x.id))) : 0;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: 'nothing past the window' }]), s.label.slice(0, 31));
  }
  await setAppSetting(BACKUP_KEY, JSON.stringify({ at: new Date().toISOString(), months: r.months, cutoff, counts, maxIds }));
  await audit('sales_retention_backup', { actor, detail: JSON.stringify({ cutoff, counts }) });
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
async function retry(fn) {
  for (let i = 1; ; i++) { try { return await fn(); } catch (e) { if (i >= 3) throw e; await new Promise(r => setTimeout(r, 1000 * i)); } }
}

export async function runRetention(actor) {
  const r = await getRetention();
  if (!r.enabled) throw new Error('The retention window is off');
  const backup = parse(await getAppSetting(BACKUP_KEY), null);
  if (!backup || backup.months !== r.months || Date.now() - Date.parse(backup.at) > BACKUP_VALID_MS)
    throw new Error('Download a fresh backup first (a backup is valid for one hour and one window)');
  const lock = await getAppSetting(LOCK_KEY);
  if (lock && Date.now() - Date.parse(lock) < 15 * 60 * 1000) throw new Error('A cleanup is already running');
  await setAppSetting(LOCK_KEY, new Date().toISOString());
  const today = todayISO(), cutoff = effectiveCutoff(backup.cutoff, cutoffDate(today, r.months));
  const deleted = {}, r2Failed = [];
  try {
    for (const key of RETENTION_SOURCE_KEYS) {
      const s = RETENTION_SOURCES[key];
      const budget = backup.counts[key] || 0;
      deleted[key] = 0;
      while (deleted[key] < budget) {
        const q = eligibleQuery(key, { cutoff, today, maxId: backup.maxIds[key] }, `${s.alias}.id AS id`);
        const ids = (await queryAll(q.sql + ` ORDER BY ${s.alias}.id LIMIT ${Math.min(150, budget - deleted[key])}`, q.args)).map(x => Number(x.id));
        if (!ids.length) break;
        const marks = ids.map(() => '?').join(',');
        const keys = [];
        for (const c of s.children) {
          if (c.table === 'crm_note_files') keys.push(...(await queryAll(`SELECT file_key FROM crm_note_files WHERE ${c.fk} IN (${marks})`, ids)).map(f => f.file_key));
          await retry(() => execute(`DELETE FROM ${c.table} WHERE ${c.fk} IN (${marks})`, ids));
        }
        await retry(() => execute(`DELETE FROM ${s.table} WHERE id IN (${marks})`, ids));
        deleted[key] += ids.length;
        for (const k of keys) { try { await deleteObject(k); } catch { r2Failed.push(k); } }
      }
    }
  } finally { await setAppSetting(LOCK_KEY, ''); }
  const last = { at: new Date().toISOString(), by: actor, months: r.months, cutoff, deleted, r2Failed: r2Failed.length };
  await setAppSetting(LAST_KEY, JSON.stringify(last));
  await setAppSetting(BACKUP_KEY, '');
  await audit('sales_retention_run', { actor, detail: JSON.stringify({ ...last, r2FailedKeys: r2Failed.slice(0, 50) }) });
  return last;
}

// Once a month, if the window is on and records are past it, tell the Sales Heads (nothing is deleted).
export async function sweepRetentionNotice() {
  const r = await getRetention();
  if (!r.enabled) return 0;
  const p = await previewRetention();
  const n = p.sources.reduce((s, x) => s + x.count, 0);
  if (!n) return 0;
  const { notifyDepartmentHeads } = await import('./notify');
  return notifyDepartmentHeads('Sales', {
    kind: 'retention_due',
    title: `${n.toLocaleString('en-IN')} Sales history records are past your retention window`,
    body: 'Review them under Sales → Masters → Data retention. Nothing is deleted until you download a backup and confirm.',
    dedupe_key: `retention:${todayISO().slice(0, 7)}`,
  });
}
