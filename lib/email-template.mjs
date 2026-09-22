// lib/email-template.mjs — Phase 3.2. Plain {{token}} string replace, no templating-engine
// dependency (ladder: this is the whole job).
export function renderTemplate(text, vars) {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : ''));
}
