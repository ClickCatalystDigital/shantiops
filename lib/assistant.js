// lib/assistant.js — server side of the in-app help assistant (admin-only while it is being tested).
// Settings live in app_settings; the OpenRouter key is stored encrypted (lib/crypto.js).
import { getAppSetting, setAppSetting } from './db';
import { encryptSecret, decryptSecret } from './crypto';
import { DEPARTMENT_HELP } from '@/components/department-help-content';
import { helpSections } from './assistant-help.mjs';

export const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it';
export const OPENROUTER = 'https://openrouter.ai/api/v1';

// The decision model. Pinned, not "~typesafe/jev-latest": a newer version could choose differently,
// and that should be a deliberate change. (Jev Router is a different product: it forwards a chat
// request to a writing model it picks, so it belongs in the writing-model dropdown, not here.)
export const JEV_MODEL = 'typesafe/jev-1.13';
// 'llm' = a writing model words the answer from the chosen section; 'guide' = show the section itself.
export const MODES = ['llm', 'guide'];

export async function getAssistantSettings() {
  const [model, keyEnc, mode] = await Promise.all([getAppSetting('assistant_model'), getAppSetting('assistant_key_enc'), getAppSetting('assistant_mode')]);
  return { model: model || DEFAULT_MODEL, hasKey: !!keyEnc, mode: MODES.includes(mode) ? mode : 'llm', jevModel: JEV_MODEL };
}

// Ask Jev. state = the text or object to decide about; questions = { name: { type, instructions, criteria } }.
// Returns the answers object, or throws.
export async function jevDecide(key, state, questions) {
  const res = await fetch('https://openrouter.ai/api/alpha/decisions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'SB Ops' },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.answers) throw new Error(body?.error?.message || `Jev returned ${res.status}`);
  return body.answers;
}
export async function getAssistantKey() {
  const enc = await getAppSetting('assistant_key_enc');
  return enc ? decryptSecret(enc) : null;
}
export async function saveAssistantSettings({ model, key, mode }) {
  if (mode !== undefined && MODES.includes(mode)) await setAppSetting('assistant_mode', mode);
  if (model !== undefined) await setAppSetting('assistant_model', String(model).trim() || DEFAULT_MODEL);
  if (key !== undefined) await setAppSetting('assistant_key_enc', key ? encryptSecret(String(key).trim()) : '');
}

let sections = null;
export function allHelpSections() { return (sections ??= helpSections(DEPARTMENT_HELP)); }
