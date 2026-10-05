import { NextResponse } from 'next/server';
import { getFreshSessionUser, isAdmin } from '@/lib/auth';
import { getAssistantSettings, getAssistantKey, allHelpSections, OPENROUTER } from '@/lib/assistant';
import { pickSections, deptOfPath } from '@/lib/assistant-help.mjs';

export const dynamic = 'force-dynamic';

const SYSTEM = `You are the help assistant inside SB Ops, a manufacturing operations app.
Answer only from the HELP SECTIONS below. They are the app's own guide.
- If the sections do not cover the question, say you could not find it in the guide and name the closest section. Never invent screens, buttons or steps.
- Be short. Use numbered steps for "how do I" questions. Use the exact tab and button names from the guide.
- Plain text only, no markdown symbols.
- You cannot see the company's data (orders, stock, payments). If asked for it, say so and point to the screen that shows it.`;

// POST { messages: [{ role: 'user'|'assistant', content }], path } -> the answer as a plain text stream.
// Sends the model only help text and the question — no business data. Admin-only while under test.
export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const messages = (Array.isArray(b.messages) ? b.messages : [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-8).map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return NextResponse.json({ error: 'Ask a question first' }, { status: 400 });

  // The last two questions, so a follow-up ("and how do I undo it?") still finds the right section.
  const question = messages.filter(m => m.role === 'user').slice(-2).map(m => m.content).join(' ');
  const picked = pickSections(allHelpSections(), question, { pageDept: deptOfPath(b.path) });
  const context = picked.length
    ? picked.map(s => `### ${s.dept} > ${s.label}\n${s.text}`).join('\n\n')
    : '(No section of the guide matched this question.)';

  // { dry: true } = show which help sections would be sent, without calling the model (for testing).
  if (b.dry) return NextResponse.json({ sections: picked.map(s => `${s.dept} > ${s.label}`), chars: context.length });

  let key;
  try { key = await getAssistantKey(); } catch { key = null; }
  if (!key) return NextResponse.json({ error: 'No OpenRouter key yet. Add one in Settings → Assistant.' }, { status: 400 });
  const { model } = await getAssistantSettings();

  let res;
  try {
    res = await fetch(`${OPENROUTER}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'SB Ops' },
      body: JSON.stringify({
        model, stream: true, temperature: 0.2, max_tokens: 700,
        messages: [{ role: 'system', content: `${SYSTEM}\n\nThe user is on the screen: ${String(b.path || '/').slice(0, 100)}\n\nHELP SECTIONS\n${context}` }, ...messages],
      }),
    });
  } catch (err) {
    return NextResponse.json({ error: `Could not reach OpenRouter: ${err.message}` }, { status: 502 });
  }
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null);
    return NextResponse.json({ error: detail?.error?.message || `OpenRouter returned ${res.status}` }, { status: 502 });
  }

  // OpenRouter streams "data: {json}" lines; pass on only the text.
  const decoder = new TextDecoder(), encoder = new TextEncoder();
  let buf = '';
  const stream = res.body.pipeThrough(new TransformStream({
    transform(chunk, ctl) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try { const t = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content; if (t) ctl.enqueue(encoder.encode(t)); } catch { /* keep-alive or partial line */ }
      }
    },
  }));
  const sources = picked.filter(s => s.key !== 'intro' && s.key !== 'how-to').slice(0, 3)
    .map(s => ({ label: `${s.dept}: ${s.label}`, href: `/help?dept=${encodeURIComponent(s.dept)}&page=${encodeURIComponent(s.key)}` }));
  return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-sources': encodeURIComponent(JSON.stringify(sources)) } });
}
