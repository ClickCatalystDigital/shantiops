# Go-live setup

The order to take SB Ops device/browser control from "built" to "running on employee
machines." Do these once; step 4 repeats per employee.

## 0. Deploy the app

The Next.js app is on Render. Confirm the latest `main` is deployed and the dashboard loads.
Data is in Turso (`TURSO_URL` / `TURSO_AUTH_TOKEN` env). Managers set up their TOTP under
**Settings → USB Approval Authenticator** before they can approve anything.

## 1. Render environment variables

| Var | Value | Needed for |
|-----|-------|-----------|
| `AGENT_LATEST_VERSION` | the agent's `__version__` (e.g. `1.2.0`) | agent auto-update |
| `AGENT_UPDATE_URL` | `https://github.com/clickcatalyst-digital/shantiops/releases/latest/download/ShantiAgentSetup.exe` | agent auto-update |

Both are optional to start; set them once you've cut a release (step 3) and want machines to
self-update. `AGENT_LATEST_VERSION` must exactly match the version you tagged.

## 2. Publish the browser extension (Chrome Web Store)

Your paid developer account is created (finish the verification if still pending).

1. Zip the **contents** of the `extension/` folder (so `manifest.json` is at the zip root — not
   the folder itself).
2. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **Add
   new item** → upload the zip.
3. Fill the listing: name, description, the generated icons are already in the zip
   (`extension/icons/`). For **data use**, declare that it communicates only with a local service
   (`127.0.0.1`) to enforce policy and redirects blocked pages — it collects no personal data.
4. **Visibility: Unlisted** is fine (you don't want a public listing). Submit for review
   (usually 1–3 days).
5. When approved, copy the **extension ID** from the dashboard.

> Until it's published + force-installed, the extension is *test-grade only* — an employee can
> toggle a dev-mode extension off. Force-install (step 3) is what makes it real.

## 3. Cut a release (wires the extension in + makes the installer downloadable)

1. In `agent/installer.iss` set `#define ExtensionId "<the id from step 2>"`.
2. Commit, then tag: `git tag v1.2.0 && git push --tags` (match `agent.py`'s `__version__`).
3. GitHub Actions builds `ShantiAgentSetup.exe` — now including the Chrome + Edge force-install
   keys — and attaches it to the GitHub Release. The `latest/download/...` URL from step 1 now
   resolves to it.

## 4. Onboard each employee (repeat per machine)

1. Dashboard → **Approvals → Devices → Machines** → enter the machine name + pick the employee →
   **Register machine**.
2. Click **Download enroll file** → you get `shanti-enroll.json` (valid 24h, single-use).
3. Give the employee two files (e.g. drop both in their Google Drive folder): the installer
   (`ShantiAgentSetup.exe` from the Release) and their `shanti-enroll.json`.
4. They put both in the same folder and run the installer. It self-enrolls with zero typing; the
   machine appears in the dashboard under their name within a few seconds (green = online).
   - Windows may show "Windows protected your PC" once → **More info → Run anyway** (expected for
     an unsigned installer).
5. Chrome **and** Edge are both covered — the installer writes force-install keys for both.

## Ongoing

- **Updates:** bump `__version__` + `MyAppVersion`, tag a new `vX.Y.Z`, bump
  `AGENT_LATEST_VERSION` on Render. Machines auto-update; the extension auto-updates via the Web
  Store. You never touch an employee machine again.
- **Revoke a machine:** Machines card → **Disable** (the agent is blocked on its next call).
- **Policies:** set website Allow/Block/Approval under **Approvals → Browser**; whitelist a device
  under **Approvals → Devices**.

## Still to verify on real Windows hardware

Everything below was built and tested on macOS (via the simulator + CI's real-registry tests) but
should be confirmed once on an actual managed Windows PC: phone (MTP) and CD blocking taking
effect without a reboot, the published extension's `127.0.0.1` access under Chrome's Local Network
Access rules, and that the force-installed extension can't be removed by the employee.
