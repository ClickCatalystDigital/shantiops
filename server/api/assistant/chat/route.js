import { NextResponse } from 'next/server';
import { getFreshSessionUser, isAdmin, isInternal, isPM, headDepartments } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { getAssistantSettings, getAssistantKey, allHelpSections, jevDecide, openRouterError, canManageAssistant, useQuestion, OPENROUTER } from '@/lib/assistant';
import { takeDemoAiQuestion, returnDemoAiQuestion, DEMO_AI_QUESTIONS } from '@/lib/demo-leads';
import { pickSections, deptOfPath, kindQuestion, sectionQuestion, asIsQuestion, toolQuestion, ranked, guideAnswer, CANNED, screenList } from '@/lib/assistant-help.mjs';
import { toolsFor } from '@/lib/assistant-data';
import { actionsFor, fill } from '@/lib/assistant-actions';

export const dynamic = 'force-dynamic';

const ACTION_KIND = "Asks the app to create, change, mark, record, assign, issue, approve, reject, start, close, cancel or delete a business record, or reports something that happened that the app keeps a record of (for example 'add an enquiry from Mehta Dairy', 'mark QTN-3 accepted', 'hydro test passed on AB-1003', 'Ramesh is absent today', 'spoke to Sunrise Dairy, they want the offer by Friday', 'cutting is done on AB-1005'). Not a question about how to do it.";

