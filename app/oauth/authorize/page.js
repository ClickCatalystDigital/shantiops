// "Connect Claude to SB Ops?" — the consent step of the MCP sign-in (lib/oauth.js). The middleware sends a signed-out
// person to /login first and back here after. Allow posts to /oauth/approve.
import { notFound } from 'next/navigation';
import { getFreshSessionUser, isPM } from '@/lib/auth';
import { checkAuthorize } from '@/lib/oauth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connect an AI app' };
const FIELDS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];

export default async function Authorize({ searchParams }) {
  if (process.env.DEMO_MODE === '1') notFound();
  const p = await searchParams;
  const user = await getFreshSessionUser();
  let client = null, problem = null;
  try { client = await checkAuthorize(p); } catch (e) { problem = e.message; }
  if (!problem && (!isPM(user) || user.view_dept)) problem = 'Only managers and admins can connect an AI app. Ask one of them, or sign in with that login.';
  return (
    <div className="container flex min-h-[70vh] items-center justify-center py-10">
      <div className="w-full max-w-md rounded-xl border bg-card p-6">
        {problem ? (
          <><h1 className="text-xl font-semibold">Couldn’t connect</h1><p className="mt-2 text-sm text-muted-foreground">{problem}</p></>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Connect {client.name} to SB Ops?</h1>
            <p className="mt-1 text-sm text-muted-foreground">Signed in as <span className="font-medium text-foreground">{user.display_name || user.username}</span>.</p>
            <ul className="mt-4 flex flex-col gap-2 text-sm">
              <li>• It can ask Ember AI anything you could ask it in the app: how-to, and live data when that is switched on.</li>
              <li>• It can prepare everyday changes (enquiries, milestones, POs, QC records…). Each one is shown to you there first, and made only when you confirm it.</li>
              <li>• It acts as you: it sees and does only what your login may.</li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">You can disconnect it any time in Settings → Assistant.</p>
            <form method="post" action="/oauth/approve" className="mt-5 flex justify-end gap-2">
              {FIELDS.filter(k => p[k]).map(k => <input key={k} type="hidden" name={k} value={p[k]} />)}
              <button name="decision" value="deny" className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
              <button name="decision" value="allow" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90">Allow</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
