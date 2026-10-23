# PotsHavenGh

A simple landscaping and decorating workspace for the owner and manager. Workers receive instructions through WhatsApp. The everyday menu is **Home, Schedule, Places, Inventory, and Design studio**; the Company assistant, projects, team, finance and reports are under **More tools**. On mobile, the studio and assistant use a compact header, larger controls, and a fixed message box.

![PotsHavenGh workspace](docs/overview.png)

## Vercel + Supabase

The Vercel site needs the included serverless backend and a database. Follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md) to create/connect a Supabase project, add its private `DATABASE_URL` plus owner/manager passwords in Vercel, then redeploy. `vercel.json` routes API and authenticated media requests to `api/index.js`; `dist` serves the screens. Hosted records and photos persist in a private PostgreSQL schema, with no temporary SQLite fallback.

The repository has no database credentials. Supabase/Vercel account settings must be connected securely by the account owner. Image generation and the Company assistant share the private `POTSHAVEN_OPENAI_KEY` (or `OPENAI_API_KEY`); it stays on the server. `POTSHAVEN_ASSISTANT_MODEL` optionally overrides the text model.

## Local development

Requires **Node.js 24** and npm:

```sh
npm ci
npm run dev
```

The screens and API run together on **one port, 5173**, using `server/dev.js`. `PORT` changes both together. Run the npm command rather than launching Vite alone. Paths are resolved from the project, so launching from another working directory works.

Local development uses SQLite at `.data/potshaven.db` with clearly labelled fictional demonstration records. Photos are stored in `.data/uploads` and generated images in `.data/designs`; no photos or secrets are committed to Git. Supabase is not needed for local development. To start a separate empty local company workspace while preserving the demo, use a new directory:

```sh
DATA_DIR=.data-company DATA_SEED=false npm run dev
```

Copy `.env.example` to a private `.env` for local configuration. Set both `APP_OWNER_PASSWORD` and `APP_MANAGER_PASSWORD` before sharing real company records. Without them the local app is explicitly a demo with owner access. Production hosting must use HTTPS.

## Checks

```sh
npm run build            # TypeScript + production bundle
npm test                 # SQLite, PostgreSQL, API, media and cloud-handler tests
npm run test:production  # Production assets, private sign-in, empty workspace
npm run test:browser     # Operations, inventory, recovery, images, studio, assistant, workforce and sign-in
npm run test:studio      # Photo attachments, saved chats, edits and mobile composer
npm run test:auth        # Owner/manager sign-in, expiry and workspace-load recovery
npm run test:assistant   # Grounded attention, reviewed changes, failures and mobile layout
npm run test:workforce   # External worker agreements, assignments, WhatsApp and persistence
npm run test:manager     # Daily brief, operational reminders, assignments and mobile layout
```

Browser checks use `/usr/bin/chromium` when available; otherwise run `npx playwright install chromium` or set `CHROMIUM_PATH`. Tests use temporary databases and servers, leaving company records alone. PostgreSQL tests run SQL against PGlite; they do not require or provision a live Supabase account.

## Included workflows

- Places, clients, measurements, site photos, inspections, and maintenance history.
- Daily jobs, assigned crews and vehicles, ordered routes, checklists, completion photos, and recurring maintenance. Home highlights checklist progress, overdue work, assignment checks, and operational reminders. A daily brief can be reviewed, copied, and opened in WhatsApp for the manager to send. WhatsApp sharing prepares a message for the manager to send; replies do not sync automatically.
- Plant photos, stock counts, usage/restocking history, low-stock alerts and atomic deductions linked to job costs.
- Projects, deadlines, task progress, budgets, direct costs, and stock consumption costs.
- Purchase approvals, equipment servicing, plant care guides, crew skills/workload and transport/fuel costs.
- Company staff and external workers with daily, weekly, fixed-term, or job-completion agreements. Save agreement dates, rates, signed references, and work instructions; job assignments flag availability and other visits on the same day. Rates are agreement records, not recorded payments.
- A Company assistant that answers from saved business records and prepares job, worker, vehicle, and issue changes for review. Save each change explicitly. Its attention list checks overdue jobs, unchecked completion tasks, missing assignments, low stock, and expiring agreements without a model call.
- Maintenance contracts, payments, expenses, client issues, branded service reports and a portfolio.
- A gallery that opens first in the studio: one chosen or latest image per space, with search and favourites. Open a space to attach photos and refine the idea in its own chat. The latest idea stays visible; earlier work is tucked behind one control. Earlier versions stay available for editing, portfolio sharing and branded downloads. Rename, link places, favourite, and choose the gallery image; compare the original photo with a design. Client presentation mode shows only the friendly space title, image, and company branding. Gallery/portfolio captions and downloaded filenames omit raw instructions and provider/model details. Quick edits fill a draft for review, including a prompt based on plants actually in stock. Unsent text survives a reload in the current browser tab; in-tab space switching keeps each space’s draft and photos separate. Photo attachments must be re-added after a reload. Include measurements directly in the message when useful; concepts are not construction drawings.

AI replies and concepts need the configured provider key, model access, and billing. Automated tests mock provider requests and do not verify a paid generation against the live account. Reminders are in-app. Email, automatic WhatsApp sending and route optimisation are not configured.

## Loading and recovery

Pages load on demand. Ordinary changes update the affected record without fetching the entire company again. Uploaded photos are resized before sending, stored separately, and privately cached. Temporary read failures retry automatically; a later interruption keeps already loaded records visible and prevents saves until reconnected. Writes are never automatically retried, avoiding duplicate stock deductions.

Database health checks perform actual reads on every request. After an accepted sign-in, a failed workspace load shows the connection error and a retry button; retrying does not require submitting the password again. Expired sessions clear private records and return to sign-in.

Local production: `npm run build && npm start` serves the UI and API together on `PORT` (default3001). Keep backups of the SQLite database, `uploads` and `designs` directories together, using SQLite’s backup API while live. Supabase hosts these records and media in the same managed database. Currency settings change labels, not existing monetary values.

A [Dockerfile](Dockerfile) and [Render blueprint](render.yaml) remain available for an alternative SQLite service with a persistent disk; the Render plan is paid and has not been provisioned. No live hosting account is created by these files.

Details: [API](server/API.md) · [PostgreSQL adapter](server/POSTGRES.md) · [Supabase setup](SUPABASE_SETUP.md).

The [owner/manager workspace split](docs/ROLE_WORKSPACES_PROPOSAL.md) is a proposal awaiting user review. It is not an implemented permission change. Existing role authorization remains in place.
