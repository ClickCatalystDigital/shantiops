import { NextResponse } from 'next/server';
import { getFreshSessionUser, isAdmin } from '@/lib/auth';
import { getAssistantSettings, getAssistantKey, allHelpSections, jevDecide, openRouterError, canManageAssistant, OPENROUTER } from '@/lib/assistant';
import { pickSections, deptOfPath, kindQuestion, sectionQuestion, asIsQuestion, toolQuestion, ranked, guideAnswer, CANNED } from '@/lib/assistant-help.mjs';
import { toolsFor } from '@/lib/assistant-data';

export const dynamic = 'force-dynamic';

const SYSTEM = `You are the help assistant inside SB Ops, a manufacturing operations app.
Answer only from the HELP SECTIONS below. They are the app's own guide.
- If the sections do not cover the question, say you could not find it in the guide and name the closest section. Never invent screens, buttons or steps.
- Be short. Use numbered steps for "how do I" questions. Use the exact tab and button names from the guide.
- Plain text only, no markdown symbols.
- You cannot see the company's data (orders, stock, payments). If asked for it, say so and point to the screen that shows it.`;

const DATA_SYSTEM = `You are the assistant inside SB Ops, a manufacturing operations app. Answer the question from the DATA below, which was just read from the company's own records.
- Use only the DATA. Copy numbers and names exactly; never estimate, add up beyond what is shown, or fill gaps.
- Only the fields order_value, received, pending and outstanding are money, in Indian rupees: write those with the rupee sign and Indian digit grouping. Every other number is a count or a quantity: write it plain, with no currency sign.
- Be short: one line of answer, then a brief list if there are several rows. Plain text only, no markdown symbols.
- If the DATA does not answer the question, say what it does show.`;

// Decide what the question is and which guide section answers it: a word-match shortlist, then one
// Jev call. Returns { kind, sections, trace, sure }. Throws if Jev can't be reached; the caller falls back.
async function decide(key, messages, path, tools) {
  const all = allHelpSections();
  const users = messages.filter(m => m.role === 'user');
  const question = users.slice(-2).map(m => m.content).join(' ');
  const pageDept = deptOfPath(path);
  let pool = pickSections(all, question, { pageDept, limit: 24 });
  if (pool.length < 6) pool = [...pool, ...all.filter(s => s.dept === pageDept && !pool.some(p => p.dept === s.dept && p.key === s.key))].slice(0, 40);
  const state = {
    latest_question: users.at(-1).content,
    previous_question: users.at(-2)?.content || null, // so "and how do I undo it?" keeps its subject
    screen_the_user_is_on: path,
  };
  const a = await jevDecide(key, state, { ...kindQuestion, ...asIsQuestion, ...(pool.length ? sectionQuestion(pool) : null), ...(tools.length ? toolQuestion(tools) : null) });
  const kind = ranked(a.kind)[0]?.key || 'howto';
  const trace = [`kind: ${kind} (${Math.round((ranked(a.kind)[0]?.p || 0) * 100)}%)`];
  if (kind === 'data') {
    const tool = tools.find(x => x.key === ranked(a.tool)[0]?.key) || null;
    if (tools.length) trace.push(`look-up: ${tool ? tool.label : 'none fits'} (${Math.round((ranked(a.tool)[0]?.p || 0) * 100)}%)`);
    return { kind, sections: [], trace, tool };
  }
  if (kind !== 'howto' || !pool.length) return { kind, sections: [], trace };

  const s = ranked(a.section);
  // One section when Jev is sure; up to three when it is not.
  const top = s.filter((x, i) => i === 0 || (s[0].p < 0.75 && i < 3 && x.p > 0.1));
  const sections = top.map(x => pool[Number(x.key.slice(1))]).filter(Boolean);
  trace.push(`section: ${sections.map(x => `${x.dept} > ${x.label}`).join(' / ')} (${Math.round((s[0]?.p || 0) * 100)}%)`);
  // Sure of the section AND the question is a plain one: the guide text can be shown as it is.
  return { kind, sections, trace, sure: (s[0]?.p || 0) >= 0.75 && (Number(a.as_is?.noul) || 0) >= 0.6 };
}

