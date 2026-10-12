import { NextResponse } from 'next/server';
import { getFreshSessionUser, isAdmin, isInternal, isPM, headDepartments } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { getAssistantSettings, getAssistantKey, allHelpSections, jevDecide, openRouterError, canManageAssistant, useQuestion, OPENROUTER } from '@/lib/assistant';
import { pickSections, deptOfPath, kindQuestion, sectionQuestion, asIsQuestion, toolQuestion, ranked, guideAnswer, CANNED, screenList } from '@/lib/assistant-help.mjs';
import { toolsFor } from '@/lib/assistant-data';

export const dynamic = 'force-dynamic';

const SYSTEM = `You are the help assistant inside SB Ops, a manufacturing operations app. Answer from the HELP SECTIONS below; they are the app's own guide.
How to answer:
1. Start with "Open " followed by the path of the tab where the work is done, copied exactly from SCREENS AND TABS (for example: Open /stores/gir). The app shows the path as a link with the tab's name. Prefer a tab's path over its screen's; if no tab clearly fits, use the screen's path. The list holds only the screens this user can open: never write a path that is not in it, even if a help section names another screen.
2. Then give the steps or explanation from the section, in short numbered steps. A section written as a description is still the answer: turn what it says into steps. Use the guide's exact tab and button names.
3. Only if the sections say nothing useful about the question, say so in one line and name the closest section. Never invent screens, buttons or steps.
Plain text only, no markdown symbols. Keep it short.
You cannot see the company's data (orders, stock, payments). If asked for it, say so and point to the screen that shows it.`;

const DATA_SYSTEM = `You are the assistant inside SB Ops, a manufacturing operations app. Answer the question from the DATA below, which was just read from the company's own records.
- Use only the DATA. Copy numbers and names exactly; never estimate, add up beyond what is shown, or fill gaps.
- Only the fields order_value, received, pending and outstanding are money, in Indian rupees: write those with the rupee sign and Indian digit grouping. Every other number is a count or a quantity: write it plain, with no currency sign.
- Be short: one line of answer, then a brief list if there are several rows. Plain text only, no markdown symbols.
- If the DATA does not answer the question, say what it does show.`;

// Decide what the question is and which guide section answers it: a word-match shortlist, then one
// Jev call. Returns { kind, sections, trace, sure }. Throws if Jev can't be reached; the caller falls back.
async function decide(key, messages, path, tools, all) {
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
  const k = ranked(a.kind)[0];
  const s = ranked(a.section);
  // "Unrelated" is only trusted at 90%+. Below that, if Jev is confident a guide section matches
  // (60%+), it is an awkwardly worded question about the app, e.g. "where is hydro test".
  const kind = k?.key === 'other' && k.p < 0.9 && s[0]?.key !== 'none' && (s[0]?.p || 0) >= 0.6 ? 'howto' : k?.key || 'howto';
  const trace = [`kind: ${kind} (${Math.round((k?.p || 0) * 100)}%)`];
  if (kind === 'data') {
    const tool = tools.find(x => x.key === ranked(a.tool)[0]?.key) || null;
    if (tools.length) trace.push(`look-up: ${tool ? tool.label : 'none fits'} (${Math.round((ranked(a.tool)[0]?.p || 0) * 100)}%)`);
    return { kind, sections: [], trace, tool };
  }
  if (kind !== 'howto' || !pool.length) return { kind, sections: [], trace };

  // Jev says no section fits: nothing to write from.
  if (s[0]?.key === 'none') { trace.push(`section: none fits (${Math.round(s[0].p * 100)}%)`); return { kind, sections: [], trace }; }
  // One section when Jev is sure; up to three when it is not.
  const top = s.filter(x => x.key !== 'none').filter((x, i) => i === 0 || (s[0].p < 0.75 && i < 3 && x.p > 0.1));
  const sections = top.map(x => pool[Number(x.key.slice(1))]).filter(Boolean);
  trace.push(`section: ${sections.map(x => `${x.dept} > ${x.label}`).join(' / ')} (${Math.round((s[0]?.p || 0) * 100)}%)`);
  // Sure of the section AND the question is a plain one: the guide text can be shown as it is.
  // Under 30% Jev is guessing: don't spend a writing model on it, offer the closest sections instead.
  if ((s[0]?.p || 0) < 0.3) return { kind, sections, trace, unsure: true };
  return { kind, sections, trace, sure: (s[0]?.p || 0) >= 0.75 && (Number(a.as_is?.noul) || 0) >= 0.6 };
}

const sourcesOf = picked => picked.filter(s => s.key !== 'intro' && s.key !== 'how-to').slice(0, 3)
  .map(s => ({ label: `${s.dept}: ${s.label}`, href: s.href || `/help?dept=${encodeURIComponent(s.dept)}&page=${encodeURIComponent(s.key)}` }));
const headers = (picked, link, left) => ({
  'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
  'x-sources': encodeURIComponent(JSON.stringify(link ? [{ label: 'Open the screen', href: link }] : sourcesOf(picked))), ...(left === null || left === undefined ? null : { 'x-left': String(left) }),
});

