// lib/assistant.js — server side of the in-app help assistant (admin-only while it is being tested).
// Settings live in app_settings; the OpenRouter key is stored encrypted (lib/crypto.js).
import { getAppSetting, setAppSetting } from './db';
import { encryptSecret, decryptSecret } from './crypto';
import { DEPARTMENT_HELP } from '@/components/department-help-content';
import { helpSections } from './assistant-help.mjs';

export const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it';
export const OPENROUTER = 'https://openrouter.ai/api/v1';

export async function getAssistantSettings() {
  const [model, keyEnc] = await Promise.all([getAppSetting('assistant_model'), getAppSetting('assistant_key_enc')]);
  return { model: model || DEFAULT_MODEL, hasKey: !!keyEnc };
}
export async function getAssistantKey() {
  const enc = await getAppSetting('assistant_key_enc');
  return enc ? decryptSecret(enc) : null;
}
export async function saveAssistantSettings({ model, key }) {
  if (model !== undefined) await setAppSetting('assistant_model', String(model).trim() || DEFAULT_MODEL);
  if (key !== undefined) await setAppSetting('assistant_key_enc', key ? encryptSecret(String(key).trim()) : '');
}

let sections = null;
export function allHelpSections() { return (sections ??= helpSections(DEPARTMENT_HELP)); }
