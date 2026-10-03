'use client';

import { toast } from 'sonner';

export async function api(url, options = {}) {
  // FormData bodies (file uploads) pass through untouched — the browser sets the multipart header.
  const isForm = options.body instanceof FormData;
  const res = await fetch(url, {
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    ...options,
    body: isForm ? options.body : options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  // err.status / err.data let a caller act on a structured refusal (e.g. a 409 with candidates).
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status, data });
  return data;
}

// Thin wrapper over sonner so all existing showToast(message, type) call sites keep working.
export function showToast(message, type = 'success') {
  if (type === 'error') return toast.error(message);
  if (type === 'warning') return toast.warning(message);
  return toast.success(message);
}

// Re-exported from lib/format so existing client imports keep working.
export { formatDate, capitalize, formatMoney } from './format';

// Public GitHub release asset — same URL documented in docs/SETUP.md as AGENT_UPDATE_URL.
export const INSTALLER_URL = 'https://github.com/clickcatalyst-digital/shantiops/releases/latest/download/ShantiAgentSetup.exe';

// WhatsApp send with a backup: try the company number first (the API route); if that isn't possible
// (not connected, template not approved, Meta refused) open the wa.me click-send in a new tab.
// The tab is opened before the request so the browser doesn't block it as a pop-up.
export async function sendWhatsApp(url, body, waLink) {
  const tab = window.open('', '_blank');
  try {
    const r = await api(url, { method: 'POST', body });
    if (r.sent) { tab?.close(); showToast('Sent on WhatsApp from the company number'); return true; }
    if (tab) tab.location = waLink; else window.location.href = waLink;
    showToast(`${r.reason} — opened WhatsApp on this device instead`);
  } catch (err) { tab?.close(); showToast(err.message, 'error'); }
  return false;
}
