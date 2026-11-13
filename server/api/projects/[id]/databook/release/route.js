// Release the Data Book: refused (409) while a required line is missing, an ITP point is open or an NCR is open.
// The merged PDF and a manifest (every file key and hash) are stored and never rebuilt; a later change to the
// records needs a new revision.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { putObject } from '@/lib/r2';
import { sha256Hex } from '@/lib/pdf-upload';
import { audit } from '@/lib/usb';
import { err, qcOnly } from '@/lib/quality-routes';
import { getBook, bookStatus, buildBookPdf } from '@/lib/databook';
import { releaseProblems } from '@/lib/databook.mjs';
import { shippingBlockers } from '@/lib/quality';

export async function POST(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.databook.release');
  if (denied) return denied;
  const projectId = Number(params.id);
  const book = await getBook(projectId);
  if (!book) return err('Start the Data Book first');
  const problems = releaseProblems(await bookStatus(projectId, book), await shippingBlockers(projectId));
  if (problems.length) return err(`Not ready to release: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` and ${problems.length - 5} more` : ''}`, 409);
  const revision = ((await queryOne('SELECT MAX(revision) AS r FROM databook_releases WHERE project_id = ?', [projectId])).r || 0) + 1;
  let built;
  try { built = await buildBookPdf(projectId, { preliminary: false, revision, strict: true }); }
  catch (e) { return err(`Could not build the book: ${e.message}`, 409); }
  const sha256 = await sha256Hex(built.buf);
  const key = `databooks/${projectId}/release-${revision}-${sha256.slice(0, 16)}.pdf`;
  try { await putObject(key, built.buf, 'application/pdf'); } catch (e) { return err(e.message, 409); }
  try {
    const r = await execute('INSERT INTO databook_releases (project_id, revision, pdf_key, sha256, pages, manifest_json, released_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [projectId, revision, key, sha256, built.pages, JSON.stringify(built.manifest), user.username]);
    await audit('databook_released', { actor: user.username, detail: JSON.stringify({ project_id: projectId, revision, sha256, pages: built.pages }) });
    return NextResponse.json({ id: Number(r.lastId), revision, sha256, pages: built.pages });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return err('Another release just went through; reload', 409);
    throw e;
  }
}
