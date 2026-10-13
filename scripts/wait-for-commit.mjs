// Deploy workflow: waits until <base>/api/version reports <commit>, then checks <path> answers.
//   node scripts/wait-for-commit.mjs https://example.com <sha> /login
const [base, sha, path = '/'] = process.argv.slice(2);
if (!base || !sha) throw new Error('usage: wait-for-commit.mjs <base-url> <commit> [path]');
// Render builds only the newest push, so when commits land close together the one we wait for may never be
// served on its own. A newer commit that contains it counts (checked with GitHub's compare API in CI).
async function contains(served) {
  if (served === sha) return true;
  const { GITHUB_REPOSITORY: repo, GITHUB_TOKEN: token } = process.env;
  if (!repo || !token || !/^[0-9a-f]{40}$/.test(served || '')) return false;
  const r = await fetch(`https://api.github.com/repos/${repo}/compare/${sha}...${served}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } });
  return r.ok && (await r.json()).status === 'ahead';
}
const deadline = Date.now() + 25 * 60 * 1000; // Render's free plan builds take ~10 minutes
let last = '';
while (Date.now() < deadline) {
  try {
    const r = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(60000) });
    const v = r.ok ? (await r.json()).commit : `HTTP ${r.status}`;
    if (await contains(v)) {
      const page = await fetch(`${base}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(120000) });
      if (page.status >= 400) throw new Error(`${base}${path} answered ${page.status}`);
      console.log(`${base} serves ${v.slice(0, 7)}${v === sha ? '' : ` (newer, contains ${sha.slice(0, 7)})`}; ${path} answered ${page.status}`);
      process.exit(0);
    }
    if (v !== last) console.log(`${base} serves ${v || 'unknown'}, waiting for ${sha.slice(0, 7)}`);
    last = v;
  } catch (e) {
    if (String(e.message).includes('answered')) throw e;
    console.log(`${base}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 20000));
}
throw new Error(`${base} did not serve ${sha} within 25 minutes`);
