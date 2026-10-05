import { NextResponse } from 'next/server';
import { getFreshSessionUser, isAdmin } from '@/lib/auth';
import { getAssistantSettings, getAssistantKey, allHelpSections, jevDecide, openRouterError, OPENROUTER } from '@/lib/assistant';
import { pickSections, deptOfPath, triageQuestions, deptSummaries, sectionQuestion, ranked, guideAnswer, CANNED } from '@/lib/assistant-help.mjs';

export const dynamic = 'force-dynamic';

const SYSTEM = `You are the help assistant inside SB Ops, a manufacturing operations app.
Answer only from the HELP SECTIONS below. They are the app's own guide.
- If the sections do not cover the question, say you could not find it in the guide and name the closest section. Never invent screens, buttons or steps.
- Be short. Use numbered steps for "how do I" questions. Use the exact tab and button names from the guide.
- Plain text only, no markdown symbols.
- You cannot see the company's data (orders, stock, payments). If asked for it, say so and point to the screen that shows it.`;

// Decide what the question is and which guide section answers it, using Jev (two small calls).
// Returns { kind, sections, trace }. Throws if Jev can't be reached; the caller then falls back.
async function decide(key, messages, path) {
  const all = allHelpSections();
  const users = messages.filter(m => m.role === 'user');
  const state = {
    latest_question: users.at(-1).content,
    previous_question: users.at(-2)?.content || null, // so "and how do I undo it?" keeps its subject
    screen_the_user_is_on: path,
  };
  const t = await jevDecide(key, state, triageQuestions(deptSummaries(all)));
  const kind = ranked(t.kind)[0]?.key || 'howto';
  const trace = [`kind: ${kind} (${Math.round((ranked(t.kind)[0]?.p || 0) * 100)}%)`];
  if (kind !== 'howto') return { kind, sections: [], trace };

  // Department: Jev's pick, plus the runner-up when it is not sure.
  const depts = ranked(t.department);
  const chosen = depts.filter((d, i) => i === 0 || (depts[0].p < 0.7 && i === 1 && d.p > 0.15)).map(d => d.key);
  trace.push(`department: ${chosen.join(' / ')} (${Math.round((depts[0]?.p || 0) * 100)}%)`);
  const pool = all.filter(s => chosen.includes(s.dept));
  if (!pool.length) return { kind, sections: [], trace };

  const s = ranked((await jevDecide(key, state, sectionQuestion(pool))).section);
  // One section when Jev is sure; up to three when it is not.
  const top = s.filter((x, i) => i === 0 || (s[0].p < 0.75 && i < 3 && x.p > 0.1));
  const sections = top.map(x => pool[Number(x.key.slice(1))]).filter(Boolean).map(x => ({ ...x, text: x.text.slice(0, 3500) }));
  trace.push(`section: ${sections.map(x => x.label).join(' / ')} (${Math.round((s[0]?.p || 0) * 100)}%)`);
  return { kind, sections, trace, sure: (s[0]?.p || 0) >= 0.75 };
}

const sourcesOf = picked => picked.filter(s => s.key !== 'intro' && s.key !== 'how-to').slice(0, 3)
  .map(s => ({ label: `${s.dept}: ${s.label}`, href: `/help?dept=${encodeURIComponent(s.dept)}&page=${encodeURIComponent(s.key)}` }));
const headers = (picked, trace) => ({
  'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
  'x-sources': encodeURIComponent(JSON.stringify(sourcesOf(picked))), 'x-route': encodeURIComponent(trace.join(' · ')),
});

// POST { messages: [{ role: 'user'|'assistant', content }], path } -> the answer as a plain text stream.
// Only help text and the question leave the app, never business data. Admin-only while under test.
// { dry: true } returns the decisions without writing an answer.
export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const messages = (Array.isArray(b.messages) ? b.messages : [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-8).map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (messages.at(-1)?.role !== 'user') return NextResponse.json({ error: 'Ask a question first' }, { status: 400 });
  const path = String(b.path || '/').slice(0, 100);

  let key;
  try { key = await getAssistantKey(); } catch { key = null; }
  if (!key) return NextResponse.json({ error: 'No OpenRouter key yet. Add one in Settings → Assistant.' }, { status: 400 });
  const { model, mode } = await getAssistantSettings();

  // 1 + 2: decide. If Jev is unavailable, fall back to plain word matching over the whole guide.
  let kind = 'howto', picked, trace, sure = false;
  try {
    ({ kind, sections: picked, trace, sure } = await decide(key, messages, path));
  } catch (err) {
    const question = messages.filter(m => m.role === 'user').slice(-2).map(m => m.content).join(' ');
    picked = pickSections(allHelpSections(), question, { pageDept: deptOfPath(path) });
    trace = [`Jev unavailable (${err.message}); matched by words`];
  }

  // 3: answer. No writing model for greetings, unrelated or live-data questions, or in guide-only mode.
  const noModel = kind !== 'howto' ? CANNED[kind]
    : !picked.length ? 'I could not find this in the guide. Try different words, or open Help from the "i" icon at the top.'
    : mode === 'guide' && sure ? guideAnswer(picked[0])
    : null;
  trace.push(noModel ? 'answered without a writing model' : `written by ${model}`);
  if (b.dry) return NextResponse.json({ kind, sections: picked.map(s => `${s.dept} > ${s.label}`), trace, answer: noModel });
  if (noModel) return new Response(noModel, { headers: headers(picked, trace) });

  const context = picked.map(s => `### ${s.dept} > ${s.label}\n${s.text}`).join('\n\n');
  let res;
  try {
    res = await fetch(`${OPENROUTER}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'SB Ops' },
      body: JSON.stringify({
        model, stream: true, temperature: 0.2, max_tokens: 700,
        messages: [{ role: 'system', content: `${SYSTEM}\n\nThe user is on the screen: ${path}\n\nHELP SECTIONS\n${context}` }, ...messages],
      }),
    });
  } catch (err) {
    return NextResponse.json({ error: `Could not reach OpenRouter: ${err.message}` }, { status: 502 });
  }
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null);
    return NextResponse.json(openRouterError(res.status, detail), { status: 502 });
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
  return new Response(stream, { headers: headers(picked, trace) });
}
