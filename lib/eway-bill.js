// lib/eway-bill.js — the one place e-way-bill generation is dispatched from. Direct-to-NIC only,
// deliberately (no GSP/provider): the government's own registration is portal-based (the taxpayer
// logs into the E-Way Bill portal themselves, Registration -> For API, and NIC issues Client ID /
// Client Secret / API Username / API Password) and cannot be automated by this app — the user does
// that step externally, then enters the resulting credentials in Accounts -> Company Entities.
//
// Implemented against the live official spec (docs.ewaybillgst.gov.in, v1.03 — read directly via a
// real browser this session, since WebFetch is domain-blocked; verified against a second, older
// (2018, v1.01) source too — the two agree on everything except three fields v1.03 added, all
// included below). Not yet live-tested — no base URL/public key/real credentials exist to test
// against. lib/eway-bill-selfcheck.mjs verifies the crypto round-trip (RSA-PKCS1 + AES-256-ECB-
// PKCS7) against locally-generated keys, the maximum verification possible without a real account.
import { queryOne } from './db';
import { decryptSecret } from './crypto';
import { rsaEncrypt, aesEncrypt, aesDecrypt, sekToKeyBytes, randomAppKey } from './eway-bill-crypto';

// ---- Config -----------------------------------------------------------------------------------
// EWAY_BILL_BASE_URL: e.g. "https://<host>/ewaybillapi/v1.03" — confirm the exact current host at
// registration time (docs.ewaybillgst.gov.in shows only "<URL>/..." placeholders; NIC does not
// publish the literal hostname on the public docs). EWAY_BILL_PUBLIC_KEY: the RSA public key NIC
// issues at registration (PEM format), used to encrypt password/app_key on the auth call.
function getConfig() {
  const baseUrl = process.env.EWAY_BILL_BASE_URL;
  const publicKeyPem = process.env.EWAY_BILL_PUBLIC_KEY;
  if (!baseUrl || !publicKeyPem) {
    // UI-facing message — deliberately no raw env var names or internal doc references (an
    // accounts_head/dispatch_head reads this, not a developer). This is a deployment-level step
    // (server address + security key), distinct from the Client ID/Secret/Username/Password an
    // accounts_head enters themselves — say so, so they don't keep re-entering their own credentials
    // thinking that's what's wrong.
    throw new Error('The E-Way Bill connection hasn’t been fully set up on this system yet. Your saved credentials are fine — the server connection details still need to be configured by your technical team before this can go live.');
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), publicKeyPem };
}

// ---- Token cache, per company — NIC's own token is valid 360 minutes from first issue and a
// re-auth before expiry returns the SAME token (time not reset), so re-authenticating on every
// call would be both wasteful and pointless. In-memory only (per server process); acceptable since
// a restart just means one extra auth call, not a correctness issue.
const tokenCache = new Map(); // company -> { authtoken, keyBytes, expiresAt }

async function getSession(company, credentials) {
  const cached = tokenCache.get(company);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const session = await authenticate(credentials);
  tokenCache.set(company, session);
  return session;
}

// ---- authenticate -------------------------------------------------------------------------
async function authenticate(credentials) {
  const { baseUrl, publicKeyPem } = getConfig();
  const appKeyBytes = randomAppKey();
  const body = {
    action: 'ACCESSTOKEN',
    username: credentials.api_username,
    password: rsaEncrypt(Buffer.from(credentials.api_password, 'utf8'), publicKeyPem),
    app_key: rsaEncrypt(appKeyBytes, publicKeyPem),
  };
  const res = await fetch(`${baseUrl}/auth/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'client-id': credentials.client_id,
      'client-secret': credentials.client_secret,
      gstin: credentials.gstin,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`Authenticate: non-JSON response (HTTP ${res.status})`);
  if (json.status !== '1') throw ewayBillError(json);
  const decryptedSek = aesDecrypt(json.sek, appKeyBytes);
  const keyBytes = sekToKeyBytes(decryptedSek);
  return { authtoken: json.authtoken, keyBytes, expiresAt: Date.now() + 359 * 60 * 1000 };
}

// ---- Error mapping — by code range, per SYSTEM.md §5ax's already-researched taxonomy. A live
// GetErrorList API exists (GET <base>/Master/GetErrorList) for the current authoritative table;
// not fetched here yet — this is the static fallback, sufficient until that's wired.
function ewayBillError(json) {
  const code = json?.error?.errorCodes;
  if (code === undefined) return new Error(json?.info || 'E-way bill API call failed with no error code.');
  const msg = `NIC error ${code}`;
  return new Error(msg);
}

// ---- GENEWAYBILL --------------------------------------------------------------------------
// payload must already carry every field the caller (app/api/packing/[id]/eway-bill/route.js)
// validated per Gaps 1-4 — this function does not re-validate, it only builds and sends the
// NIC-shaped JSON.
async function callGenerate(session, credentials, payload) {
  const { baseUrl } = getConfig();
  const data = aesEncrypt(JSON.stringify(payload), session.keyBytes);
  const res = await fetch(`${baseUrl}/ewayapi/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'client-id': credentials.client_id,
      'client-secret': credentials.client_secret,
      gstin: credentials.gstin,
      authtoken: session.authtoken,
    },
    body: JSON.stringify({ action: 'GENEWAYBILL', data }),
  });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`Generate: non-JSON response (HTTP ${res.status})`);
  if (json.status !== '1') throw ewayBillError(json);
  const decrypted = JSON.parse(aesDecrypt(json.data, session.keyBytes));
  return { ewayBillNo: String(decrypted.ewayBillNo), date: decrypted.ewayBillDate, validUpto: decrypted.validUpto };
}

