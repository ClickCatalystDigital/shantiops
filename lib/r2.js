// lib/r2.js — Cloudflare R2 (S3-compatible) storage, same client shape as the sibling ls_crm
// project's routes/invoices.js (proven pattern, reused rather than reinvented). Env not set yet
// (2026-08-04) — the client is provisioning the bucket and will add real values later; callers
// (test-certificates' PDF routes) treat a thrown error here as best-effort/non-fatal, so the rest
// of the app works today and storage lights up the moment the env vars land, no code change needed.
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

function required() {
  const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
    .filter(k => !process.env[k]);
  if (missing.length) throw new Error(`R2 not configured yet (missing ${missing.join(', ')})`);
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
  required();
  await client().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: buffer, ContentType: contentType,
  }));
  const domain = (process.env.R2_PUBLIC_DOMAIN_URL || '').trim().replace(/^https?:\/\//i, '');
  return domain ? `https://${domain}/${key}` : null;
}

export async function deleteObject(key) {
  required();
  await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
}

// Proxied preview (app/api/test-certificates/[id]/pdf) reads the object back through the app
// instead of relying on R2_PUBLIC_DOMAIN_URL being set — works the moment a PDF is uploaded, no
// public-bucket config required.
export async function getObjectBuffer(key) {
  required();
  const res = await client().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
  return Buffer.from(await res.Body.transformToByteArray());
}
