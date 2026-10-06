// lib/lead-ingest.js — saves leads coming from Marketing → Lead sources (IndiaMART, TradeIndia,
// JustDial, website forms). Every lead goes straight to Sales (decided 2026-10-03), the same way a
// hand-made enquiry does: default funnel stage, round-robin assignee (crm_assignment_rules), first
// stage-history row. Each provider id is claimed in lead_source_events first, so a repeat (a re-pull
// window overlap, a webhook retry) is ignored. A lead whose phone matches an open enquiry is added to
// that enquiry's Diary instead of creating a second enquiry.
import crypto from 'crypto';
import { execute, queryOne } from './db';
import { DEFAULT_STAGE, leadStateForStage } from './lead-stage.mjs';
import { nextAssignee } from './crm';
import { notifyUser, notifyDepartmentHeads } from './notify';
import { LEAD_SOURCES, last10, usable } from './lead-sources.mjs';
import { todayISO } from './date';
import { tabLink } from './alert-links.mjs';

const digitsSql = col => `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col}, ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')`;

async function notifyOwner(username, note) {
  const u = username ? await queryOne('SELECT id FROM users WHERE username = ? AND active = 1', [username]) : null;
  if (u) await notifyUser(u.id, note);
  else await notifyDepartmentHeads('Sales', note); // nobody assigned: the Heads see it
}

export async function ingestLeads(account, leads) {
  const meta = LEAD_SOURCES[account.source];
  const label = meta?.short || meta?.label || account.source; // what the enquiry's Source reads
  const actor = `system:${account.source}`;
  const stageRow = await queryOne('SELECT name, is_won, is_lost FROM sales_stages WHERE name = ?', [DEFAULT_STAGE]);
  const out = { added: 0, merged: 0, skipped: 0 };

  for (const l of leads) {
    if (!usable(l)) { out.skipped++; continue; }
    const externalId = l.externalId || crypto.createHash('sha1')
      .update([account.source, last10(l.phone), l.email, l.enquiryDate, l.message].join('|')).digest('hex').slice(0, 20);
    const claim = await execute(
      'INSERT OR IGNORE INTO lead_source_events (source, external_id, account_id, action) VALUES (?, ?, ?, ?)',
      [account.source, externalId, account.id, 'pending']);
    if (!claim.changes) { out.skipped++; continue; }

    const org = (l.organization || '').toUpperCase();
    const summary = [l.product && `Product: ${l.product}`, l.message].filter(Boolean).join(' — ');
    const phone10 = last10(l.phone);
    const existing = phone10 ? await queryOne(
      `SELECT id, lead_name, assigned_to, account_manager FROM leads
        WHERE status = 'open' AND (${digitsSql('phone')} LIKE ? OR ${digitsSql('telephone')} LIKE ?)
        ORDER BY id DESC LIMIT 1`, [`%${phone10}`, `%${phone10}`]) : null;

    if (existing) {
      await execute(
        `INSERT INTO crm_notes (lead_id, note_type, content, created_by) VALUES (?, 'note', ?, ?)`,
        [existing.id, `New ${label} enquiry${l.person ? ` from ${l.person}` : ''}${summary ? `: ${summary}` : ''}`, actor]);
      await execute('UPDATE leads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [existing.id]);
      await execute("UPDATE lead_source_events SET action = 'merged', lead_id = ? WHERE source = ? AND external_id = ?", [existing.id, account.source, externalId]);
      await notifyOwner(existing.account_manager || existing.assigned_to, {
        kind: 'lead_received', title: `Repeat enquiry from ${label}: ${existing.lead_name}`, body: summary || null,
        link: tabLink('/sales', 'leads', { highlight: `LD-${existing.id}` }),
        dedupe_key: `lead:${account.source}:${externalId}` });
      out.merged++;
      continue;
    }

    const assignedTo = await nextAssignee('Sales');
    const notes = [l.person && `Contact: ${l.person}`, summary, `From ${label}${l.externalId ? ` #${l.externalId}` : ''}`].filter(Boolean).join('\n');
    const address = [l.address, l.city, l.state, l.pin].filter(Boolean).join(', ');
    const { lastId } = await execute(
      `INSERT INTO leads (lead_name, company_name, phone, email, source, owner_dept, notes, territory, assigned_to, created_by,
         status, sales_call_status, enquiry_date, address, product, reference, district, pin_code)
       VALUES (?, ?, ?, ?, ?, 'Sales', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [org || l.person || l.phone || l.email, org || null, l.phone || null, l.email || null, label, notes, l.state || null,
        assignedTo, actor, leadStateForStage([stageRow], DEFAULT_STAGE), DEFAULT_STAGE, l.enquiryDate || todayISO(),
        address || null, l.product || null, l.externalId ? `${label} #${l.externalId}` : label, l.city || null, l.pin || null]);
    const leadId = Number(lastId);
    await execute('INSERT INTO lead_stage_history (lead_id, from_stage, to_stage, changed_by) VALUES (?, ?, ?, ?)', [leadId, null, DEFAULT_STAGE, actor]);
    await execute("UPDATE lead_source_events SET action = 'created', lead_id = ? WHERE source = ? AND external_id = ?", [leadId, account.source, externalId]);
    await notifyOwner(assignedTo, {
      kind: 'lead_received', title: `New ${label} lead: ${org || l.person || l.phone}`, body: summary || null,
      link: tabLink('/sales', 'leads', { highlight: `LD-${leadId}` }),
      dedupe_key: `lead:${account.source}:${externalId}` });
    out.added++;
  }
  return out;
}