export async function generateEwayBill({ company, credentials, payload }) {
  if (!credentials) {
    throw new Error(`No e-way-bill credentials configured for ${company} — register on the E-Way Bill portal (Registration -> For API), then add the credentials in Accounts -> Company Entities.`);
  }
  const session = await getSession(company, credentials);
  return callGenerate(session, credentials, buildGenerateRequest(payload));
}

// Maps Shanti Ops' packing-list/customer/BOM data onto NIC's real v1.03 GENEWAYBILL schema.
// transactionType defaults to "1" (Regular) — Shanti Ops has no Bill-To/Ship-To or Bill-From/
// Dispatch-From split today (§5ax's live-docs research), so 2/3/4 never apply until that changes.
// actFromStateCode/actToStateCode equal fromStateCode/toStateCode for the same reason.
function buildGenerateRequest(p) {
  return {
    supplyType: 'O',
    subSupplyType: '1',
    docType: 'INV',
    docNo: p.docNo,
    docDate: p.docDate,
    transactionType: '1',
    fromGstin: p.fromGstin,
    fromTrdName: p.fromTrdName,
    fromAddr1: p.fromAddr1,
    fromAddr2: p.fromAddr2 || '',
    fromPlace: p.fromPlace,
    fromPincode: Number(p.fromPincode),
    fromStateCode: Number(p.fromStateCode),
    actFromStateCode: Number(p.fromStateCode),
    toGstin: p.toGstin,
    toTrdName: p.toTrdName,
    toAddr1: p.toAddr1,
    toAddr2: p.toAddr2 || '',
    toPlace: p.toPlace,
    toPincode: Number(p.toPincode),
    toStateCode: Number(p.toStateCode),
    actToStateCode: Number(p.toStateCode),
    totalValue: p.totalValue,
    cgstValue: p.cgstValue || 0,
    sgstValue: p.sgstValue || 0,
    igstValue: p.igstValue || 0,
    cessValue: p.cessValue || 0,
    totInvValue: p.totInvValue,
    transMode: p.transMode,
    vehicleType: p.vehicleType,
    transDistance: String(p.transDistance),
    vehicleNo: p.vehicleNo || undefined,
    transporterName: p.transporterName || undefined,
    itemList: p.itemList,
  };
}

// ---- CANEWB -------------------------------------------------------------------------------
// Cancellation window is 24 hours from generation, generator-only (docs.ewaybillgst.gov.in,
// confirmed live) — enforced by NIC itself; the caller should still check this locally first for a
// fast, clear failure rather than waiting on a round trip.
export async function cancelEwayBill({ company, credentials, ewbNo, cancelRsnCode, cancelRmrk }) {
  if (!credentials) {
    throw new Error(`No e-way-bill credentials configured for ${company}.`);
  }
  const session = await getSession(company, credentials);
  const { baseUrl } = getConfig();
  const data = aesEncrypt(JSON.stringify({ ewbNo: Number(ewbNo), cancelRsnCode, cancelRmrk }), session.keyBytes);
  const res = await fetch(`${baseUrl}/ewayapi/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'client-id': credentials.client_id,
      'client-secret': credentials.client_secret,
      gstin: credentials.gstin,
      authtoken: session.authtoken,
    },
    body: JSON.stringify({ action: 'CANEWB', data }),
  });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`Cancel: non-JSON response (HTTP ${res.status})`);
  if (json.status !== '1') throw ewayBillError(json);
  const decrypted = JSON.parse(aesDecrypt(json.data, session.keyBytes));
  return { ewayBillNo: String(decrypted.ewayBillNo), cancelDate: decrypted.cancelDate };
}

// The one place a company's stored credentials are read and decrypted — both the "Test Connection"
// route and the real generation route call this instead of duplicating the decrypt/parse logic.
// Returns null if nothing is configured yet (a real, expected state, not an error). Merges in the
// company's own GSTIN (company_settings, not part of the stored credential blob) — every NIC call
// needs it as the `gstin` request header, identifying which registered taxpayer is calling.
export async function loadCredentials(company) {
  const row = await queryOne('SELECT credentials FROM eway_bill_credentials WHERE company = ?', [company]);
  if (!row) return null;
  const parsed = JSON.parse(decryptSecret(row.credentials));
  const companyRow = await queryOne('SELECT gstin FROM company_settings WHERE company = ?', [company]);
  if (!companyRow?.gstin) {
    throw new Error(`${company} has no GSTIN on file (Accounts -> Company Entities) — required to call the E-Way Bill API.`);
  }
  return { ...parsed, gstin: companyRow.gstin };
}
