// lib/r2.js — Cloudflare R2 (S3-compatible) storage, same client shape as the sibling ls_crm
// project's routes/invoices.js (proven pattern, reused rather than reinvented). R2 env vars landed
// in .env.local as of 2026-08-11 (confirmed working via a live upload/download round-trip) —
// callers still treat a thrown error here as best-effort/non-fatal for any env that hasn't set them.
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

function required() {
  const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
    .filter(k => !process.env[k]);
  if (missing.length) throw new Error(`R2 not configured yet (missing ${missing.join(', ')})`);
}

// Public demo (DEMO_MODE=1): files live in the demo's own bucket, reached through the Worker binding
// DEMO_FILES (no keys; the client's storage is never touched). Only the owner-pass browser may upload
// or delete; visitors can open what the owner uploaded. Elsewhere this is never consulted.
function demoBucket() {
  if (process.env.DEMO_MODE !== '1') return null;
  const bucket = globalThis[Symbol.for('__cloudflare-context__')]?.env?.DEMO_FILES;
  if (!bucket && process.env.NODE_ENV !== 'production') return null; // local demo-mode run: ./.local-files below
  if (!bucket) throw new Error('Demo file storage is not set up');
  return bucket;
}
// The US and India demos share one bucket; US files live under us/ so the two never overwrite each other
// (keys like test-certificates/3.pdf repeat across demos). India's keys are unchanged.
const demoKey = key => (process.env.MARKET === 'NA' ? `us/${key}` : key);
async function requireDemoOwner() {
  const [{ cookies }, { isOwnerPass }] = await Promise.all([import('next/headers'), import('./demo-leads.js')]);
  if (!isOwnerPass((await cookies()).get('demo_lead')?.value)) throw new Error('File uploads are turned off in the public demo');
}

// ponytail: development without R2 keys (a scratch database, a local test run) keeps files in ./.local-files
// instead of failing every upload. Never in production: there a missing key is still an error.
const localDev = () => process.env.NODE_ENV !== 'production' && !process.env.R2_ACCESS_KEY_ID;
async function localFile(key) {
  const [{ promises: fs }, path] = await Promise.all([import('node:fs'), import('node:path')]);
  const full = path.join(process.cwd(), '.local-files', key.replace(/\.\.+/g, '_'));
  return { fs, full, dir: path.dirname(full) };
}

function client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

// Returns the public URL if R2_PUBLIC_DOMAIN_URL is set, else null (object is stored either way —
// the key is always enough to fetch/delete it; the public URL is only for direct browser access).
export async function putObject(key, buffer, contentType) {
  const demo = demoBucket();
  if (demo) {
    await requireDemoOwner();
    await demo.put(demoKey(key), buffer, { httpMetadata: { contentType } });
    return null; // served back through the app's own file routes (getObjectBuffer)
  }
  if (localDev()) { const f = await localFile(key); await f.fs.mkdir(f.dir, { recursive: true }); await f.fs.writeFile(f.full, buffer); return null; }
  required();
  await client().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: buffer, ContentType: contentType,
  }));
  const domain = (process.env.R2_PUBLIC_DOMAIN_URL || '').trim().replace(/^https?:\/\//i, '');
  return domain ? `https://${domain}/${key}` : null;
}

export async function deleteObject(key) {
  const demo = demoBucket();
  if (demo) { await requireDemoOwner(); await demo.delete(demoKey(key)); return; }
  if (localDev()) { const f = await localFile(key); await f.fs.rm(f.full, { force: true }); return; }
  required();
  await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
}

// Proxied preview (app/api/test-certificates/[id]/pdf) reads the object back through the app
// instead of relying on R2_PUBLIC_DOMAIN_URL being set — works the moment a PDF is uploaded, no
// public-bucket config required.
export async function getObjectBuffer(key) {
  const demo = demoBucket();
  if (demo) {
    const obj = await demo.get(demoKey(key));
    if (!obj) throw new Error('File not found');
    return Buffer.from(await obj.arrayBuffer());
  }
  if (localDev()) { const f = await localFile(key); return f.fs.readFile(f.full); }
  required();
  const res = await client().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
  return Buffer.from(await res.Body.transformToByteArray());
}
