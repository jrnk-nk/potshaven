import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {PGlite} from '@electric-sql/pglite';
import {createPostgresStore} from './postgres-store.js';
import {createCloudHandler} from './cloud.js';

async function serve(t, handler) {
  const server = createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('a warm Vercel function checks actual database reads, reports failures privately, and recovers', async t => {
  const database = new PGlite();
  t.after(() => database.close());
  let failure;
  const query = async (sql, parameters = []) => {
    if (failure) throw failure;
    return (await database.query(sql, parameters)).rows;
  };
  const store = await createPostgresStore('', {query});
  await store.put('places', {id: 'private-client', name: 'PRIVATE_COMPANY_RECORD_DO_NOT_EXPOSE'});
  await store.putMedia(`uploads/${'0'.repeat(64)}.png`, Buffer.from('PRIVATE_IMAGE_CONTENT'), 'image/png');
  const env = {
    DATABASE_URL: 'postgresql://private-user:private-database-password@private-host.invalid/postgres',
    APP_OWNER_PASSWORD: 'private-owner-password', APP_MANAGER_PASSWORD: 'private-manager-password',
  };
  let connections = 0;
  const base = await serve(t, createCloudHandler({env, connect: async () => {connections++; return store;}}));
  const healthy = await fetch(base + '/api/health');
  const text = await healthy.text();
  assert.equal(healthy.status, 200);
  assert.equal(JSON.parse(text).database, 'connected');
  for (const secret of [env.DATABASE_URL, env.APP_OWNER_PASSWORD, 'PRIVATE_COMPANY_RECORD', 'PRIVATE_IMAGE_CONTENT']) assert.ok(!text.includes(secret));

  const login = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({role: 'owner', password: env.APP_OWNER_PASSWORD}),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  failure = Object.assign(new Error(env.DATABASE_URL), {code: '28P01'});
  for (const path of ['/api/health', '/api/state']) {
    const response = await fetch(base + path, {headers: {Cookie: cookie}});
    const body = await response.text();
    assert.equal(response.status, 503, 'A cached app must not hide a failed database connection.');
    const result = JSON.parse(body);
    assert.equal(result.code, 'DATABASE_UNAVAILABLE');
    assert.equal(result.diagnostic, 'AUTHENTICATION_FAILED');
    assert.ok(!body.includes(env.DATABASE_URL));
  }
  failure = undefined;
  const recovered = await fetch(base + '/api/health');
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).database, 'connected');
  const state = await fetch(base + '/api/state', {headers: {Cookie: cookie}});
  assert.equal(state.status, 200);
  assert.equal((await state.json()).places[0].name, 'PRIVATE_COMPANY_RECORD_DO_NOT_EXPOSE');
  assert.equal(connections, 1, 'The probe must test the warm connection rather than only another initialization.');
});

test('readiness checks the workspace tables and usable settings without changing stored records', async t => {
  const database = new PGlite();
  t.after(() => database.close());
  const query = async (sql, parameters = []) => (await database.query(sql, parameters)).rows;
  const store = await createPostgresStore('', {query});
  const before = await store.state();
  assert.equal(await store.health(), true);
  assert.deepEqual(await store.state(), before);
  await database.exec("UPDATE potshaven_private.metadata SET value = '[]'::jsonb WHERE key = 'settings'");
  await assert.rejects(store.health(), error => error.code === 'WORKSPACE_SCHEMA_INVALID');
  await database.exec("UPDATE potshaven_private.metadata SET value = '{}'::jsonb WHERE key = 'settings'");
  assert.equal(await store.health(), true);
  await database.exec('ALTER TABLE potshaven_private.media RENAME TO media_temporarily_unavailable');
  await assert.rejects(store.health(), error => error.code === '42P01');
  await database.exec('ALTER TABLE potshaven_private.media_temporarily_unavailable RENAME TO media');
  assert.equal(await store.health(), true);
});
