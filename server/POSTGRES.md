# Durable serverless storage

`createPostgresStore()` provides the asynchronous storage interface used by the Express API. On Vercel it uses PostgreSQL rather than local SQLite or the function's temporary filesystem. An unconfigured cloud deployment must report its missing database connection; it must not silently open an empty local database.

## Supabase connection

Set `DATABASE_URL` privately on the server to the Supabase **transaction pooler** PostgreSQL connection string from the project's Connect panel. `POSTGRES_URL` and `SUPABASE_DB_URL` are also accepted by the adapter. Use the provider's complete connection string, including the project-specific username, database, port, and properly escaped password. Never put this value in a `VITE_*`, `NEXT_PUBLIC_*`, or other browser-visible setting.

The `postgres` driver enables certificate verification, disables prepared statements for the transaction pooler, limits each function instance to one connection, and closes idle connections after twenty seconds. No database password, connection string, or session secret is returned in workspace state. The HTTP API uses its existing owner/manager authentication; a browser Supabase anonymous key is not used to query company records.

The adapter creates its schema on first connection. There is no manual SQL-editor setup step. The connection must have permission to create the app's private schema, tables, indexes, and functions. The generated objects are all in **`potshaven_private`**, and schema access and function execution are revoked from `PUBLIC`. Company data, session secrets, and media must never be moved into an exposed public schema or granted to `anon`/`authenticated` roles.

## Stored objects

- `potshaven_private.records`: collection/id keyed JSONB records, with stable insertion ordering.
- `potshaven_private.metadata`: company settings, schema/initialization markers, and a random private session-signing secret.
- `potshaven_private.media`: immutable image bytes and their MIME types. Workspace records reference `/media/...` URLs, so photos are not repeatedly embedded in every state response.
- Private functions implement stock deductions, inventory adjustments, recurring-job completion, linked-record removal, initialization, and calendar arithmetic.

Fresh databases start with the company's default branding and **no fictional operational records**. Explicit `seed: true` is intended for isolated tests or a demonstration database. Initialization is recorded, so reconnecting with a different seed setting never adds demo clients to an existing company workspace. Existing local SQLite files are not erased or automatically migrated.

## Transaction guarantees

A stock operation is a single PostgreSQL function call. It locks the inventory row, checks the available quantity, updates the balance, and inserts its immutable movement record in the same database transaction. A failed movement insertion rolls the balance back. Concurrent deductions cannot make stock negative. Job-linked stock also locks the referenced job against deletion during the operation.

Recurring-job completion locks the parent job, writes the completed state and a clean follow-up in one transaction, and records the child's id. A unique partial index on `previousJobId` provides an additional guard against duplicate follow-ups. Weekly, fortnightly, monthly, and quarterly schedules retain the original calendar anchor; invalid dates roll completion back.

Database settings are merged atomically. Media keys are immutable: storing the same key with identical bytes is harmless; using it for different bytes returns a conflict. A persisted random signing secret keeps valid sessions usable across cold starts; changing role passwords still invalidates old sessions in the authentication layer.

## Interface and verification

```js
const store = await createPostgresStore(process.env.DATABASE_URL);
const state = await store.state();
const { item, movement } = await store.stock(itemId, quantity, { jobId });
const sessionSecret = await store.getSessionSecret();
```

All CRUD, state, settings, stock, media, and close methods are asynchronous. The factory also accepts an injected `query(text, parameters)` function and optional `close()` for isolated SQL tests.

`node --test server/postgres-store.test.js` runs the actual schema and PL/pgSQL functions against PGlite's PostgreSQL engine. It checks stock concurrency and rollback, recurrence, linked-record protection, private-schema permissions, persisted settings/sessions/media, and SQL parameterization. It does not claim that a user's live Supabase connection is configured or reachable.
