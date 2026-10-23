import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import {PGlite} from '@electric-sql/pglite';
import {createPostgresStore} from './postgres-store.js';

async function fixture(t) {
  const database = new PGlite();
  // Use the production driver's JSONB serializer. PGlite alone accepts an
  // already-stringified object and would miss a second encoding on the wire.
  const driver = postgres('postgresql://fixture:fixture@unused.invalid/fixture', {prepare: false});
  const json = driver.options.serializers[3802];
  const query = async (sql, parameters = []) => {
    const bound = parameters.map((value, index) => {
      const jsonParameter = new RegExp(`\\$${index + 1}::jsonb\\b`).test(sql);
      return jsonParameter && value !== null ? json(value) : value;
    });
    return (await database.query(sql, bound)).rows;
  };
  t.after(async () => {await driver.end({timeout: 0}); await database.close();});
  return {database, json, query};
}

test('the real PostgreSQL serializer reproduces the legacy settings corruption', async t => {
  const {database, json} = await fixture(t);
  const patch = {companyName: 'A company name'};
  const old = (await database.query("SELECT jsonb_typeof($1::jsonb) AS type, '{}'::jsonb || $1::jsonb AS settings", [json(JSON.stringify(patch))])).rows[0];
  assert.equal(old.type, 'string');
  assert.deepEqual(old.settings, [{}, JSON.stringify(patch)]);
  const correct = (await database.query("SELECT jsonb_typeof($1::jsonb) AS type, '{}'::jsonb || $1::jsonb AS settings", [json(patch)])).rows[0];
  assert.equal(correct.type, 'object');
  assert.deepEqual(correct.settings, patch);
});

test('production JSONB serialization preserves settings, records, stock edits and session secrets', async t => {
  const {database, query} = await fixture(t);
  const store = await createPostgresStore('', {query});
  assert.equal((await store.settings()).companyName, 'PotsHavenGh');
  const secret = await store.getSessionSecret();
  assert.match(secret, /^[a-f0-9]{96}$/);
  await store.put('inventory', {id: 'plant', name: 'Peace lily', category: 'Plants', quantity: 8, cost: 75});
  await store.put('places', {id: 'hotel', name: 'Private client hotel', address: 'Accra'});
  const changed = await store.update('inventory', 'plant', {name: 'Healthy peace lily', quantity: 7});
  assert.equal(changed.name, 'Healthy peace lily');
  assert.equal(changed.quantity, 7);
  assert.equal((await store.list('stockMovements')).length, 1);
  const settings = await store.updateSettings({companyName: 'Our actual business', phone: '+233 000000000'});
  assert.equal(settings.companyName, 'Our actual business');
  assert.equal(settings.phone, '+233 000000000');
  assert.ok(!Array.isArray(settings));
  assert.equal(await store.health(), true);
  const reopened = await createPostgresStore('', {query});
  assert.equal((await reopened.get('inventory', 'plant')).quantity, 7);
  assert.equal((await reopened.settings()).companyName, 'Our actual business');
  assert.equal(await reopened.getSessionSecret(), secret);
  const backup = (await database.query("SELECT value FROM potshaven_private.metadata WHERE key = 'settings-before-json-parameter-fix'")).rows;
  assert.equal(backup.length, 0, 'Healthy settings must not be rewritten or backed up as corrupt.');
});

test('legacy saved settings are recovered without losing company fields, records or existing sessions', async t => {
  const {database, query} = await fixture(t);
  const original = await createPostgresStore('', {query});
  await original.put('places', {id: 'saved-place', name: 'Existing customer'});
  const legacy = [
    {companyName: 'First company name', currency: 'GHS'},
    JSON.stringify({phone: '+233 123456789', logo: '/branding/potshaven-logo.png'}),
    JSON.stringify({companyName: 'Final company name', tagline: 'Our real tagline'}),
  ];
  const oldSecret = '"legacy-session-secret-with-existing-quotes"';
  await database.query("UPDATE potshaven_private.metadata SET value = $1::jsonb WHERE key = 'settings'", [JSON.stringify(legacy)]);
  await database.query("INSERT INTO potshaven_private.metadata(key, value) VALUES ('session-secret', $1::jsonb) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(oldSecret)]);
  const [first, second] = await Promise.all([createPostgresStore('', {query}), createPostgresStore('', {query})]);
  const expected = {companyName: 'Final company name', currency: 'GHS', phone: '+233 123456789', logo: '/branding/potshaven-logo.png', tagline: 'Our real tagline'};
  assert.deepEqual(await first.settings(), expected);
  assert.deepEqual(await second.settings(), expected);
  assert.equal((await first.get('places', 'saved-place')).name, 'Existing customer');
  assert.equal(await first.getSessionSecret(), oldSecret, 'An existing signed-in session must not be invalidated by repairing settings.');
  const backups = (await database.query("SELECT value FROM potshaven_private.metadata WHERE key = 'settings-before-json-parameter-fix'")).rows;
  assert.equal(backups.length, 1);
  assert.deepEqual(backups[0].value, legacy, 'The original malformed value must be retained privately.');
  await second.updateSettings({phone: '+233 987654321'});
  const restarted = await createPostgresStore('', {query});
  assert.equal((await restarted.settings()).phone, '+233 987654321');
  assert.deepEqual((await database.query("SELECT value FROM potshaven_private.metadata WHERE key = 'settings-before-json-parameter-fix'")).rows[0].value, legacy);
  assert.equal(await restarted.health(), true);
});

test('unrecognized settings are preserved rather than silently replaced', async t => {
  const {database, query} = await fixture(t);
  await createPostgresStore('', {query});
  const unrecognized = [{companyName: 'Keep this data'}, 'This is not a JSON object patch'];
  await database.query("UPDATE potshaven_private.metadata SET value = $1::jsonb WHERE key = 'settings'", [JSON.stringify(unrecognized)]);
  await assert.rejects(createPostgresStore('', {query}), error => error.code === 'WORKSPACE_SCHEMA_INVALID');
  const current = (await database.query("SELECT value FROM potshaven_private.metadata WHERE key = 'settings'")).rows[0].value;
  assert.deepEqual(current, unrecognized);
});
