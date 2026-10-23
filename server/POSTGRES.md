# Durable serverless storage

`createPostgresStore()` provides the asynchronous storage interface used by the Express API. On Vercel it uses PostgreSQL rather than local SQLite or the function's temporary filesystem. An unconfigured cloud deployment must report its missing database connection; it must not silently open an empty local database.

## Supabase connection

Set `DATABASE_URL` privately on the server to the Supabase **transaction pooler** PostgreSQL connection string from the project's Connect panel. `POSTGRES_URL` and `SUPABASE_DB_URL` are also accepted by the adapter. Use the provider's complete connection string, including the project-specific username, database, port, and properly escaped password. Never put this value in a `VITE_*`, `NEXT_PUBLIC_*`, or other browser-visible setting.

The `postgres` driver enables certificate and hostname verification, disables prepared statements for the transaction pooler, limits each function instance to one connection, and closes idle connections after twenty seconds. For Supabase database hosts, it supplements Node's default trust store with both official production database CA certificates from the [Supabase CLI](https://github.com/supabase/cli/tree/37e309e8ed628091c9e4624ac13adf8c8769e51f/apps/cli-go/internal/gen/types/templates), supporting the 2021/2025 certificate rotation. Other database hosts retain Node's default trust store. No database password, connection string, or session secret is returned in workspace state. The HTTP API applies owner/manager authentication and role-based field/collection/media authorization; a browser Supabase anonymous key is not used to query company records.

Known read-only operations retry one transient connection failure after 150 ms, allowing the driver to reconnect a stale pool socket. Authentication, TLS, SQL and schema errors are not retried. Mutations, including SQL functions called with `SELECT`, are never replayed: a lost response may follow a committed stock deduction. Failed cloud initialization closes its pool before the next attempt. A sustained outage still returns a safe 503; these safeguards do not guarantee provider availability.

JSONB parameters use native JavaScript objects because the production driver serializes them automatically. Pre-stringifying them would encode them twice, causing record inserts to fail and settings updates to become arrays. Regression tests apply the actual driver's JSONB serializer before executing SQL, covering the behavior that direct PGlite calls alone do not reproduce.

On startup, the adapter repairs legacy settings made from objects and encoded object patches. It merges patches in order and atomically retains the exact original value in private metadata under `settings-before-json-parameter-fix`. Valid settings, business records, and existing session secrets remain unchanged. Unrecognized data is preserved and reported as an initialization error instead of being discarded.

The adapter creates its schema on first connection. There is no manual SQL-editor setup step. The connection must have permission to create the app's private schema, tables, indexes, and functions. The generated objects are all in **`potshaven_private`**, and schema/table/column/sequence/function access is revoked from `PUBLIC` and any existing Supabase `anon`, `authenticated` and `service_role` roles. Migration 4 enables RLS on the four private tables with no browser policies. The trusted backend/table owner bypasses RLS; the API must still enforce owner/manager permissions. `FORCE ROW LEVEL SECURITY` is intentionally not used, since a default-deny policy forced onto the backend owner would prevent normal saves. Existing records, media, sessions and SQL overloads are preserved. Global privilege defaults for other schemas are not modified. Company data, session secrets, and media must never be moved into an exposed public schema or granted to `anon`/`authenticated` roles.

## Stored objects

- `potshaven_private.records`: collection/id keyed JSONB records, with stable insertion ordering.
- `potshaven_private.metadata`: company settings, schema/initialization markers, a random private session-signing secret, and expiring sign-in attempt counters and opaque session revocations.
- `potshaven_private.activity`: ordered, owner-only manager events with durable unread/read status, separate from workspace collections.
- `potshaven_private.media`: immutable image bytes and their MIME types. Workspace records reference `/media/...` URLs, so photos are not repeatedly embedded in every state response.
- Private functions implement stock deductions, inventory adjustments, recurring-job completion, linked-record removal, initialization and calendar arithmetic. Activity-aware writes insert their event in the same transaction as the operational change.

Fresh databases start with the company's default branding and **no fictional operational records**. Explicit `seed: true` is intended for isolated tests or a demonstration database. Initialization is recorded, so reconnecting with a different seed setting never adds demo clients to an existing company workspace. Existing local SQLite files are not erased or automatically migrated. The unified Sites interface keeps the existing `places` records and `placeId` job links. Disabling financial features filters API access rather than deleting stored amounts; operational updates and stock calculations retain hidden financial data.

