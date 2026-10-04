# Next steps: selling SB Ops to new customers

Status on 2026-10-05. This file records what is already built for a second customer and the ideas
discussed for pricing, payment, onboarding and demo data. The ideas are **not built** unless the
"Built" section says so.

## 1. Decided

- **One deployment per customer.** Each customer gets its own database, file storage bucket and
  environment settings. Customers never share a database.
- **First customer keeps its data.** Everything in today's database belongs to the first customer
  (three companies). A new customer starts empty.
- **Boiler manufacturers only for now.** Other kinds of manufacturers come later.
- **Customers are never admin.** Only our company holds the admin role.

## 2. Built

| What | How it works |
|---|---|
| Company details in one place | Accounts → Company Entities. Name, address, contacts, codes and logo are data, not code. Every document reads them. |
| Logo upload, crop and per-document header design | Company Entities → Document details and design. |
| Company limit per deployment | `MAX_COMPANIES` setting, default 3. Set by us, not by the customer. |
| Clean start for a new customer | Setting `CUSTOMER_SEED` (the customer's companies, as JSON) makes a new deployment start with those companies and one `admin` login. No sample projects, no demo logins. |
| Customer values out of code | Only `lib/customer-seed.js` holds the first customer's values, used to seed an empty database. |

### Setting up a new customer today (manual)

1. Create a Turso database and token.
2. Create an R2 bucket and keys.
3. Set `SESSION_SECRET`, `SECRETS_KEY`, `BRAND_PREFIX`, `CUSTOMER_SEED`, `MAX_COMPANIES`, `ADMIN_PASSWORD`, `RATE_SYNC_KEY`.
4. Deploy. The first start creates the companies and the admin login.
5. In Accounts → Company Entities, fill document details and upload logos.
6. Import the customer's masters (items, customers, suppliers, employees).

## 3. Ideas, not built

### 3.1 Pricing by module

| Module | Contains | Sold as |
|---|---|---|
| Device & Data Security | Windows agent, browser extension, approvals | Separate add-on |
| CRM | Sales and Marketing | Separate |
| HR | HR and Payroll | Separate |
| Manufacturing ERP | Design, Engineering, Procurement, Stores, Production, QC, Dispatch, Service | Separate |
| **ERP 360** | CRM + Manufacturing ERP + HR | Bundle |

Open points:

- **Accounts is not in the list.** Suggested home: Manufacturing ERP, because invoices, purchase
  bills and dispatch freight all post to it.
- A module must be switched off on the server (its routes refuse), not only hidden in the menu.
- Suggested mechanism: a per-deployment module list set by us, the same way as the company limit.

### 3.2 Advertising modules the customer has not bought

- Show the module's tab greyed out. Opening it shows a short page: what it does, and "ask us to
  enable it".
- No pop-ups. These are daily-use screens for shop-floor staff.

### 3.3 Admin stays with us

- Split today's admin into two roles:
  - **Vendor admin (us):** plan, modules, company limit, storage.
  - **Customer owner:** their own users, access and settings.
- Today the first customer's staff hold the `admin`, `manager` and `executive` logins. Moving them
  to a customer-owner role is part of this work.

### 3.4 Storage plans

- Four cards: 100 GB, 500 GB, 2 TB, 5 TB (Cloudflare R2).
- The customer picks one and pays through our system.
- Needs: a storage meter per deployment, a limit check on upload, and a warning before the limit.

### 3.5 Payment, then deployment

- Flow: customer chooses modules, storage and (later) cloud region → pays → a new instance is created.
- Creating an instance means doing section 2's manual steps by script.
- **Choice of cloud provider: later.** The app is tied to Turso, R2-style storage and a Node host.
  Offering a region is cheap. Offering a different provider means supporting a second database and
  storage setup, which only pays off for a large customer.

### 3.6 Free trial and demo data

- A public demo instance on a free Turso database (under 5 GB).
- Demo data is produced by us later. It is separate from the first customer's data.
- Paying customers get their own paid database; nothing in the code changes for that.

### 3.7 Onboarding a customer

A guided first-run, in this order:

1. Companies: names, GSTIN, addresses, logos.
2. Users and departments.
3. Masters: items, customers, suppliers, employees (Excel import).
4. Opening stock and open orders, if they want history.
5. Document check: print one of each document and confirm the header.

### 3.8 Beyond boiler manufacturers

Still boiler-specific today: the product name pattern, QC series and IBR statutory forms, the
milestone template, job card stages, and help-text examples. Each needs to become configurable
before a non-boiler customer.

## 4. Suggested order

1. Module list per deployment, enforced on the server.
2. Vendor admin and customer owner roles.
3. Setup script for a new deployment.
4. Demo instance with our own demo data.
5. Storage meter and plans.
6. Payment.
7. Onboarding wizard.
