// One display name from the contact form's first/last fields (older callers still send `name`).
export const composeName = b => [b.first_name, b.last_name].map(v => String(v ?? '').trim()).filter(Boolean).join(' ') || String(b.name ?? '').trim();
