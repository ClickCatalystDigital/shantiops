// lib/extract.js — AI field extraction via OpenRouter, same request shape as the sibling ls_crm
// project's routes/invoices.js callOpenRouter/parseInvoice (proven in production there — mirrored,
// not reinvented): a PDF as a base64 `file` content part, the `file-parser`/`pdf-text` plugin, and
// fence-stripped JSON parsing with a brace-slice fallback for a model that wraps its answer in prose.
// AI only fills form fields — a human always reviews before save (client's explicit requirement).
const MODEL = () => process.env.EXTRACTION_MODEL || 'google/gemini-2.5-flash';

function parseJsonLoose(raw) {
  let s = (raw || '').trim();
  const fence = '`'.repeat(3);
  if (s.startsWith(fence)) s = s.split(fence).join('').replace(/^json/i, '').trim();
  try { return JSON.parse(s); } catch {}
  const first = s.indexOf('{'), last = s.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch {}
  }
  throw new Error('AI did not return valid JSON');
}

// prompt: plain-text instructions (what fields to extract, as JSON keys). buffer: PDF bytes.
export async function extractFields(buffer, prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('AI extraction not configured yet (OPENROUTER_API_KEY not set)');

  const b64 = buffer.toString('base64');
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL(),
      temperature: 0,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'file', file: { filename: 'certificate.pdf', file_data: `data:application/pdf;base64,${b64}` } },
      ] }],
      max_tokens: 4096,
      plugins: [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }],
    }),
  });
  if (r.status === 429) throw new Error('OpenRouter rate limit hit — try again shortly');
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('AI returned no content');
  return parseJsonLoose(raw);
}
