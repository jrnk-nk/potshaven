import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createPostgresStore} from './postgres-store.js';
import {managerActivity} from './activity.js';

let database, store, saved, secret, feed, image;
const query = (sql, parameters = []) => database.query(sql, parameters);
const names = ['records', 'metadata', 'media', 'activity'];
const browserRoles = ['anon', 'authenticated', 'service_role'];

before(async () => {
  database = new PGlite();
  await database.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  store = await createPostgresStore('', {query});
  await store.put('places', {id: 'site', name: 'Saved garden', inspections: [{id: 'visit', notes: 'Retained visit'}]});
  await store.put('inventory', {id: 'plants', name: 'Saved plants', category: 'Plants', quantity: 8, cost: 75});
  await store.put('jobs', {id: 'job', title: 'Saved maintenance', type: 'Maintenance', status: 'Scheduled', crewIds: [], tasks: [{text: 'Water', done: false}], placeId: 'site'});
  await store.updateSettings({companyName: 'Saved company'});
  secret = await store.getSessionSecret();
  image = Buffer.from('saved-private-image');
  await store.putMedia('uploads/retained.png', image, 'image/png');
  const record = {id: 'request', title: 'More planters', jobId: 'job', requestedBy: 'manager'};
  await store.put('purchaseRequests', record, {activity: await managerActivity(store, {role: 'manager', collection: 'purchaseRequests', operation: 'create', record})});
  feed = await store.activityFeed();
  await store.readActivity(feed.items[0].id);
  feed = await store.activityFeed();
  saved = await store.state();

  // Recreate a previously deployed version-three schema with accidental
  // grants and permissive policies. The upgrade must repair access, not data.
  for (const name of names) {
    await database.exec(`ALTER TABLE potshaven_private.${name} DISABLE ROW LEVEL SECURITY;
      CREATE POLICY exposed_legacy_policy ON potshaven_private.${name} FOR ALL TO PUBLIC USING (true) WITH CHECK (true);`);
  }
  await database.exec(`
    UPDATE potshaven_private.metadata SET value='"3"'::jsonb WHERE key='schemaVersion';
    GRANT USAGE, CREATE ON SCHEMA potshaven_private TO PUBLIC, anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA potshaven_private TO PUBLIC, anon, authenticated, service_role;
    GRANT ALL ON potshaven_private.records TO anon WITH GRANT OPTION;
    GRANT SELECT (data) ON potshaven_private.records TO PUBLIC, anon, authenticated, service_role;
    GRANT SELECT (value) ON potshaven_private.metadata TO PUBLIC, anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA potshaven_private TO PUBLIC, anon, authenticated, service_role;
    GRANT ALL ON ALL FUNCTIONS IN SCHEMA potshaven_private TO PUBLIC, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA potshaven_private GRANT ALL ON TABLES TO PUBLIC, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA potshaven_private GRANT ALL ON SEQUENCES TO PUBLIC, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA potshaven_private GRANT ALL ON FUNCTIONS TO PUBLIC, anon, authenticated, service_role;
  `);
  await database.exec('SET ROLE anon; GRANT SELECT (data) ON potshaven_private.records TO authenticated; RESET ROLE;');
  store = await createPostgresStore('', {query});
});
after(async () => database?.close());

