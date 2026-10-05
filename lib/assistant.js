// lib/assistant.js — server side of the in-app help assistant (admin-only while it is being tested).
// Settings live in app_settings; the OpenRouter key is stored encrypted (lib/crypto.js).
import { getAppSetting, setAppSetting } from './db';
import { isAdmin, isDepartmentHead } from './auth';
import { encryptSecret, decryptSecret } from './crypto';
import { DEPARTMENT_HELP } from '@/components/department-help-content';
import { helpSections } from './assistant-help.mjs';

export const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it';
export const OPENROUTER = 'https://openrouter.ai/api/v1';
export const CREDITS_URL = 'https://openrouter.ai/settings/credits';

// Who may open Settings → Assistant (key, model, credit): admin, and the Accounts Head, who pays for the credit.
export function canManageAssistant(user) {
  return isAdmin(user) || (user?.role === 'operator' && isDepartmentHead(user, 'Accounts'));
}

// An OpenRouter failure as { error, link? } for the user. 402 = the account has run out of credit:
// everyone is told to ask Accounts; whoever can refill it also gets the link.
export function openRouterError(status, body, canManage = false) {
  if (status === 402) return { error: 'AI credits have run out, so the assistant cannot answer. Contact Accounts to refill the AI credits.', ...(canManage ? { link: CREDITS_URL, linkLabel: 'Add credit on OpenRouter' } : null) };
  if (status === 401) return { error: 'OpenRouter did not accept the key. Check it in Settings → Assistant.' };
  if (status === 429) return { error: 'OpenRouter is limiting requests right now. Wait a minute and ask again.' };
  return { error: body?.error?.message || `OpenRouter returned ${status}` };
}

// Credit on the account behind the key, in US dollars: { bought, used, left }. null when it can't be read.
export async function getBalance(key) {
  try {
    const res = await fetch(`${OPENROUTER}/credits`, { headers: { authorization: `Bearer ${key}` } });
    const d = (await res.json()).data;
    if (!res.ok || !d) return null;
    const bought = Number(d.total_credits) || 0, used = Number(d.total_usage) || 0;
    return { bought, used, left: bought - used };
  } catch { return null; }
}

// The decision model. Pinned, not "~typesafe/jev-latest": a newer version could choose differently,
// and that should be a deliberate change. (Jev Router is a different product: it forwards a chat
// request to a writing model it picks, so it belongs in the writing-model dropdown, not here.)
export const JEV_MODEL = 'typesafe/jev-1.13';
// 'llm' = a writing model words the answer from the chosen section; 'guide' = show the section itself.
export const MODES = ['llm', 'guide'];

export async function getAssistantSettings() {
  const [model, keyEnc, mode] = await Promise.all([getAppSetting('assistant_model'), getAppSetting('assistant_key_enc'), getAppSetting('assistant_mode')]);
  return { model: model || DEFAULT_MODEL, hasKey: !!keyEnc, mode: MODES.includes(mode) ? mode : 'llm', jevModel: JEV_MODEL, dataAccess: await getDataAccess() };
}

// Live-data answers send order, stock and payment rows to OpenRouter, so they stay off until the
// customer's approval is recorded: who approved (their name), who recorded it here, and when.
// Stored as JSON in app_settings.assistant_data_access; every change is also written to the audit log.
export async function getDataAccess() {
  try { const v = JSON.parse((await getAppSetting('assistant_data_access')) || '{}'); return v?.on ? v : { on: false, ...v }; } catch { return { on: false }; }
}
export async function setDataAccess(record) { await setAppSetting('assistant_data_access', JSON.stringify(record)); }

// Ask Jev. state = the text or object to decide about; questions = { name: { type, instructions, criteria } }.
// Returns the answers object, or throws.
export async function jevDecide(key, state, questions) {
  const res = await fetch('https://openrouter.ai/api/alpha/decisions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'SB Ops' },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.answers) throw new Error(res.status === 402 ? 'balance too low' : body?.error?.message || `Jev returned ${res.status}`);
  return body.answers;
}
export async function getAssistantKey() {
  const enc = await getAppSetting('assistant_key_enc');
  return enc ? decryptSecret(enc) : null;
}
export async function saveAssistantSettings({ model, key, mode }) {
  if (mode !== undefined && MODES.includes(mode)) await setAppSetting('assistant_mode', mode);
  if (model !== undefined) await setAppSetting('assistant_model', String(model).trim() || DEFAULT_MODEL);
  if (key !== undefined) await setAppSetting('assistant_key_enc', key ? encryptSecret(String(key).trim()) : '');
}

// Things every user has that no department guide covers. `href` = where the answer's link goes.
const GENERAL = {
  General: {
    features: [
      { key: 'alerts', label: 'Alerts: bell and email notifications', href: '/settings', body: ['Settings → Alerts. Each alert has a bell switch and an email choice: Off, Now (sent right away) or Daily (one summary each morning).', 'Enter your alert email address at the top first; email choices stay disabled until it is saved.', 'Alerts are grouped by department. All sets a whole group at once. Managers also have a Morning brief email.', 'The bell at the top right shows unread alerts; View all opens the full list.'] },
      { key: 'profile', label: 'Profile, photo and password', href: '/settings', body: ['Settings → Profile: change your display name and contact number, and add or change your photo.', 'Settings → Change Password: enter the current password, then the new one twice.', 'If you forgot your password, ask your department head or a manager to reset it.'] },
      { key: 'company-selector', label: 'Company selector in the top bar', href: '/accounts', body: ['The dropdown at the top right chooses which company you are looking at: all companies or one.', 'It narrows Sales, Reports, Accounts and the Executive page. Customers, products and enquiries are shared and are not narrowed.', 'In Accounts every tab follows it. With All companies selected, the first company is shown.'] },
      { key: 'assistant', label: 'Help assistant', href: '/settings', body: ['The chat button at the bottom right answers questions about using the app from the help guide.', 'It can answer questions about live data (stock, orders, payments) only when that has been switched on in Settings → Assistant.', 'If it says AI credits have run out, contact Accounts.'] },
    ],
  },
};

let sections = null;
export function allHelpSections() {
  return (sections ??= [...helpSections(DEPARTMENT_HELP), ...helpSections(GENERAL).filter(s => s.key !== 'intro').map(s => ({ ...s, href: GENERAL.General.features.find(f => f.key === s.key)?.href }))]);
}
