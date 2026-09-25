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