// POST { messages: [{ role: 'user'|'assistant', content }], path } -> the answer as a plain text stream.
// Help text and the question leave the app; business data only when live-data access is switched on
// (Settings → Assistant, with a recorded approval). Any staff login; each person is answered only
// about their own departments.
// { dry: true } returns the decisions without writing an answer.
export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  // Test options (decide-only runs, the section list, asking as someone else) are for admin.
  if ((b.dry || b.list || b.as) && !isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // { list: true } = the guide's sections, for the test script. No model is called.
  if (b.list) return NextResponse.json({ sections: allHelpSections().map(s => ({ dept: s.dept, key: s.key, label: s.label })) });
  const messages = (Array.isArray(b.messages) ? b.messages : [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-8).map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (messages.at(-1)?.role !== 'user') return NextResponse.json({ error: 'Ask a question first' }, { status: 400 });
  const path = String(b.path || '/').slice(0, 100);

  let key;
  try { key = await getAssistantKey(); } catch { key = null; }
  if (!key) return NextResponse.json({ error: canManageAssistant(user) ? 'No OpenRouter key yet. Add one in Settings → Assistant.' : 'The assistant is not set up yet. Contact Accounts.' }, { status: 400 });
  const { model, mode, dataAccess } = await getAssistantSettings();
  // Daily limit per person (set per department in Settings → Assistant). Test runs are not counted.
  const quota = b.dry ? { left: null } : await useQuestion(user);
  if (quota.ok === false) return NextResponse.json({ error: `You have used today's ${quota.limit} questions. You can ask again tomorrow.` }, { status: 429 });

  // Whose question is it. Normally the signed-in user; in a dry run admin may test as someone else
  // ({ as: username }), to check what a department user would and would not be answered.
  let asker = user;
  if (b.dry && b.as) {
    asker = await queryOne('SELECT * FROM users WHERE username = ? AND active = 1', [String(b.as)]);
    if (!asker) return NextResponse.json({ error: `No active user "${b.as}"` }, { status: 400 });
  }
  // Help: a person is answered only from the guides of the departments they hold (plus the general
  // sections). Admin, managers and executives get every guide. Several departments = all of theirs.
  // Design and Engineering share one workspace (/engineering, Calc Sheets, Drawings), so a holder of
  // either is answered from both guides.
  const own = headDepartments(asker);
  const depts = own.some(d => ['Design', 'Engineering'].includes(d)) ? [...new Set([...own, 'Design', 'Engineering'])] : own;
  const guide = allHelpSections().filter(s => isPM(asker) || s.dept === 'General' || depts.includes(s.dept));
  const viewer = { pm: isPM(asker), depts };
  // assumeData (dry runs only): choose a look-up as if live data were on, without running it. For testing.
  const pretend = !!(b.dry && b.assumeData);
  // Live data: only the look-ups this person's departments may use (lib/assistant-data.js `who`).
  const tools = dataAccess.on || pretend ? toolsFor(asker) : [];

  // 1 + 2: decide. If Jev is unavailable, fall back to plain word matching over the whole guide.
  let kind = 'howto', picked, trace, sure = false, tool = null, unsure = false;
  try {
    ({ kind, sections: picked, trace, sure, tool, unsure } = await decide(key, messages, path, tools, guide));
  } catch (err) {
    const question = messages.filter(m => m.role === 'user').slice(-2).map(m => m.content).join(' ');
    picked = pickSections(guide, question, { pageDept: deptOfPath(path) });
    trace = [`Jev unavailable (${err.message}); matched by words`];
  }

  // 3: answer. No writing model for greetings, unrelated or live-data questions, or in guide-only mode.
  // Live data: run the look-up Jev chose, as this user. Its rows go to the writing model.
  let data = null;
  if (kind === 'data' && tool && !pretend) {
    try { data = await tool.run(asker, messages.at(-1).content); }
    catch (err) { return NextResponse.json({ error: `Could not read the data: ${err.message}` }, { status: 500 }); }
    trace.push(`${data.rows.length} rows`);
  }
  const noModel = pretend && kind === 'data' && tool ? `(test) would run the look-up: ${tool.label}`
    : data ? (data.rows.length ? null : `Nothing found. ${data.note || ''}`.trim())
    : kind === 'data' && tools.length ? `I can't look that up for you. For your department${depts.length > 1 || isPM(asker) ? 's' : ''} I can look up: ${tools.map(x => x.label.toLowerCase()).join(', ')}.`
    : kind !== 'howto' ? CANNED[kind]
    : unsure ? "I'm not sure which part of the guide answers that. The closest sections are linked below. Try asking with the name of the screen or the document."
    : !picked.length ? `I could not find this in ${isPM(asker) ? 'the guide' : 'the guide for your department'}. Try different words, or open Help from the "i" icon at the top.`
    : mode === 'guide' && sure ? guideAnswer(picked[0])
    : null;
  trace.push(noModel ? 'answered without a writing model' : `written by ${model}`);
  if (b.dry) return NextResponse.json({ kind, tool: tool?.key || null, sections: picked.map(s => `${s.dept} > ${s.label}`), trace, answer: noModel, data });
  if (noModel) return new Response(noModel, { headers: headers(picked, data?.link, quota.left) });

  const context = picked.map(s => `### ${s.dept} > ${s.label}\n${s.text}`).join('\n\n');
  const system = data
    ? `${DATA_SYSTEM}\n\nLOOK-UP: ${tool.label}\n${data.note ? `NOTE: ${data.note}\n` : ''}DATA (JSON rows)\n${JSON.stringify(data.rows).slice(0, 6000)}`
    : `${SYSTEM}\n\nSCREENS AND TABS\n${screenList([...new Set(picked.map(s => s.dept))], viewer)}\n\nThe user is on the screen: ${path}\n\nHELP SECTIONS\n${context}`;
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
  return new Response(stream, { headers: headers(picked, data?.link, quota.left) });
}
