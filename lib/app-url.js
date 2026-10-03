// Absolute link back into the app (emails, QR codes). null when no public URL is configured.
export function appUrl(path) {
  const base = (process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || '').replace(/\/$/, '');
  return base ? `${base}${path}` : null;
}
