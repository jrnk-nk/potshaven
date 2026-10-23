import {randomBytes, randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {collections, validate, AppError} from './store.js';
import {seedData} from './seed.js';
import {databaseTlsOptions} from './database-tls.js';
import {repairLegacySettings} from './settings-repair.js';

const SQL_FUNCTIONS = [
`CREATE OR REPLACE FUNCTION potshaven_private.next_occurrence(p_anchor text, p_frequency text, p_today text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, potshaven_private AS $function$
DECLARE original date; lower_bound date; candidate date; occurrence integer; step integer; attempt integer;
BEGIN
  BEGIN
    original := p_anchor::date;
    lower_bound := p_today::date;
    IF to_char(original, 'YYYY-MM-DD') <> p_anchor OR original IS NULL THEN RAISE EXCEPTION 'invalid date'; END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'A valid scheduled date is required for recurring maintenance.', ERRCODE = 'P0001', DETAIL = '400';
  END;
  IF p_frequency IN ('Weekly', 'Fortnightly') THEN
    step := CASE p_frequency WHEN 'Weekly' THEN 7 ELSE 14 END;
    occurrence := GREATEST(1, floor((lower_bound - original)::numeric / step)::integer + 1);
    candidate := original + occurrence * step;
    RETURN to_char(candidate, 'YYYY-MM-DD');
  ELSIF p_frequency IN ('Monthly', 'Quarterly') THEN
    step := CASE p_frequency WHEN 'Monthly' THEN 1 ELSE 3 END;
    occurrence := GREATEST(1, floor(((extract(year FROM lower_bound) - extract(year FROM original)) * 12 + extract(month FROM lower_bound) - extract(month FROM original)) / step)::integer);
    FOR attempt IN 1..3 LOOP
      candidate := (original + make_interval(months => occurrence * step))::date;
      IF candidate > lower_bound THEN RETURN to_char(candidate, 'YYYY-MM-DD'); END IF;
      occurrence := occurrence + 1;
    END LOOP;
  ELSE
    RAISE EXCEPTION USING MESSAGE = 'Choose a supported maintenance recurrence.', ERRCODE = 'P0001', DETAIL = '400';
  END IF;
  RAISE EXCEPTION USING MESSAGE = 'Could not calculate the next maintenance visit.', ERRCODE = 'P0001', DETAIL = '400';
END
$function$`,
`CREATE OR REPLACE FUNCTION potshaven_private.stock(p_id text, p_quantity numeric, p_type text, p_job_id text, p_note text, p_actor text, p_movement_id text, p_now text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, potshaven_private AS $function$
DECLARE item jsonb; next_item jsonb; movement jsonb; available numeric; balance numeric; unit_cost numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION USING MESSAGE = 'Quantity must be greater than zero.', ERRCODE = 'P0001', DETAIL = '400';
  END IF;
  IF p_type NOT IN ('use', 'restock') OR p_type IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Unknown stock operation.', ERRCODE = 'P0001', DETAIL = '400';
  END IF;
  IF coalesce(p_job_id, '') <> '' THEN
    PERFORM 1 FROM potshaven_private.records WHERE collection = 'jobs' AND id = p_job_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'Choose an existing job.', ERRCODE = 'P0001', DETAIL = '400'; END IF;
  END IF;
  SELECT data INTO item FROM potshaven_private.records WHERE collection = 'inventory' AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'Inventory item not found.', ERRCODE = 'P0001', DETAIL = '404'; END IF;
  available := coalesce((item->>'quantity')::numeric, 0);
  unit_cost := coalesce((item->>'cost')::numeric, 0);
  IF p_type = 'use' AND p_quantity > available THEN
    RAISE EXCEPTION USING MESSAGE = 'Only ' || trim_scale(available)::text || ' ' || coalesce(item->>'unit', 'units') || ' available.', ERRCODE = 'P0001', DETAIL = '409';
  END IF;
  balance := round(available + CASE p_type WHEN 'use' THEN -p_quantity ELSE p_quantity END, 4);
  next_item := item || jsonb_build_object('quantity', balance);
  UPDATE potshaven_private.records SET data = next_item WHERE collection = 'inventory' AND id = p_id;
  movement := jsonb_build_object('id', p_movement_id, 'inventoryId', p_id, 'itemName', item->>'name', 'type', p_type, 'quantity', p_quantity, 'jobId', coalesce(p_job_id, ''), 'note', coalesce(p_note, ''), 'actor', p_actor, 'date', p_now, 'balance', balance, 'unitCost', unit_cost, 'totalCost', CASE p_type WHEN 'use' THEN p_quantity * unit_cost ELSE 0 END);
  INSERT INTO potshaven_private.records(collection, id, data) VALUES ('stockMovements', p_movement_id, movement);
  RETURN jsonb_build_object('item', next_item, 'movement', movement);
END
$function$`,
`CREATE OR REPLACE FUNCTION potshaven_private.update_record(p_collection text, p_id text, p_patch jsonb, p_actor text, p_movement_id text, p_followup_id text, p_now text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, potshaven_private AS $function$
DECLARE previous jsonb; next_record jsonb; movement jsonb; delta numeric; followup jsonb; followup_id text; anchor text; scheduled date; lower_bound date; visit_date date; deadline date; tasks jsonb;
BEGIN
  IF p_collection = 'stockMovements' THEN RAISE EXCEPTION USING MESSAGE = 'Stock history is managed automatically and cannot be edited.', ERRCODE = 'P0001', DETAIL = '403'; END IF;
  SELECT data INTO previous FROM potshaven_private.records WHERE collection = p_collection AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'Record not found.', ERRCODE = 'P0001', DETAIL = '404'; END IF;
  next_record := previous || p_patch || jsonb_build_object('id', p_id);
  IF p_collection = 'inventory' AND previous->'quantity' IS DISTINCT FROM next_record->'quantity' THEN
    delta := (next_record->>'quantity')::numeric - (previous->>'quantity')::numeric;
    IF (next_record->>'quantity')::numeric < 0 THEN RAISE EXCEPTION USING MESSAGE = 'quantity must be a nonnegative number.', ERRCODE = 'P0001', DETAIL = '400'; END IF;
    movement := jsonb_build_object('id', p_movement_id, 'inventoryId', p_id, 'itemName', next_record->>'name', 'type', 'adjustment', 'quantity', abs(delta), 'change', delta, 'jobId', '', 'note', 'Stock count adjusted', 'actor', p_actor, 'date', p_now, 'balance', (next_record->>'quantity')::numeric, 'unitCost', coalesce((next_record->>'cost')::numeric, 0), 'totalCost', 0);
    INSERT INTO potshaven_private.records(collection, id, data) VALUES ('stockMovements', p_movement_id, movement);
  END IF;
  IF p_collection = 'jobs' AND next_record->>'type' = 'Maintenance' AND next_record->>'status' = 'Completed' AND previous->>'status' IS DISTINCT FROM 'Completed' AND coalesce(next_record->>'recurrence', 'None') <> 'None' AND coalesce(previous->>'nextJobId', '') = '' THEN
    SELECT id INTO followup_id FROM potshaven_private.records WHERE collection = 'jobs' AND data->>'previousJobId' = p_id LIMIT 1;
    IF followup_id IS NULL THEN
      BEGIN
        scheduled := (next_record->>'date')::date;
        IF scheduled IS NULL OR to_char(scheduled, 'YYYY-MM-DD') <> next_record->>'date' THEN RAISE EXCEPTION 'invalid date'; END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION USING MESSAGE = 'A valid scheduled date is required for recurring maintenance.', ERRCODE = 'P0001', DETAIL = '400';
      END;
      anchor := coalesce(nullif(next_record->>'recurrenceAnchorDate', ''), next_record->>'date');
      lower_bound := greatest(substring(p_now FROM 1 FOR 10)::date, scheduled);
      visit_date := potshaven_private.next_occurrence(anchor, next_record->>'recurrence', to_char(lower_bound, 'YYYY-MM-DD'))::date;
      IF coalesce(next_record->>'deadline', '') <> '' THEN
        BEGIN
          deadline := (next_record->>'deadline')::date;
          IF to_char(deadline, 'YYYY-MM-DD') <> next_record->>'deadline' THEN RAISE EXCEPTION 'invalid date'; END IF;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION USING MESSAGE = 'A valid deadline is required for recurring maintenance.', ERRCODE = 'P0001', DETAIL = '400';
        END;
        deadline := deadline + (visit_date - scheduled);
      ELSE deadline := visit_date;
      END IF;
      SELECT coalesce(jsonb_agg(CASE jsonb_typeof(task) WHEN 'string' THEN jsonb_build_object('text', task #>> '{}', 'done', false) ELSE task || jsonb_build_object('done', false) END), '[]'::jsonb) INTO tasks FROM jsonb_array_elements(next_record->'tasks') AS task_entries(task);
      followup_id := p_followup_id;
      followup := (next_record - 'nextJobId' - 'completedAt') || jsonb_build_object('id', followup_id, 'previousJobId', p_id, 'recurrenceAnchorDate', anchor, 'date', to_char(visit_date, 'YYYY-MM-DD'), 'deadline', to_char(deadline, 'YYYY-MM-DD'), 'status', 'Scheduled', 'tasks', tasks, 'photos', '[]'::jsonb, 'completionPhotos', '[]'::jsonb, 'createdAt', p_now);
      INSERT INTO potshaven_private.records(collection, id, data) VALUES ('jobs', followup_id, followup);
    END IF;
    next_record := next_record || jsonb_build_object('nextJobId', followup_id, 'completedAt', p_now);
  END IF;
  UPDATE potshaven_private.records SET data = next_record WHERE collection = p_collection AND id = p_id;
  RETURN next_record;
END
$function$`,
`CREATE OR REPLACE FUNCTION potshaven_private.remove_record(p_collection text, p_id text)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog, potshaven_private AS $function$
DECLARE relation jsonb; dependencies jsonb;
BEGIN
  IF p_collection = 'stockMovements' THEN RAISE EXCEPTION USING MESSAGE = 'Stock history is managed automatically and cannot be edited.', ERRCODE = 'P0001', DETAIL = '403'; END IF;
  PERFORM 1 FROM potshaven_private.records WHERE collection = p_collection AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'Record not found.', ERRCODE = 'P0001', DETAIL = '404'; END IF;
  dependencies := CASE p_collection
    WHEN 'places' THEN '[["jobs","placeId"],["contracts","placeId"],["payments","placeId"],["issues","placeId"]]'::jsonb
    WHEN 'workers' THEN '[["jobs","crewIds"]]'::jsonb
    WHEN 'vehicles' THEN '[["jobs","vehicleId"]]'::jsonb
    WHEN 'jobs' THEN '[["expenses","jobId"],["stockMovements","jobId"]]'::jsonb
    WHEN 'inventory' THEN '[["stockMovements","inventoryId"]]'::jsonb
    ELSE '[]'::jsonb END;
  FOR relation IN SELECT value FROM jsonb_array_elements(dependencies) LOOP
    IF EXISTS (SELECT 1 FROM potshaven_private.records WHERE collection = relation->>0 AND (data->>(relation->>1) = p_id OR (data->(relation->>1)) ? p_id)) THEN
      RAISE EXCEPTION USING MESSAGE = 'This record is used elsewhere. Update its linked records before deleting it.', ERRCODE = 'P0001', DETAIL = '409';
    END IF;
  END LOOP;
  DELETE FROM potshaven_private.records WHERE collection = p_collection AND id = p_id;
  RETURN true;
END
$function$`,
`CREATE OR REPLACE FUNCTION potshaven_private.initialize_workspace(p_seed boolean, p_initial jsonb)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog, potshaven_private AS $function$
DECLARE group_record record; item jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(189227451, 2);
  IF EXISTS (SELECT 1 FROM potshaven_private.metadata WHERE key = 'initialized') THEN RETURN false; END IF;
  IF p_seed THEN
    FOR group_record IN SELECT key, value FROM jsonb_each(p_initial) LOOP
      IF group_record.key <> 'settings' THEN
        FOR item IN SELECT value FROM jsonb_array_elements(group_record.value) LOOP
          INSERT INTO potshaven_private.records(collection, id, data) VALUES (group_record.key, item->>'id', item) ON CONFLICT DO NOTHING;
        END LOOP;
      END IF;
    END LOOP;
  END IF;
  INSERT INTO potshaven_private.metadata(key, value) VALUES ('settings', coalesce(p_initial->'settings', '{}'::jsonb)) ON CONFLICT DO NOTHING;
  INSERT INTO potshaven_private.metadata(key, value) VALUES ('initialized', 'true'::jsonb);
  RETURN true;
END
$function$`,
];

// A single transaction serializes cold-start schema setup across independent
// serverless instances. Business mutations themselves lock only their records.
export const POSTGRES_SCHEMA_SQL = `DO $bootstrap$
BEGIN
  PERFORM pg_advisory_xact_lock(189227451, 1);
  CREATE SCHEMA IF NOT EXISTS potshaven_private;
  REVOKE ALL ON SCHEMA potshaven_private FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES IN SCHEMA potshaven_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  CREATE TABLE IF NOT EXISTS potshaven_private.records (
    collection text NOT NULL, id text NOT NULL,
    sequence bigint GENERATED BY DEFAULT AS IDENTITY,
    data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    PRIMARY KEY (collection, id)
  );
  CREATE TABLE IF NOT EXISTS potshaven_private.metadata (key text PRIMARY KEY, value jsonb NOT NULL);
  CREATE TABLE IF NOT EXISTS potshaven_private.media (key text PRIMARY KEY, mime text NOT NULL, data text NOT NULL);
  IF coalesce((SELECT value #>> '{}' FROM potshaven_private.metadata WHERE key = 'schemaVersion'), '') <> '1' THEN
    CREATE INDEX IF NOT EXISTS potshaven_collection_sequence ON potshaven_private.records(collection, sequence);
    CREATE UNIQUE INDEX IF NOT EXISTS potshaven_followup_once ON potshaven_private.records ((data->>'previousJobId')) WHERE collection = 'jobs' AND coalesce(data->>'previousJobId', '') <> '';
    ${SQL_FUNCTIONS.map(sql => `EXECUTE $ddl$${sql}$ddl$;`).join('\n    ')}
    REVOKE ALL ON ALL TABLES IN SCHEMA potshaven_private FROM PUBLIC;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA potshaven_private FROM PUBLIC;
    INSERT INTO potshaven_private.metadata(key, value) VALUES ('schemaVersion', '"1"'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
END
$bootstrap$`;

function checkCollection(collection) {
  if (!collections.includes(collection)) throw new AppError('Unknown record type.', 404);
}
function checkObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('A record object is required.');
}
function cleanSettings(input) {
  checkObject(input);
  const clean = {};
  const allowed = ['companyName', 'ownerName', 'tagline', 'email', 'phone', 'currency', 'logo', 'watermark', 'address', 'accentColor'];
  for (const key of allowed) if (Object.hasOwn(input, key)) {
    if (typeof input[key] !== 'string' || input[key].length > (key === 'logo' ? 3000000 : 500)) throw new AppError(`Invalid ${key}.`);
    clean[key] = input[key];
  }
  if (clean.accentColor && !/^#[a-fA-F0-9]{6}$/.test(clean.accentColor)) throw new AppError('Choose a valid six-digit accent colour.');
  if (clean.currency && !Intl.supportedValuesOf('currency').includes(clean.currency)) throw new AppError('Choose a supported ISO currency code, such as GHS, USD or GBP.');
  if (clean.logo && !/^(https:\/\/|\/branding\/potshaven-logo\.png$|\/media\/uploads\/[a-f0-9]{64}\.(png|jpg|webp)$|data:image\/(png|jpeg|webp);base64,)/.test(clean.logo)) throw new AppError('Upload a PNG, JPG, or WebP logo.');
  return clean;
}
function translateError(error) {
  if (error?.code === 'P0001') return new AppError(error.message, /^\d{3}$/.test(error.detail || '') ? Number(error.detail) : 400);
  if (error?.code === '23505') return new AppError('This record conflicts with an existing linked record.', 409);
  return error;
}

/** Durable PostgreSQL adapter. query(text, params) may be injected by SQL tests. */
export async function createPostgresStore(connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL, {query, seed = false, now = new Date(), close} = {}) {
  if (!query && !connectionString) throw new AppError('Connect a PostgreSQL database to open this workspace.', 503);
  if (!query) {
    try { const url = new URL(connectionString); if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error('Invalid PostgreSQL URL'); }
    catch { throw new AppError('Use the private PostgreSQL Transaction Pooler connection string from Supabase.', 503); }
  }
  const sql = query ? null : postgres(connectionString, {ssl: databaseTlsOptions(connectionString), prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10});
  const execute = query || ((text, parameters) => sql.unsafe(text, parameters));
  const run = async (text, parameters = []) => {
    try {
      const result = await execute(text, parameters);
      return Array.isArray(result) ? result : result.rows;
    } catch (error) { throw translateError(error); }
  };
  try {
    await run(POSTGRES_SCHEMA_SQL);
    const initial = seed ? seedData(now) : {settings: seedData(now).settings};
    await run('SELECT potshaven_private.initialize_workspace($1::boolean, $2::jsonb)', [Boolean(seed), initial]);
    await repairLegacySettings(run);
  } catch (error) {
    if (sql) await sql.end({timeout: 5}).catch(() => {});
    throw error;
  }

  const store = {
    async close() { if (close) await close(); else if (sql) await sql.end({timeout: 5}); },
    async list(collection) {
      checkCollection(collection);
      return (await run('SELECT data FROM potshaven_private.records WHERE collection = $1 ORDER BY sequence', [collection])).map(row => row.data);
    },
    async get(collection, id) {
      checkCollection(collection);
      return (await run('SELECT data FROM potshaven_private.records WHERE collection = $1 AND id = $2', [collection, id]))[0]?.data;
    },
    async put(collection, input) {
      checkCollection(collection); checkObject(input);
      if (collection === 'stockMovements') throw new AppError('Stock history is managed automatically and cannot be edited.', 403);
      const record = {...input, id: input.id || randomUUID()};
      validate(collection, record);
      return (await run('INSERT INTO potshaven_private.records(collection, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data RETURNING data', [collection, record.id, record]))[0].data;
    },
    async update(collection, id, input, actor = 'Owner') {
      checkCollection(collection); checkObject(input);
      if (collection === 'stockMovements') throw new AppError('Stock history is managed automatically and cannot be edited.', 403);
      const previous = await store.get(collection, id);
      if (!previous) throw new AppError('Record not found.', 404);
      validate(collection, {...previous, ...input, id});
      return (await run('SELECT potshaven_private.update_record($1, $2, $3::jsonb, $4, $5, $6, $7) AS data', [collection, id, input, actor, randomUUID(), randomUUID(), new Date().toISOString()]))[0].data;
    },
    async remove(collection, id) {
      checkCollection(collection);
      await run('SELECT potshaven_private.remove_record($1, $2)', [collection, id]);
    },
    async settings() {
      return (await run("SELECT value FROM potshaven_private.metadata WHERE key = 'settings'"))[0]?.value || {};
    },
    async updateSettings(input) {
      const clean = cleanSettings(input);
      return (await run("INSERT INTO potshaven_private.metadata(key, value) VALUES ('settings', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = potshaven_private.metadata.value || EXCLUDED.value RETURNING value", [clean]))[0].value;
    },
    async stock(id, quantity, {type = 'use', jobId = '', note = '', actor = 'Owner'} = {}) {
      if (!Number.isFinite(quantity) || quantity <= 0) throw new AppError('Quantity must be greater than zero.');
      if (!['use', 'restock'].includes(type)) throw new AppError('Unknown stock operation.');
      if (typeof note !== 'string' || note.length > 20000) throw new AppError('Note must be text of at most 20,000 characters.');
      return (await run('SELECT potshaven_private.stock($1, $2::numeric, $3, $4, $5, $6, $7, $8) AS data', [id, quantity, type, jobId, note, actor, randomUUID(), new Date().toISOString()]))[0].data;
    },
    async health() {
      // Read each workspace table through the same connection used by real
      // requests, without loading company records or image contents.
      const row = (await run(`SELECT
        (SELECT jsonb_typeof(value) FROM potshaven_private.metadata WHERE key = 'settings') AS settings_type,
        (SELECT jsonb_typeof(data) FROM potshaven_private.records LIMIT 1) AS record_type,
        (SELECT mime FROM potshaven_private.media LIMIT 1) AS media_type`))[0];
      if (row?.settings_type !== 'object') {
        const error = new Error('The workspace database settings are incomplete.');
        error.code = 'WORKSPACE_SCHEMA_INVALID';
        throw error;
      }
      return true;
    },
    async state() {
      const row = (await run("SELECT coalesce((SELECT jsonb_object_agg(collection, items) FROM (SELECT collection, jsonb_agg(data ORDER BY sequence) AS items FROM potshaven_private.records GROUP BY collection) grouped), '{}'::jsonb) || jsonb_build_object('settings', coalesce((SELECT value FROM potshaven_private.metadata WHERE key = 'settings'), '{}'::jsonb)) AS state"))[0];
      return {...Object.fromEntries(collections.map(collection => [collection, []])), ...row.state};
    },
    async getSessionSecret() {
      return (await run("INSERT INTO potshaven_private.metadata(key, value) VALUES ('session-secret', to_jsonb($1::text)) ON CONFLICT (key) DO UPDATE SET value = potshaven_private.metadata.value RETURNING value", [randomBytes(48).toString('hex')]))[0].value;
    },
    async putMedia(key, bytes, contentType) {
      if (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,200}$/.test(key) || key.split('/').includes('..')) throw new AppError('Invalid media name.');
      if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 8 * 1024 * 1024) throw new AppError('Images must be between 1 byte and 8 MB.');
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) throw new AppError('Use a PNG, JPG, or WebP image.');
      const result = await run('INSERT INTO potshaven_private.media(key, mime, data) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key WHERE potshaven_private.media.mime = EXCLUDED.mime AND potshaven_private.media.data = EXCLUDED.data RETURNING key', [key, contentType, bytes.toString('base64')]);
      if (!result.length) throw new AppError('This image name already contains different content.', 409);
      return `/media/${key}`;
    },
    async getMedia(key) {
      if (typeof key !== 'string' || key.length > 201) return null;
      const row = (await run('SELECT mime, data FROM potshaven_private.media WHERE key = $1', [key]))[0];
      return row ? {bytes: Buffer.from(row.data, 'base64'), contentType: row.mime} : null;
    },
  };
  return store;
}
