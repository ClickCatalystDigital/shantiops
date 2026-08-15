# Shanti Ops

Manufacturing operations platform for Shanti Boilers (SLA/milestone tracking, Master BOM Excel
import with department-scoped editing, dispatch/packing), plus a device/browser security platform
(USB/CD/phone blocking + website policy, manager-approved via TOTP). One app, one database.

**→ See [SYSTEM.md](SYSTEM.md) for everything** — features, architecture, roles, data model, known
gaps, and setup. This README is intentionally just the entry point.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

Data lives in **Turso** when `TURSO_URL` + `TURSO_AUTH_TOKEN` are set in `.env.local` (they are);
otherwise it falls back to a local SQLite file. First run auto-seeds demo data.

## Demo logins

| Login | Password | Role |
|-------|----------|------|
| `admin` | `admin123` | PM — everything |
| `manager` | `manager123` | PM — everything |
| `executive` | `executive123` | PM — everything, plus approves PM-tier registrations |
| `design_head` | `design_head123` | Functional Head (Design) |
| `engg_head` | `engg_head123` | Functional Head (Engineering) |
| `procurement_head` | `procurement_head123` | Functional Head (Procurement) |
| `stores_head` | `stores_head123` | Functional Head (Stores) |
| `production_head` | `production_head123` | Functional Head (Production) |
| `qc_head` | `qc_head123` | Functional Head (QC) |
| `dispatch_head` | `dispatch_head123` | Functional Head (Dispatch) |
| `installation_head` | `installation_head123` | Functional Head (Installation) |
| `asian_brown` | `asian_brown123` | Customer — 1 order |
| `hkm_charitable` | `hkm_charitable123` | Customer — 3 orders (My Orders page) |
| `virchow_biotech` | `virchow_biotech123` | Customer — 1 order |

New accounts can self-register from the login page ("Request access") as a **department head**
(Project Manager accounts are created internally only) and need a manager/executive/admin approval
before they can sign in — see SYSTEM.md §2a.

The table above is the full demo-account picker at **`/d-login`** (password-gated, internal use —
see SYSTEM.md §2c); `/login` itself is the plain sign-in page shown to real users.

## Other docs

- [docs/PROJECT-STRUCTURE.md](docs/PROJECT-STRUCTURE.md) — repository layout and naming rules
- [agent/README.md](agent/README.md) — Windows agent build/test commands
- [docs/SETUP.md](docs/SETUP.md) — security-platform go-live checklist
- [docs/v4-zoho-mail-brainstorm.md](docs/v4-zoho-mail-brainstorm.md) — future milestone framing