## Transaction guarantees

A stock operation is a single PostgreSQL function call. It locks the inventory row, checks the available quantity, updates the balance, and inserts its immutable movement record in the same database transaction. A failed movement insertion rolls the balance back. Concurrent deductions cannot make stock negative. Job-linked stock also locks the referenced job against deletion during the operation.

Recurring-job completion locks the parent job, writes the completed state and a clean follow-up in one transaction, and records the child's id. A unique partial index on `previousJobId` provides an additional guard against duplicate follow-ups. Weekly, fortnightly, monthly, and quarterly schedules retain the original calendar anchor; invalid dates roll completion back.

Database settings are merged atomically. Media keys are immutable: storing the same key with identical bytes is harmless; using it for different bytes returns a conflict. A persisted random signing secret keeps valid sessions usable across cold starts; changing role passwords still invalidates old sessions in the authentication layer.

`update(collection, id, patch, actor, {expected, activity})` optionally compares the complete authorized snapshot under the record's `FOR UPDATE` lock and returns 409 if anything changed. The API uses this check for manager updates and updates that preserve hidden financial fields, protecting approvals, project deadlines and private nested details against intervening writes. Collection PATCH clients may additionally send `_expected`, a role-filtered baseline from when the form opened. The API validates that optional precondition before passing its own full current snapshot to the store; `_expected` is never persisted. Schema upgrades retain prior function overloads so existing instances can finish during deployment.

The site-visit API appends one inspection to the latest site snapshot using the same locked update. A concurrent snapshot conflict is known not to have committed, so the API can reload and try up to three times; connection failures are never replayed. Stable visit IDs prevent duplicate entries or activity events for an identical resubmission. Existing inspections and private metadata are retained, and a whole-list edit cannot omit saved visits.

Manager activity uses server-generated, allowlisted metadata labelled `Manager account`, not raw request bodies or user-supplied actor identities. `put`, `update` and `stock` accept an optional activity event and save it atomically with the corresponding operational write. If event insertion fails, the record or stock change rolls back too. No second best-effort notification write is needed. The API does not replay failed mutations automatically.

`activityFeed(limit)` returns recent events and the total unread count from durable storage. `readActivity(id)` and `readAllActivity()` persist acknowledgements; repeated acknowledgement retains the first read time. The API restricts these operations to the owner. Read status and events survive cold starts and deployments; the UI polls while visible rather than relying on a long-lived serverless connection. Events begin with new manager changes after installation, without backfilling historical work.

`recordLoginAttempt(key, accepted, now)` atomically checks and updates the sign-in limit in private metadata. A session-key HMAC scopes counters to role and request source without storing raw IP addresses or passwords. Counters survive independent Vercel instances and cold starts, block further attempts after ten failures in a 15-minute window, and reset on an accepted sign-in only when the counter is not blocked. Expired counters are cleaned up. A failed counter write is not retried or treated as a successful login.

## Interface and verification

```js
const store = await createPostgresStore(process.env.DATABASE_URL);
const state = await store.state();
const { item, movement } = await store.stock(itemId, quantity, { jobId });
const sessionSecret = await store.getSessionSecret();
```

All CRUD, state, settings, stock, activity, media and close methods are asynchronous. The factory also accepts an injected `query(text, parameters)` function and optional `close()` for isolated SQL tests.

`node --test server/postgres-store.test.js` runs the actual schema and PL/pgSQL functions against PGlite's PostgreSQL engine. It checks stock concurrency and rollback, recurrence, linked-record protection, private-schema permissions, persisted settings/sessions/media, and SQL parameterization. `node --test server/activity.test.js` checks activity authorization, durable read state and atomic rollback; `npm run test:activity` checks the owner inbox and linked-site workflow in the browser. These tests do not establish that a user’s live Supabase connection is configured or reachable.

`dataProtection()` reads the actual catalog and workspace health for the owner Settings check. It does not inspect provider account backups. `revokeSession()` and `isSessionRevoked()` persist/check hashed session identities with expiration; raw cookies are never stored. See [data protection and recovery](../docs/DATA_PROTECTION.md) for backup scope and safe restore verification.
