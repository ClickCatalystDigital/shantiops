// lib/crypto.js — generic secret-at-rest encryption (AES-256-GCM, Node's built-in `crypto`, no new
// dependency). First consumer: eway_bill_credentials (real-NIC-API research plan, Gap 6) — that
// table previously stored Client ID/Secret/Username/Password as a plaintext JSON blob, safe from
// the browser (the GET route never returns it) but not from direct DB access or a backup leak.
// Reusable for any future secret-at-rest need, not eway-bill-specific.
import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey() {
  const raw = process.env.EWAY_BILL_CREDENTIALS_KEY;
  if (!raw) {
    throw new Error('EWAY_BILL_CREDENTIALS_KEY is not set — generate one (e.g. `openssl rand -base64 32`) and set it before storing e-way-bill credentials.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('EWAY_BILL_CREDENTIALS_KEY must decode to exactly 32 bytes (base64-encoded, e.g. from `openssl rand -base64 32`).');
  }
  return key;
}

// Fails closed if the key isn't set — never silently falls back to storing plaintext.
export function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptSecret(encoded) {
  const key = getKey();
  const raw = Buffer.from(encoded, 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