test('version-four upgrade retains company data, images, sessions and acknowledged manager activity', async () => {
  assert.equal((await query("SELECT value FROM potshaven_private.metadata WHERE key='schemaVersion'")).rows[0].value, '4');
  assert.deepEqual(await store.state(), saved);
  assert.equal(await store.getSessionSecret(), secret);
  assert.deepEqual((await store.getMedia('uploads/retained.png')).bytes, image);
  assert.deepEqual(await store.activityFeed(), feed);
  const tables = (await query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace='potshaven_private'::regnamespace AND relkind='r' ORDER BY relname")).rows;
  assert.deepEqual(tables.map(table => table.relname), ['activity', 'media', 'metadata', 'records']);
  assert.ok(tables.every(table => table.relrowsecurity && !table.relforcerowsecurity));
  assert.equal((await query("SELECT count(*)::integer AS count FROM pg_policies WHERE schemaname='potshaven_private'")).rows[0].count, 0);
  const reopened = await createPostgresStore('', {query});
  assert.deepEqual(await reopened.state(), saved);
  assert.deepEqual(await reopened.dataProtection(), {storage: 'postgres', database: 'connected', rls: {enabled: true, protectedTables: 4, totalTables: 4, browserAccessBlocked: true}});
  // The trusted backend owner still operates through invoker-rights functions.
  await query('SELECT potshaven_private.stock($1,$2::numeric,$3,$4,$5,$6,$7,$8)', ['plants', 1, 'use', 'job', '', 'Owner', 'old-function-ledger', new Date().toISOString()]);
  assert.equal((await reopened.get('inventory', 'plants')).quantity, 7);
});

test('Supabase browser/service roles lose schema, table, column, sequence and function privileges', async () => {
  const savedMovements = await store.list('stockMovements');
  for (const role of browserRoles) {
    const rights = (await query(`SELECT
      has_schema_privilege($1, 'potshaven_private', 'USAGE, CREATE') AS schema,
      has_table_privilege($1, 'potshaven_private.records', 'SELECT, INSERT, UPDATE, DELETE') AS records,
      has_any_column_privilege($1, 'potshaven_private.records', 'SELECT, INSERT, UPDATE, REFERENCES') AS columns,
      has_any_column_privilege($1, 'potshaven_private.metadata', 'SELECT, INSERT, UPDATE, REFERENCES') AS metadata_columns,
      has_sequence_privilege($1, 'potshaven_private.records_sequence_seq', 'USAGE, SELECT, UPDATE') AS sequence,
      has_function_privilege($1, 'potshaven_private.stock(text,numeric,text,text,text,text,text,text)', 'EXECUTE') AS functions`, [role])).rows[0];
    assert.ok(Object.values(rights).every(allowed => allowed === false), `${role}: ${JSON.stringify(rights)}`);
    await database.exec(`SET ROLE ${role}`);
    try {
      for (const name of names) await assert.rejects(query(`SELECT * FROM potshaven_private.${name}`), /permission denied/);
      await assert.rejects(query("SELECT potshaven_private.stock('plants', 1, 'use', 'job', '', 'Owner', 'must-not-save', '2026-10-23')"), /permission denied/);
    } finally {await database.exec('RESET ROLE');}
  }
  assert.deepEqual(await store.list('stockMovements'), savedMovements);
});

test('default-deny RLS blocks row reads and writes if nonprivileged browser roles accidentally regain grants', async () => {
  await database.exec('GRANT USAGE ON SCHEMA potshaven_private TO anon, authenticated; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA potshaven_private TO anon, authenticated; GRANT USAGE ON ALL SEQUENCES IN SCHEMA potshaven_private TO anon, authenticated;');
  const status = await store.dataProtection();
  assert.equal(status.rls.enabled, true);
  assert.equal(status.rls.browserAccessBlocked, false, 'The protection panel detects grants even while RLS blocks row access.');
  for (const role of ['anon', 'authenticated']) {
    await database.exec(`SET ROLE ${role}`);
    try {
      for (const name of names) assert.deepEqual((await query(`SELECT * FROM potshaven_private.${name}`)).rows, []);
      await assert.rejects(query("INSERT INTO potshaven_private.records(collection,id,data) VALUES ('places','blocked','{\"id\":\"blocked\",\"name\":\"Blocked\"}')"), /row-level security/);
      await assert.rejects(query("INSERT INTO potshaven_private.metadata(key,value) VALUES ('session-secret-spoof','\"blocked\"')"), /row-level security/);
      await assert.rejects(query("INSERT INTO potshaven_private.media(key,mime,data) VALUES ('blocked','image/png','blocked')"), /row-level security/);
      await assert.rejects(query("INSERT INTO potshaven_private.activity(id,data) VALUES ('blocked','{}')"), /row-level security/);
      assert.deepEqual((await query("UPDATE potshaven_private.records SET data='{}' RETURNING id")).rows, []);
      assert.deepEqual((await query('DELETE FROM potshaven_private.metadata RETURNING key')).rows, []);
    } finally {await database.exec('RESET ROLE');}
  }
  assert.equal(await store.getSessionSecret(), secret);
  assert.deepEqual(await store.activityFeed(), feed);
  await database.exec('REVOKE ALL ON SCHEMA potshaven_private FROM anon, authenticated; REVOKE ALL ON ALL TABLES IN SCHEMA potshaven_private FROM anon, authenticated; REVOKE ALL ON ALL SEQUENCES IN SCHEMA potshaven_private FROM anon, authenticated;');
});

test('future app objects stay behind the private schema, and protection checks detect RLS/column/sequence/function drift', async () => {
  await database.exec('CREATE TABLE potshaven_private.future_private_table (id serial PRIMARY KEY, value text); CREATE FUNCTION potshaven_private.future_private_function() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;');
  for (const role of browserRoles) {
    assert.equal((await query("SELECT has_table_privilege($1, 'potshaven_private.future_private_table', 'SELECT') AS allowed", [role])).rows[0].allowed, false);
    assert.equal((await query("SELECT has_sequence_privilege($1, 'potshaven_private.future_private_table_id_seq', 'USAGE') AS allowed", [role])).rows[0].allowed, false);
    await database.exec(`SET ROLE ${role}`);
    try {await assert.rejects(query('SELECT potshaven_private.future_private_function()'), /permission denied/);}
    finally {await database.exec('RESET ROLE');}
  }
  // A schema-local default cannot remove global PUBLIC function EXECUTE.
  // Every bootstrap therefore explicitly revokes current private functions.
  assert.equal((await store.dataProtection()).rls.browserAccessBlocked, false);
  store = await createPostgresStore('', {query});
  assert.equal((await store.dataProtection()).rls.browserAccessBlocked, true);
  await database.exec('DROP FUNCTION potshaven_private.future_private_function(); DROP TABLE potshaven_private.future_private_table;');
  for (const [grant, revoke] of [
    ['GRANT SELECT (data) ON potshaven_private.records TO service_role', 'REVOKE SELECT (data) ON potshaven_private.records FROM service_role'],
    ['GRANT USAGE ON SEQUENCE potshaven_private.records_sequence_seq TO anon', 'REVOKE USAGE ON SEQUENCE potshaven_private.records_sequence_seq FROM anon'],
    ["GRANT EXECUTE ON FUNCTION potshaven_private.next_occurrence(text,text,text) TO authenticated", "REVOKE EXECUTE ON FUNCTION potshaven_private.next_occurrence(text,text,text) FROM authenticated"],
    ['GRANT SELECT ON potshaven_private.media TO PUBLIC', 'REVOKE SELECT ON potshaven_private.media FROM PUBLIC'],
  ]) {
    await database.exec(grant);assert.equal((await store.dataProtection()).rls.browserAccessBlocked, false);
    await database.exec(revoke);assert.equal((await store.dataProtection()).rls.browserAccessBlocked, true);
  }
  await database.exec('ALTER TABLE potshaven_private.activity DISABLE ROW LEVEL SECURITY');
  assert.deepEqual((await store.dataProtection()).rls, {enabled: false, protectedTables: 3, totalTables: 4, browserAccessBlocked: true});
  await database.exec('ALTER TABLE potshaven_private.activity ENABLE ROW LEVEL SECURITY');
  await database.exec('CREATE POLICY unexpected_browser_policy ON potshaven_private.records FOR SELECT TO anon USING (true)');
  assert.equal((await store.dataProtection()).rls.browserAccessBlocked, false, 'Unexpected policies require review even when current ACLs still block browsers.');
  await database.exec('DROP POLICY unexpected_browser_policy ON potshaven_private.records');
  assert.equal((await store.dataProtection()).rls.browserAccessBlocked, true);
});

test('a backend table owner without superuser or BYPASSRLS can initialize, save and reconnect', async () => {
  const isolated = new PGlite();
  try {
    await isolated.exec('CREATE ROLE app_backend NOSUPERUSER NOBYPASSRLS; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    const grant = (await isolated.query("SELECT format('GRANT CREATE ON DATABASE %I TO app_backend', current_database()) AS command")).rows[0].command;
    await isolated.exec(grant);
    await isolated.exec('SET ROLE app_backend');
    const backend = await createPostgresStore('', {query: (sql, parameters = []) => isolated.query(sql, parameters)});
    await backend.put('places', {id: 'garden', name: 'Private garden'});
    await backend.put('inventory', {id: 'stock', name: 'Plants', category: 'Plants', quantity: 5});
    const savedSecret = await backend.getSessionSecret();
    await backend.stock('stock', 2);
    assert.equal((await backend.get('inventory', 'stock')).quantity, 3);
    assert.equal((await backend.list('stockMovements')).length, 1);
    assert.deepEqual((await backend.dataProtection()).rls, {enabled: true, protectedTables: 4, totalTables: 4, browserAccessBlocked: true});
    await isolated.exec(`GRANT USAGE ON SCHEMA potshaven_private TO anon;
      GRANT SELECT ON potshaven_private.records TO anon WITH GRANT OPTION;
      UPDATE potshaven_private.metadata SET value='"3"'::jsonb WHERE key='schemaVersion';
      RESET ROLE; SET ROLE anon;
      GRANT SELECT (data) ON potshaven_private.records TO authenticated;
      RESET ROLE; SET ROLE app_backend;`);
    const reopened = await createPostgresStore('', {query: (sql, parameters = []) => isolated.query(sql, parameters)});
    assert.equal(await reopened.getSessionSecret(), savedSecret);
    assert.equal((await reopened.get('places', 'garden')).name, 'Private garden');
    assert.equal((await reopened.dataProtection()).rls.browserAccessBlocked, true, 'The ordinary backend owner can also remove delegated column access.');
  } finally {await isolated.close();}
});