// The action Jev chose, made safe: when Jev is unsure (<0.7) or its pick names no real record, prefer the close choice whose
// required records the message actually names (same look-ups as the card, no extra model call); take a plausible runner-up
// (≥0.25) over "none" when its records resolve. Returns { pick, card } or {}.
async function pickAction(rank, question, user, trace) {
  if (!rank.length) return {};
  const cards = {};
  const cardOf = async k => (cards[k] ??= await fill(k, question, user));
  const named = async k => (await cardOf(k)).fields.filter(f => f.type === 'ref' && f.required && f.value != null).length;
  const unresolved = async k => (await cardOf(k)).fields.filter(f => f.type === 'ref' && f.required && f.value == null).length;
  const t = rank[0];
  let pick = t.key !== 'none' && t.p >= 0.5 ? t.key : null;
  const lost = !!(pick && (await unresolved(pick)));
  if (!pick) {
    // "none" (or an unsure pick under 50%): take the likeliest task over 25% whose records the message names.
    for (const alt of rank.filter(x => x.key !== 'none' && x.p >= 0.25)) {
      if (!(await unresolved(alt.key))) { pick = alt.key; trace.push(`runner-up taken: ${alt.key}`); break; }
    }
  }
  // A pick Jev is 90%+ sure of stays even if its record isn't found (the card then asks); a less certain one is weighed.
  if (t.p < 0.7 || (lost && t.p < 0.9)) {
    const close = rank.filter(x => x.key !== 'none' && x.p >= (lost ? 0.01 : 0.15)).slice(0, lost ? 5 : 3);
    if (close.length > 1) {
      const scored = [];
      for (const x of close) scored.push({ key: x.key, n: await named(x.key), p: x.p });
      scored.sort((a, b) => b.n - a.n || b.p - a.p);
      if (scored[0].n > 0 && scored[0].key !== pick) { trace.push(`action tie-break: ${scored.map(x => `${x.key}=${x.n}`).join(' ')}`); pick = scored[0].key; }
    }
  }
  return pick ? { pick, card: await cardOf(pick) } : {};
}

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
async function decide(key, messages, path, tools, all, actions = []) {
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
  // Actions (lib/assistant-actions.js) are asked in the same call, under neutral ids (a0, a1…) so Jev judges by the
  // descriptions, not by a key's words.
  const kinds = actions.length ? { kind: { ...kindQuestion.kind, criteria: { ...kindQuestion.kind.criteria, action: ACTION_KIND } } } : kindQuestion;
  const actionQ = actions.length ? { action: { type: 'choice', instructions: 'If the latest message asks the app to create, change or record something, which task is it?',
    criteria: { ...Object.fromEntries(actions.map((x, i) => [`a${i}`, x.about])), none: 'None of these: some other change, or not a request to change anything' } } } : null;
  const a = await jevDecide(key, state, { ...kinds, ...asIsQuestion, ...(pool.length ? sectionQuestion(pool) : null), ...(tools.length ? toolQuestion(tools) : null), ...actionQ });
  const k = ranked(a.kind)[0];
  const actionRank = ranked(a.action).map(x => ({ key: x.key === 'none' ? 'none' : actions[Number(x.key.slice(1))]?.key || 'none', p: x.p }));
  const toolTop = ranked(a.tool)[0];
  // A plain command ("mark…", "add…") that an action clearly fits is an action even if Jev read it as a how-to.
  const command = /^\s*(please\s+)?(add|create|mark|log|record|issue|approve|reject|assign|move|close|start|finish|cancel|delete|raise|set)\b/i.test(users.at(-1).content);
  // Jev unsure it is a question (data / how-to under 60%) while an action clearly fits (60%+): it is a request.
  const weakQuestion = ['data', 'howto'].includes(k?.key) && k.p < 0.6 && actionRank[0]?.key !== 'none' && (actionRank[0]?.p || 0) >= 0.6;
  if (k?.key === 'action' || weakQuestion || (command && actionRank[0]?.key !== 'none' && (actionRank[0]?.p || 0) >= 0.5)) return { kind: 'action', sections: [], trace: [`kind: action (${k?.key} ${Math.round((k?.p || 0) * 100)}%)`], actionRank, kindP: k?.key === 'action' ? k.p : 0,
    tool: tools.find(x => x.key === toolTop?.key) || null, toolP: toolTop?.p || 0 };
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
  // Public demo: two questions per visitor (lib/demo-leads.js) instead of the per-person daily limit; a
  // question is given back if the answer fails (see the end of this handler).
  const demoToken = process.env.DEMO_MODE === '1' ? req.cookies.get('demo_lead')?.value : null;
  if (process.env.DEMO_MODE === '1') {
    if (b.dry || b.as) return NextResponse.json({ error: 'Not available in the demo' }, { status: 403 });
    if (!(await takeDemoAiQuestion(demoToken))) return NextResponse.json({ error: `That was your ${DEMO_AI_QUESTIONS} free questions.`, demoLimit: true }, { status: 429 });
    let out;
    try { out = await answer(); } catch (e) { await returnDemoAiQuestion(demoToken).catch(() => {}); throw e; }
    if (!out.ok) await returnDemoAiQuestion(demoToken).catch(() => {}); // an error answer doesn't use up a question
    return out;
  }
  return answer();

  async function answer() {
  // Daily limit per person (set per department in Settings → Assistant). Test runs are not counted.
  const quota = b.dry || process.env.DEMO_MODE === '1' ? { left: null } : await useQuestion(user);
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
  // Actions this person's departments could do (each route still decides on Save).
  const actions = await actionsFor(asker);

  // 1 + 2: decide. If Jev is unavailable, fall back to plain word matching over the whole guide.
  let kind = 'howto', picked, trace, sure = false, tool = null, unsure = false, actionRank = [], kindP = 0, toolP = 0;
  try {
    ({ kind, sections: picked, trace, sure, tool, unsure, actionRank = [], kindP = 0, toolP = 0 } = await decide(key, messages, path, tools, guide, actions));
  } catch (err) {
    const question = messages.filter(m => m.role === 'user').slice(-2).map(m => m.content).join(' ');
    picked = pickSections(guide, question, { pageDept: deptOfPath(path) });
    trace = [`Jev unavailable (${err.message}); matched by words`];
  }

  // Action: a card the person checks and saves (POST /api/assistant/act); nothing changes until they press Save.
  if (kind === 'action') {
    trace.push(`action: ${actionRank.slice(0, 3).map(x => `${x.key} ${Math.round(x.p * 100)}%`).join(', ') || '-'}`);
    const { pick, card } = await pickAction(actionRank, messages.at(-1).content, asker, trace);
    if (b.dry) return NextResponse.json({ kind, action: pick || null, card: card || null, trace });
    if (pick) return NextResponse.json({ type: 'action', text: card.ready ? "Here's what I'll do. Check it and press Save; nothing changes until you do." : "Fill in what's missing, check it and press Save.", card }, { headers: { 'cache-control': 'no-store', ...(quota.left == null ? null : { 'x-left': String(quota.left) }) } });
    // No task fits, Jev wasn't sure it was a request, and a look-up clearly fits: it was a question.
    if (tool && toolP >= 0.8 && kindP < 0.9) { kind = 'data'; trace.push(`no action fits; answering with the look-up ${tool.label}`); }
    else return new Response("I can't do that one from here yet. Ask me how to do it and I'll point you to the screen.", { headers: headers([], null, quota.left) });
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
}
