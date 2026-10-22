# PotsHaven

A simple workspace for a landscaping and decorating company. The owner and manager run the business here; workers receive prepared instructions through WhatsApp.

![PotsHaven home screen](docs/overview.png)

The everyday menu has five areas: **Home, Schedule, Places, Inventory, and Design studio**. Projects, the team, finance, and reports are under **More tools**. Phone users get the same five everyday areas in a bottom navigation bar. Optional form fields stay collapsed until needed.

## Run locally

Requires **Node.js 24+** (built-in SQLite) and npm.

```sh
npm ci
npm run dev
```

Vite serves the app on port **5173** and proxies the API on **3001**. The first run creates an explicitly labelled demo workspace with fictional records and original botanical illustrations. Photos you upload replace these illustrations. All records persist in `.data/potshaven.db`; generated designs are in `.data/designs`. This data, `.env`, and dependencies are ignored by Git.

```sh
npm run build   # TypeScript + production bundle
npm test        # API, stock transactions, persistence, permissions, recurrence
npm run test:browser     # Isolated desktop/mobile workflows (Chromium required)
npm run test:production  # Check built assets, private sign-in, empty data startup
npm start       # Serve the built app and API together on PORT (default 3001)
```

A running process must be restarted in a fresh environment. The app supports adding a shortcut to the home screen; operations need a network connection to the server.

## Included workflows

- Dashboard with upcoming maintenance, project deadlines, overdue visits/payments, equipment servicing, contract renewals, and low-stock reminders.
- Places and clients, site photos, measurements, access notes, inspection records, and service history.
- Daily crew assignments and manually ordered routes. A WhatsApp share opens a prepared message; the manager chooses the recipient and sends it. Directions open in Google Maps. Replies do not sync into the app.
- Maintenance checklists and completion photos. Weekly, fortnightly, monthly, and quarterly jobs generate one next scheduled visit when marked completed, without duplicate follow-ups.
- Projects, task completion, deadlines, budgets, expenses, and material costs.
- Plant inventory with per-item photos, low-stock thresholds, restocking, and a permanent movement history. Recording stock used against a job atomically reduces availability; insufficient stock is rejected. Stock usage also contributes to job costs.
- Purchase requests with owner approval, tool assignments, equipment servicing, and plant watering/pruning/feeding guides.
- Crew skills and availability, daily workload, vehicles, and fuel/travel costs.
- Maintenance contracts, renewals, payment records, expenses, and client issues.
- Branded service reports that can be downloaded or printed to PDF. Completion photos are included when supplied.
- OpenAI design studio with reference photos, measurements, presets, refinement, saved designs, and watermarked downloads.
- Portfolio of chosen designs and uploaded project photos. Company name, logo, colour, and watermark are editable.

Reminders are currently **in-app**. Email, automatic WhatsApp sending, automated route optimisation, accounting integrations, and deployment are not configured.

## Connect image generation

Copy `.env.example` to a private `.env` and supply `POTSHAVEN_OPENAI_KEY` on the **server**. `OPENAI_API_KEY` is also accepted. The key is never sent to the browser. In the managed cloud environment, add the key securely to the saved requirement in environment settings and allow HTTPS access to `api.openai.com`.

The default is `gpt-image-2.5-sunburst` at `max` quality and `2560x1440` resolution. These parameters were checked against OpenAI's current official Python SDK [model list](https://github.com/openai/openai-python/blob/main/src/openai/types/image_model.py) and [generation parameters](https://github.com/openai/openai-python/blob/main/src/openai/types/image_generate_params.py). Resolutions above 2560×1440 are documented as experimental. Your account still needs access and billing. Change `POTSHAVEN_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`, and `OPENAI_IMAGE_SIZE` to use another supported configuration. When choosing a model without `max` support, use `high` quality.

Image generation and editing use the official Images API through the inherited HTTPS proxy, with TLS verification preserved. The live paid service has not been exercised without a key. Measurements inform concepts; the images are not construction drawings.

## Private use and real records

Set **both** `APP_OWNER_PASSWORD` and `APP_MANAGER_PASSWORD` privately in `.env` or the deployment's secret store before sharing real company records. With neither configured, all visitors get demo owner access; `NODE_ENV=production` alone does **not** enable authentication. Sessions use signed, HTTP-only cookies; manager access cannot edit branding or approve purchases. Use HTTPS for an online deployment.

To begin with real records, choose a **new** directory and disable seeding:

```sh
DATA_DIR=.data-company DATA_SEED=false npm run dev
```

This preserves the demonstration database. Existing databases are never erased or reseeded. An empty workspace has no clients, jobs, stock, or staff; add your company branding and operational records through the app. Changing the currency changes how amounts are displayed; it does not convert existing monetary values.

Keep backups of the SQLite database and `designs` directory together. For a live database, use SQLite's backup command/API instead of copying only the database file while it is being written. Keep `.data/session-secret` if you want existing sign-in sessions to remain valid after restoring a backup; otherwise sessions will need to be renewed.

API details: [server/API.md](server/API.md).

## Publish a live app

The GitHub repository contains the source code. A live website also needs hosting for the Express server and a persistent disk for SQLite and uploaded/generated images; GitHub Pages cannot provide that backend.

A deployment blueprint is included in [render.yaml](render.yaml), with a nonroot Node 24 [Dockerfile](Dockerfile). Connect this repository to a Render Blueprint to create the service. The blueprint requests a **paid Starter service and a 1 GB persistent disk**; review the hosting price before creating it. Automatic deployment is disabled. Owner and manager passwords are generated by the hosting platform; retrieve them privately from the service environment settings. The first deployment starts with an empty company workspace. Add `POTSHAVEN_OPENAI_KEY` privately if you want image generation.

The deployment configuration has been statically checked; no live hosting service has been created from this workspace. The native production build, private sign-in, and persistence workflows are tested separately. CI is included in `.github/workflows/ci.yml` for pushes and pull requests.
