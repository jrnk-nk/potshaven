# PotsHavenGh

A simple landscaping and decorating workspace for the owner and manager. **Sites** brings each location, its project work, visits, maintenance and follow-ups together. Workers receive instructions through WhatsApp. The owner’s main menu is **Home, Sites, Schedule, Team & vehicles, Design studio**, with Inventory, Company assistant, Portfolio & reports and Manager activity under More. The manager’s menu is **Today, Schedule, Sites, Inventory, Team & vehicles**, with Company assistant under More. Studio, portfolio, hiring, supply approvals, the activity inbox and company settings are owner-only.

Money features are temporarily disabled for **both roles**. Financial pages, amounts, budgets, pay, costs and receipt requests are unavailable in the interface, API and assistant. Existing financial data remains stored; operational edits preserve hidden values. This does not delete or reset the company’s records.

![PotsHavenGh workspace](docs/overview.png)

## Vercel + Supabase

The configured live workspace is [potshaven-ekl2.vercel.app](https://potshaven-ekl2.vercel.app/). The root of `potshaven.vercel.app` redirects there when this configuration is deployed to that Vercel project. All app screens use hash routes, which browsers retain across this redirect. API and media paths are not redirected between hosts.

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
npm run test:assistant   # Saved conversations, site focus, reviewed changes and mobile layout
npm run test:handoff     # Real HTTP owner/manager workflow and isolated PostgreSQL restore
npm run test:workforce   # External worker agreements, assignments, WhatsApp and persistence
npm run test:manager     # Daily brief, operational reminders, assignments and mobile layout
npm run test:manager-access # Authenticated UI/API role boundaries and operational work
npm run test:roles-home  # Operational homes, unified Sites, legacy links and role guards
npm run test:activity    # Owner inbox, unread status, linked sites and manager access limits
```

Browser checks use `/usr/bin/chromium` when available; otherwise run `npx playwright install chromium` or set `CHROMIUM_PATH`. Tests use temporary databases and servers, leaving company records alone. PostgreSQL tests run SQL against PGlite; they do not require or provision a live Supabase account.

## Included workflows

- One Sites workspace for clients, location details, site photos, project work, visit observations, maintenance history, follow-ups and branded visit reports. Old `#places` and `#projects` bookmarks open `#sites`; `#sites?site=ID` opens a specific site. Site visits record plant health, irrigation, work needed, notes and up to four photos without replacing earlier visits.
- Daily jobs, assigned crews and vehicles, ordered routes, checklists, completion photos, and recurring maintenance. Home highlights checklist progress, overdue work, assignment checks, and operational reminders. A daily brief can be reviewed, copied, and opened in WhatsApp for the manager to send. WhatsApp sharing prepares a message for the manager to send; replies do not sync automatically.
- Plant photos, stock counts, usage/restocking history, low-stock alerts and atomic deductions linked to jobs.
- Project deadlines and checklist progress within each site, alongside recurring maintenance visits and assigned people/vehicles.
- Supply requests and owner approvals, equipment servicing, plant care guides, crew skills/workload and transport availability.
- Company staff and external workers with daily, weekly, fixed-term, or job-completion agreements. Save agreement dates, signed references and work instructions; job assignments flag availability and other visits on the same day. Pay fields remain unavailable while money features are disabled.
- A Company assistant with private saved conversations for each role, site-focused planning, recent visit summaries and reviewed job, worker, vehicle, issue and supply-request proposals. Save operational changes explicitly. Its prioritized attention list checks overdue work, unchecked completion tasks, coming-week assignments, low stock, equipment servicing, pending supplies and expiring agreements without a model call. A dated work-plan preview can be copied or opened in WhatsApp; the manager chooses who receives it and sends it.
- Owner Settings includes an explicit assistant response check. This makes one short provider request without company records; configured keys alone are never treated as a verified reply.
- An owner-only Manager activity inbox for saved requests, site visits, job progress/completion, assignments, stock use and other permitted manager changes. Events and their related changes commit together. The inbox shows the latest 100 updates, keeps a durable unread count, and checks every 30 seconds while visible, as well as on focus/reconnection. The shared sign-in is labelled **Manager account**; it does not identify an individual worker.
- Client issues, branded service reports and an owner portfolio.
- A gallery that opens first in the studio: one chosen or latest image per space, with search and favourites. Open a space to attach photos and refine the idea in its own chat. The latest idea stays visible; earlier work is tucked behind one control. Earlier versions stay available for editing, portfolio sharing and branded downloads. Rename, link sites, favourite, and choose the gallery image; compare the original photo with a design. Client presentation mode shows only the friendly space title, image, and company branding. Gallery/portfolio captions and downloaded filenames omit raw instructions and provider/model details. Quick edits fill a draft for review, including a prompt based on plants actually in stock. Unsent text survives a reload in the current signed-in browser tab (sign-out or an account change clears it); in-tab space switching keeps each space’s draft and photos separate. Photo attachments must be re-added after a reload. Include measurements directly in the message when useful; concepts are not construction drawings.

AI replies and concepts need the configured provider key, model access, and billing. Automated tests mock provider requests and do not verify a paid generation against the live account. Reminders and manager activity are in-app. Email, automatic WhatsApp sending and route optimisation are not configured. Activity records start with new manager changes after this feature is installed; existing work is not presented as historical notifications.

## Data protection

Supabase uses a private schema with RLS enabled on every app table and browser-role access revoked. The backend still enforces owner/manager permissions. Sign-out revokes its session in the database so a copied cookie cannot reopen the workspace. Owners can check actual storage and access protection in **Settings → Your saved workspace**.

Saved records and uploaded/generated images persist in the hosted database. Automatic backups and point-in-time recovery are separate Supabase account settings; this app cannot verify or enable them with its database health check. See [data protection and recovery](docs/DATA_PROTECTION.md) for encrypted backup tooling and an isolated restore checklist. The [business handoff drill](docs/BUSINESS_HANDOFF_DRILL.md) tests actual HTTP operations and restoration using disposable PostgreSQL; it does not certify production provider backups.

## Loading and recovery

Pages load on demand. Ordinary changes update the affected record without fetching the entire company again. Uploaded photos are resized before sending, stored separately, and served with role checks. Temporary read failures retry automatically; a later interruption keeps already loaded records visible and prevents saves until reconnected. Writes are never automatically retried, avoiding duplicate stock deductions.

Database health checks perform actual reads on every request. Interrupted PostgreSQL reads retry once on a fresh connection; failed startup releases its connection pool before another attempt. Interrupted response bodies and temporary gateway failures also trigger browser recovery. After an accepted sign-in, a failed workspace load shows the connection error and a retry button; retrying does not require submitting the password again. Expired sessions clear private records and return to sign-in.

Manager edits compare the authorized record with its current database value while holding the write lock. Collection forms can also submit an optional baseline from when they opened. If a newer change conflicts, the save is rejected with the draft retained for review rather than overwriting that change.

Local production: `npm run build && npm start` serves the UI and API together on `PORT` (default3001). Keep backups of the SQLite database, `uploads` and `designs` directories together, using SQLite’s backup API while live. Supabase hosts company records, private activity and media in the same managed database.

A [Dockerfile](Dockerfile) and [Render blueprint](render.yaml) remain available for an alternative SQLite service with a persistent disk; the Render plan is paid and has not been provisioned. No live hosting account is created by these files.

Details: [API](server/API.md) · [PostgreSQL adapter](server/POSTGRES.md) · [Supabase setup](SUPABASE_SETUP.md) · [Reliability and access review](docs/RELIABILITY_REVIEW.md).

The [owner/manager access rules](docs/ROLE_WORKSPACES.md) apply to the interface, API, returned records, assistant context/actions, and private images. Manager operational updates preserve hidden owner fields. Separate sign-in roles receive different workspaces; account changes discard stale private replies.
