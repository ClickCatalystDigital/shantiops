# What we need from the client to switch email on

Everything is built and waiting. Until these are supplied, sending an email shows a message saying which one is missing, and nothing is half-created.

## For each company (Shanti Boilers, Shanti Techno Fab)
1. **A sending mailbox** in Zoho Mail, e.g. `sales@…` (or `noreply@…`). This is the address customers see.
2. **Two-step verification turned on** for that mailbox (Zoho only allows app passwords once it is on).
3. **An app password** for it: Zoho Accounts → Security → App Passwords → generate one named "Shanti Ops".
4. **SMTP access enabled** for the mailbox (Zoho Mail → Settings → Mail Accounts → SMTP; on some plans an admin must allow it).
5. **Which Zoho region** the account is on: `smtp.zoho.in` (India) or `smtp.zoho.com`. Default is `.in`.

## Optional
- Whether each salesperson should also send from their own mailbox (they can save it under Sales → Setup → Email → My email).
- A Reply-To address if replies should go somewhere other than the sending mailbox.
- Zoho's daily send limit for the plan (a few hundred a day on most plans) — relevant before enabling customer status emails for everyone.

## On our side (one-off)
- Set `SECRETS_KEY` (any 32-byte base64 value, `openssl rand -base64 32`) on the live server as well as locally. Passwords are stored encrypted with it. (`EWAY_BILL_CREDENTIALS_KEY` also works if already set.)
- Enter the mailbox + app password in Sales → Setup → Email, press **Send test email**, then switch **Test → Live** once it works. In test mode nothing reaches a real customer.

## Customer data
- Only about 300 of the ~9,500 customers have an email address. Portal invites can be emailed only to those; for the rest, use **Copy link** in Sales → Setup → Portal Access and send it by WhatsApp.
