# Project structure and naming

Shanti Ops is intentionally a single Next.js application, but its boundaries are domain-based.
Keep new work within the existing shape unless a change clearly improves a whole domain.

## Where code belongs

- `app/`: routes and route handlers. `/` is shared Home, `/ops` is Operations, and `/projects` is
  the common Projects workspace. Page folders follow the public URL; API folders follow the
  resource name and use `route.js`.
- `components/`: reusable UI. Use PascalCase `.jsx` names; `components/ui/` contains shared
  presentation primitives. Department help content lives in `department-help-content.jsx` and
  its shared interactive sidebar lives in `DepartmentHelpWorkspace.jsx`; workspace-level section
  navigation uses `WorkspaceSidebar.jsx`.
- `lib/`: server/domain logic and pure utilities. Use lowercase kebab-case for new files. Keep
  database access in `db.js` and domain behavior in the relevant domain module.
- `scripts/`: repeatable maintenance and self-checks. Use lowercase kebab-case `.mjs` or `.js`
  names; scripts should be safe to rerun unless explicitly labeled destructive.
- `agent/`: Windows agent source, installer, and agent-specific documentation.
- `extension/`: the Chrome/Edge MV3 extension, with its own manifest and no bundler.
- `docs/`: setup, structure, onboarding, and future planning documents. Historical build plans stay
  at the repository root for compatibility with existing links.

## Compatibility rules

Do not rename public routes, database tables, or imported files casually. `/production` is the
legacy route name for the cross-department Tasks surface, and `TicketsPanel.jsx` is the legacy
component name for the cross-department task/reopen panel. Rename them only with redirects/import
migrations and a documentation update.

Keep secrets and local data out of git: `.env.local`, `*.db`, build output, and OS metadata are
ignored. Production must set `SESSION_SECRET`; the development fallback is deliberately not safe
for deployment.

## Help content conventions

Keep internal department help data in `components/department-help-content.jsx`. Each department
should provide an introduction, ordered feature entries with icons, and a final How To checklist.
Keep department-specific wording in its own guide so a Marketing guide cannot accidentally display
Sales terminology. The `/help` page handles role filtering; the content file should not contain
authorization logic.
