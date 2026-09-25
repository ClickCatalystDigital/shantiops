// lib/sales-people.mjs — Sales CRM plan 1i. An A/C manager / Sales Person is stored as a username.
// Older rows (the 1,006 imported sale orders, anything typed by hand) hold free text such as
// "Amit B". personKey() turns either into one stable key: the username when the text matches a
// user's username or display name (case/space-insensitive), else the text itself — so a legacy
// name stays its own group instead of silently disappearing from a report. Pure, no DB import.

const norm = v => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function personKey(raw, users = []) {
  const v = norm(raw);
  if (!v) return null;
  const u = users.find(x => norm(x.username) === v || (x.display_name && norm(x.display_name) === v));
  return u ? u.username : String(raw).trim();
}

export function personLabel(key, users = []) {
  if (!key) return '—';
  const u = users.find(x => x.username === key);
  return u ? (u.display_name || u.username) : key;
}

// Dropdown options: every active Sales user, then legacy names still on records (marked), so an
// imported order can keep — or be moved between — the names it already uses.
export function salesPeopleOptions(users = [], legacyNames = []) {
  const opts = users.map(u => ({ value: u.username, label: u.display_name || u.username }));
  const seen = new Set(opts.map(o => o.value));
  for (const raw of legacyNames) {
    const k = personKey(raw, users);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    opts.push({ value: k, label: `${k} (not a user)` });
  }
  return opts;
}
