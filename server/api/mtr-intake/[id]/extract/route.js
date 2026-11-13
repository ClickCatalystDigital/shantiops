// Read one uploaded MTR with the model: one line per heat. Stores the raw answer, model and prompt version so
// a later question ("why did it read 485?") can be answered. Never creates a certificate: review does.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { getObjectBuffer } from '@/lib/r2';
import { extractFields } from '@/lib/extract';
import { MTR_PROMPT, PROMPT_VERSION, normalizeExtract } from '@/lib/mtr-extract.mjs';
import { err, qcOnly } from '@/lib/quality-routes';

export async function POST(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.certificate.write');
  if (denied) return denied;
  const m = await queryOne('SELECT id, status, pdf_key FROM mtr_intake WHERE id = ?', [params.id]);
  if (!m) return err('Not found', 404);
  if (!m.pdf_key) return err('No file to read (a duplicate is not stored twice)', 409);
  if (['accepted', 'rejected'].includes(m.status)) return err(`This file is already ${m.status}`, 409);
  const model = process.env.EXTRACTION_MODEL || 'google/gemini-2.5-flash';
  try {
    const raw = await extractFields(await getObjectBuffer(m.pdf_key), MTR_PROMPT);
    const x = normalizeExtract(raw);
    const status = x.doc_type === 'other' ? 'not_mtr' : 'extracted';
    await execute('UPDATE mtr_intake SET status = ?, doc_type = ?, extracted_json = ?, model = ?, prompt_version = ?, error = ? WHERE id = ?',
      [status, x.doc_type, JSON.stringify({ ...x, raw }), model, PROMPT_VERSION, x.errors.join('; ') || null, m.id]);
    return NextResponse.json({ status, lines: x.lines.length });
  } catch (e) {
    await execute("UPDATE mtr_intake SET status = 'failed', error = ?, model = ?, prompt_version = ? WHERE id = ?", [e.message, model, PROMPT_VERSION, m.id]);
    return NextResponse.json({ status: 'failed', error: e.message });
  }
}