const sourcesOf = picked => picked.filter(s => s.key !== 'intro' && s.key !== 'how-to').slice(0, 3)
  .map(s => ({ label: `${s.dept}: ${s.label}`, href: `/help?dept=${encodeURIComponent(s.dept)}&page=${encodeURIComponent(s.key)}` }));
const headers = (picked, trace, link) => ({
  'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
  'x-sources': encodeURIComponent(JSON.stringify(link ? [{ label: 'Open the screen', href: link }] : sourcesOf(picked))), 'x-route': encodeURIComponent(trace.join(' · ')),
});

// POST { messages: [{ role: 'user'|'assistant', content }], path } -> the answer as a plain text stream.
// Help text and the question leave the app; business data only when live-data access is switched on
// (Settings → Assistant, with a recorded approval). Admin-only while under test.
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
  const { model, mode, dataAccess } = await getAssistantSettings();
  const tools = dataAccess.on ? toolsFor(user) : [];

  // 1 + 2: decide. If Jev is unavailable, fall back to plain word matching over the whole guide.
  let kind = 'howto', picked, trace, sure = false, tool = null;
  try {
    ({ kind, sections: picked, trace, sure, tool } = await decide(key, messages, path, tools));
  } catch (err) {
    const question = messages.filter(m => m.role === 'user').slice(-2).map(m => m.content).join(' ');
    picked = pickSections(allHelpSections(), question, { pageDept: deptOfPath(path) });
    trace = [`Jev unavailable (${err.message}); matched by words`];
  }

  // 3: answer. No writing model for greetings, unrelated or live-data questions, or in guide-only mode.
  // Live data: run the look-up Jev chose, as this user. Its rows go to the writing model.
  let data = null;
  if (kind === 'data' && tool) {
    try { data = await tool.run(user, messages.at(-1).content); }
    catch (err) { return NextResponse.json({ error: `Could not read the data: ${err.message}` }, { status: 500 }); }
    trace.push(`${data.rows.length} rows`);
  }
  const noModel = data ? (data.rows.length ? null : `Nothing found. ${data.note || ''}`.trim())
    : kind === 'data' && tools.length ? `I can't look that up yet. I can look up: ${tools.map(x => x.label.toLowerCase()).join(', ')}.`
    : kind !== 'howto' ? CANNED[kind]
    : !picked.length ? 'I could not find this in the guide. Try different words, or open Help from the "i" icon at the top.'
    : mode === 'guide' && sure ? guideAnswer(picked[0])
    : null;
  trace.push(noModel ? 'answered without a writing model' : `written by ${model}`);
  if (b.dry) return NextResponse.json({ kind, tool: tool?.key || null, sections: picked.map(s => `${s.dept} > ${s.label}`), trace, answer: noModel, data });
  if (noModel) return new Response(noModel, { headers: headers(picked, trace, data?.link) });

  const context = picked.map(s => `### ${s.dept} > ${s.label}\n${s.text}`).join('\n\n');
  const system = data
    ? `${DATA_SYSTEM}\n\nLOOK-UP: ${tool.label}\n${data.note ? `NOTE: ${data.note}\n` : ''}DATA (JSON rows)\n${JSON.stringify(data.rows).slice(0, 6000)}`
    : `${SYSTEM}\n\nThe user is on the screen: ${path}\n\nHELP SECTIONS\n${context}`;
  let res;
  try {
    res = await fetch(`${OPENROUTER}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'SB Ops' },
      body: JSON.stringify({
        model, stream: true, temperature: 0.2, max_tokens: 700,
        messages: [{ role: 'system', content: system }, ...(data ? messages.slice(-1) : messages)],
      }),
    });
  } catch (err) {
    return NextResponse.json({ error: `Could not reach OpenRouter: ${err.message}` }, { status: 502 });
  }
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null);
    return NextResponse.json(openRouterError(res.status, detail, canManageAssistant(user)), { status: 502 });
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
  return new Response(stream, { headers: headers(picked, trace, data?.link) });
}
