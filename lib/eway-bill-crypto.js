// lib/eway-bill-crypto.js — the RSA/AES scheme NIC's E-Way Bill API documents (docs.ewaybillgst.
// gov.in v1.03, read directly this session), pulled out of lib/eway-bill.js so it has zero
// dependency on lib/db.js and can be exercised by a plain-node self-check
// (scripts/eway-bill-crypto-selfcheck.mjs) with no DB/Next bootstrapping needed.
import crypto from 'crypto';

// RSA/ECB/PKCS1Padding — used only for the one-time password/app_key exchange on authenticate.
// Takes a Buffer, not a string — app_key is raw random bytes, and round-tripping raw bytes through
// a string encoding (e.g. 'binary' -> re-encoded as 'utf8') silently corrupts any byte >= 0x80.
export function rsaEncrypt(buf, publicKeyPem) {
  return crypto.publicEncrypt({ key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING }, buf).toString('base64');
}

// AES/ECB/PKCS7Padding — Node's 'aes-256-ecb' cipher applies PKCS7 padding by default (the same
// scheme as PKCS5 for a 16-byte block, which is what NIC's own Java/.NET sample code implements).
// keyBytes must be exactly 32 raw bytes (AES-256) — both app_key and the decrypted sek are used
// this way per the spec's own "any 32 character random id" / "32 bit random secure key" wording.
export function aesEncrypt(plaintext, keyBytes) {
  const cipher = crypto.createCipheriv('aes-256-ecb', keyBytes, null);
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');
}
export function aesDecrypt(ciphertextBase64, keyBytes) {
  const decipher = crypto.createDecipheriv('aes-256-ecb', keyBytes, null);
  return Buffer.concat([decipher.update(Buffer.from(ciphertextBase64, 'base64')), decipher.final()]).toString('utf8');
}

// ponytail: this is the one genuinely unverifiable assumption in this file — whether the decrypted
// sek plaintext is used directly as 32 raw key bytes (assumed here, consistent with how app_key
// itself is documented and used) or needs a further decode step, can only be confirmed against a
// real authenticate response. Verify THIS specifically before trusting any GENEWAYBILL call: log
// the decrypted sek's raw byte length (should be exactly 32) on the very first real auth call.
export function sekToKeyBytes(decryptedSek) {
  const bytes = Buffer.from(decryptedSek, 'utf8');
  if (bytes.length !== 32) {
    throw new Error(`Decrypted SEK is ${bytes.length} bytes, expected exactly 32 — the sek encoding assumption needs revisiting against this real response.`);
  }
  return bytes;
}

export function randomAppKey() {
  // "Any 32 character random unique id" — used directly as raw AES-256 key bytes, so this must be
  // exactly 32 bytes, not 32 hex/base64 characters (which would decode to fewer raw bytes).
  return crypto.randomBytes(32);
}

// HMAC-SHA256 over base64 JSON data, keyed by the (already-decrypted) rek — used by NIC's various
// GET methods to verify response integrity. Not called by anything yet (no GET method wired), kept
// here since it's part of the same documented crypto scheme and belongs alongside it.
export function verifyHmac(base64Data, rekBytes, expectedHmacBase64) {
  const mac = crypto.createHmac('sha256', rekBytes).update(base64Data).digest('base64');
  return mac === expectedHmacBase64;
}
