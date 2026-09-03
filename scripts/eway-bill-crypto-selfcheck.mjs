// scripts/eway-bill-crypto-selfcheck.mjs — node scripts/eway-bill-crypto-selfcheck.mjs
// Verifies lib/eway-bill-crypto.js's RSA-PKCS1 + AES-256-ECB-PKCS7 implementation is internally
// consistent and matches NIC's documented algorithm names exactly. No network, no real NIC keys
// (none exist yet) — this is the maximum verification possible before a real account exists: a
// locally-generated RSA keypair stands in for NIC's own keypair (we encrypt with the "public" half,
// decrypt with the "private" half, exactly mirroring what NIC's server does with our real payload
// once real keys exist), proving the encrypt/decrypt code itself is correct, not that it talks to
// the real NIC service.
import { strict as assert } from 'node:assert';
import crypto from 'node:crypto';
import { rsaEncrypt, aesEncrypt, aesDecrypt, sekToKeyBytes, randomAppKey, verifyHmac } from '../lib/eway-bill-crypto.js';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: 'pkcs1', format: 'pem' });

// --- RSA/ECB/PKCS1Padding round trip (password-style string payload) ---------------------------
{
  const password = 'a real 15-30 char password';
  const encrypted = rsaEncrypt(Buffer.from(password, 'utf8'), publicKeyPem);
  const decrypted = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(encrypted, 'base64'));
  assert.equal(decrypted.toString('utf8'), password);
}

// --- RSA round trip on raw random bytes (app_key-style payload) --------------------------------
{
  const appKey = randomAppKey();
  assert.equal(appKey.length, 32, 'app_key must be exactly 32 raw bytes for use as an AES-256 key');
  const encrypted = rsaEncrypt(appKey, publicKeyPem);
  const decrypted = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(encrypted, 'base64'));
  assert.ok(decrypted.equals(appKey), 'raw bytes must round-trip byte-for-byte through RSA (no lossy string encoding)');
}

// --- AES/ECB/PKCS7Padding round trip, arbitrary JSON payload ------------------------------------
{
  const key = crypto.randomBytes(32);
  const plaintext = JSON.stringify({ supplyType: 'O', docNo: 'SB/1/2026-27', itemList: [{ hsnCode: 7309, taxableAmount: 123456.78 }] });
  const encrypted = aesEncrypt(plaintext, key);
  const decrypted = aesDecrypt(encrypted, key);
  assert.equal(decrypted, plaintext);
}

// --- AES round trip with a key that isn't exactly 32 bytes must fail cleanly, not silently -------
{
  const wrongKey = crypto.randomBytes(16); // AES-128-length, not AES-256
  assert.throws(() => aesEncrypt('x', wrongKey), /key/i, 'a non-32-byte key must throw, not silently use the wrong cipher strength');
}

// --- sekToKeyBytes: correct-length input passes; wrong-length is a loud failure, not a silent one -
{
  const good = 'x'.repeat(32);
  assert.equal(sekToKeyBytes(good).length, 32);
  assert.throws(() => sekToKeyBytes('too-short'), /exactly 32/);
}

// --- randomAppKey produces fresh, distinct 32-byte values each call ------------------------------
{
  const a = randomAppKey();
  const b = randomAppKey();
  assert.equal(a.length, 32);
  assert.equal(b.length, 32);
  assert.ok(!a.equals(b), 'two calls must not produce the same key');
}

// --- HMAC verification: correct key/data verifies true, wrong key verifies false -----------------
{
  const rek = crypto.randomBytes(32);
  const data = Buffer.from('some base64 response data').toString('base64');
  const realMac = crypto.createHmac('sha256', rek).update(data).digest('base64');
  assert.equal(verifyHmac(data, rek, realMac), true);
  assert.equal(verifyHmac(data, crypto.randomBytes(32), realMac), false);
}

console.log('eway-bill-crypto-selfcheck: all checks passed');
