// The tools /mcp offers, built on the same pieces as Ember AI's chat, so an AI app does exactly what Ember AI does:
//   ask             — the chat itself (server/api/assistant/chat), run in-process as the person: same answers, limits, data rules.
//   propose_action  — one of lib/assistant-actions.js's tasks, checked: a preview plus a confirm token (10 minutes).
//   confirm_action  — runs exactly what was previewed, through the app's own route (lib/assistant-act.js).
// Nothing is written without the confirm step, the same rule as the Save button on the chat's card.
import jwt from 'jsonwebtoken';
import { runAs, signToken, verifyToken } from './auth';
import { actionsFor, check } from './assistant-actions';
import { runAction } from './assistant-act';

const secret = () => process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev-only-insecure-secret');
const sign = (user, action, values) => jwt.sign({ u: user.username, a: action, v: values }, secret(), { expiresIn: '10m', audience: 'mcp-confirm' });

function catalogue(user) {
  return actionsFor(user).map(a => `- ${a.key}: ${a.about} Fields: ${a.fields.map(f => `${f.name}${f.required ? '*' : ''} (${f.type === 'ref' ? `${f.ref} id or name` : Array.isArray(f.options) ? f.options.map(o => o.value).join('|') : f.type})`).join(', ')}`).join('\n');
}

export function toolsFor(user) {
  const keys = actionsFor(user).map(a => a.key);
  return [
    { name: 'ask', title: 'Ask Ember AI', readOnly: true,
      description: 'Ask SB Ops in plain words, exactly as you would ask Ember AI in the app: how to do something, or (when live data is switched on) stock, open purchase orders, order payments, what a customer owes, project progress, approvals waiting, open tasks. Answers only about your own departments.',
      inputSchema: { type: 'object', properties: { question: { type: 'string', description: 'The question, in plain words' } }, required: ['question'] },
      async run({ question }) {
        const q = String(question || '').trim();
        if (!q) throw new Error('question is required');
        const { POST } = await import('../server/api/assistant/chat/route.js');
        const req = new Request('http://assistant.local/api/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: q.slice(0, 1000) }], path: '/' }) });
        const res = await runAs(verifyToken(signToken(user)), () => POST(req));
        if ((res.headers.get('content-type') || '').includes('application/json')) {
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
          if (d.card) return { kind: 'action_suggested', note: 'This is a change. Call propose_action with this action and these fields, show the preview to the person, then confirm_action.', action: d.card.action, fields: d.card.values };
          return d;
        }
        return { kind: 'answer', text: (await res.text()).trim() };
      } },
    { name: 'propose_action', title: 'Prepare a change',
      description: `Prepare one change for the person to approve. Returns a preview, anything missing, and a confirm_token. Show the preview to the person and only call confirm_action after they agree. Dates are YYYY-MM-DD; * marks a required field; record fields take an id or a name/number.\nActions:\n${catalogue(user)}`,
      inputSchema: { type: 'object', properties: { action: { type: 'string', enum: keys }, fields: { type: 'object', description: 'Field values by name' } }, required: ['action', 'fields'] },
      async run({ action, fields }) {
        if (!keys.includes(action)) throw new Error(`Unknown action: ${action}`);
        const c = await check(action, fields || {}, user);
        const preview = Object.fromEntries(c.fields.map(f => [f.label, f.type === 'ref' ? f.display || f.value : f.value]));
        if (!c.ready) {
          const choices = Object.fromEntries(c.fields.filter(f => f.options?.length && f.value == null).map(f => [f.name, f.options]));
          return { ready: false, summary: c.summary, preview, missing: c.missing, errors: c.errors, ...(Object.keys(choices).length ? { choose_from: choices } : {}) };
        }
        return { ready: true, summary: c.summary, preview, risk: c.risk, confirm_token: sign(user, action, c.values), expires_in: '10 minutes' };
      } },
    { name: 'confirm_action', title: 'Make the change', destructive: true,
      description: 'Make a change the person approved: pass the confirm_token from propose_action. Runs through the app exactly as if they did it on screen.',
      inputSchema: { type: 'object', properties: { confirm_token: { type: 'string' } }, required: ['confirm_token'] },
      async run({ confirm_token }) {
        let t;
        try { t = jwt.verify(String(confirm_token || ''), secret(), { audience: 'mcp-confirm' }); } catch { throw new Error('That confirm_token is invalid or expired; call propose_action again'); }
        if (t.u !== user.username) throw new Error('That confirm_token belongs to someone else');
        const r = await runAction(user, t.a, t.v);
        if (!r.ok) throw new Error(r.error);
        return { done: true, summary: r.summary, id: r.result?.id ?? null, open: r.link };
      } },
  ];
}

export const INSTRUCTIONS = 'SB Ops, the operations system of a boiler manufacturer: sales, projects, procurement, stores, production, QC, dispatch, HR and service. Use ask for any question (it answers like Ember AI in the app). To change anything, call propose_action, show the person the preview, and call confirm_action only after they say yes.';
