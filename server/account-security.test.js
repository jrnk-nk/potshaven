import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import postgres from 'postgres';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from './app.js';
import {createStore} from './store.js';
import {createPostgresStore} from './postgres-store.js';
import {createMediaStorage} from './media-storage.js';

const credentials = {owner: 'isolated-owner-account-password', manager: 'isolated-manager-account-password'};
async function fixture(t, backend = 'sqlite', options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-account-security-'));
  let database, driver;
  const stores = [], servers = [];
  if (backend === 'postgres') {
    database = new PGlite();
    driver = postgres('postgresql://fixture:fixture@unused.invalid/fixture', {prepare: false});
  }
  const reopen = async () => {
    const store = backend === 'postgres' ? await createPostgresStore('', {query: async (sql, params = []) => database.query(sql, params.map((value, index) => value !== null && new RegExp(`\\$${index + 1}::jsonb\\b`).test(sql) ? driver.options.serializers[3802](value) : value))}) : createStore(join(directory, 'workspace.db'), {seed: false});
    stores.push(store); return store;
  };
  const serve = async store => {
    const app = createApp({store, dataDir: directory, serveClient: false, sessionSecret: 'isolated-account-security-secret', ownerPassword: credentials.owner, managerPassword: credentials.manager, imageKey: '', ...(backend === 'postgres' ? {mediaStorage: createMediaStorage(store)} : {}), ...options});
    const server = app.listen(0, '127.0.0.1'); servers.push(server); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, cookie, method = 'GET', body, headers = {}) => fetch(base + path, {method, headers: {...(cookie ? {Cookie: cookie} : {}), ...(body ? {'Content-Type': 'application/json'} : {}), ...headers}, ...(body ? {body: JSON.stringify(body)} : {})});
    const login = async role => {
      const response = await request('/api/auth/login', null, 'POST', {role, password: options[`${role}Password`] ?? credentials[role]});
      assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
    };
    return {base, request, login};
  };
  t.after(async () => {for (const server of servers) await new Promise(resolve => server.close(resolve)); for (const store of stores) await store.close(); await driver?.end({timeout: 0}); await database?.close(); rmSync(directory, {recursive: true, force: true});});
  const store = await reopen(), server = await serve(store);
  return {store, reopen, serve, ...server};
}

test('account posture is owner-only and reports safe checks instead of passwords or invented MFA', async t => {
  const {request, login} = await fixture(t, 'sqlite', {ownerPassword: 'same-password', managerPassword: 'same-password'});
  assert.equal((await request('/api/security')).status, 401);
  assert.equal((await request('/api/security', await login('manager'))).status, 403);
  const response = await request('/api/security', await login('owner')), value = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Object.keys(value).sort(), ['checkedAt', 'disabled', 'managerPasswordStrong', 'ownerPasswordStrong', 'passwordsDistinct', 'sharedAccounts']);
  assert.equal(value.disabled, false); assert.equal(value.passwordsDistinct, false); assert.equal(value.ownerPasswordStrong, true); assert.equal(value.sharedAccounts, true);
  assert.ok(Number.isFinite(Date.parse(value.checkedAt))); assert.ok(!JSON.stringify(value).includes('same-password'));
  const weak = await fixture(t, 'sqlite', {ownerPassword: 'short', managerPassword: 'also-short'});
  const weakStatus = await (await weak.request('/api/security', await weak.login('owner'))).json();
  assert.equal(weakStatus.passwordsDistinct, true); assert.equal(weakStatus.ownerPasswordStrong, false); assert.equal(weakStatus.managerPasswordStrong, false);
});

for (const backend of ['sqlite', 'postgres']) test(`${backend} owner revokes all devices for one role across cold instances while preserving saved work and other roles`, async t => {
  const {store, request, login, reopen, serve} = await fixture(t, backend);
  await store.put('places', {id: 'saved-site', name: 'Saved company site'});
  const owner = await login('owner'), otherOwner = await login('owner'), manager = await login('manager'), otherManager = await login('manager');
  assert.equal(await store.getSessionGeneration('owner'), 0); assert.equal(await store.getSessionGeneration('manager'), 0);
  const before = await store.state();
  assert.equal((await request('/api/security/sign-out-all', manager, 'POST', {role: 'owner', password: credentials.owner})).status, 403);
  assert.equal((await request('/api/security/sign-out-all', owner, 'POST', {role: 'manager', password: credentials.manager})).status, 403);
  assert.equal((await request('/api/security/sign-out-all', owner, 'POST', {role: 'manager', password: credentials.owner}, {Origin: 'https://unrelated.invalid'})).status, 403);
  assert.equal(await store.getSessionGeneration('manager'), 0);
  let response = await request('/api/security/sign-out-all', owner, 'POST', {role: 'manager', password: credentials.owner});
  assert.equal(response.status, 200); assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), {ok: true, role: 'manager', currentSessionRevoked: false});
  const coldStore = await reopen(), cold = await serve(coldStore);
  assert.equal(await coldStore.getSessionGeneration('manager'), 1);
  for (const cookie of [manager, otherManager]) assert.equal((await cold.request('/api/state', cookie)).status, 401);
  for (const cookie of [owner, otherOwner]) assert.equal((await cold.request('/api/state', cookie)).status, 200);
  const newManager = await cold.login('manager'); assert.equal((await cold.request('/api/state', newManager)).status, 200);
  response = await cold.request('/api/security/sign-out-all', owner, 'POST', {role: 'owner', password: credentials.owner});
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.deepEqual(await response.json(), {ok: true, role: 'owner', currentSessionRevoked: true});
  for (const cookie of [owner, otherOwner]) assert.equal((await request('/api/state', cookie)).status, 401);
  assert.equal((await request('/api/state', newManager)).status, 200);
  assert.equal((await cold.request('/api/state', await cold.login('owner'))).status, 200);
  assert.deepEqual(await store.state(), before, 'Device revocation must not alter saved company work.');
});

test('owner reauthentication attempts persist across instances and ordinary sign-in cannot clear them', async t => {
  const {request, login, reopen, serve, store} = await fixture(t);
  const owner = await login('owner'), cold = await serve(await reopen());
  for (let attempt = 0; attempt < 10; attempt++) {
    const app = attempt % 2 ? cold : {request};
    assert.equal((await app.request('/api/security/sign-out-all', owner, 'POST', {role: 'manager', password: 'incorrect-owner-password'})).status, 403);
    assert.ok(await login('owner'));
  }
  const blocked = await cold.request('/api/security/sign-out-all', owner, 'POST', {role: 'manager', password: credentials.owner});
  assert.equal(blocked.status, 429); assert.equal(await store.getSessionGeneration('manager'), 0);
  const metadata = store.db.prepare("SELECT key,value FROM metadata WHERE key LIKE 'login-attempt:%'").all();
  assert.ok(metadata.some(row => JSON.parse(row.value).count === 10));
  assert.doesNotMatch(JSON.stringify(metadata), /incorrect-owner-password|127\.0\.0\.1|isolated-owner-account-password/);
});

test('validation, demo mode and database failures never claim an unconfirmed device sign-out', async t => {
  const {request, login, store} = await fixture(t);
  const owner = await login('owner');
  for (const body of [{role: 'all', password: credentials.owner}, {role: 'manager', password: 123}, {role: 'owner', password: 'x'.repeat(1025)}, {role: 'manager', password: credentials.owner, generation: 99}]) assert.equal((await request('/api/security/sign-out-all', owner, 'POST', body)).status, 400);
  const originalAttempt = store.recordLoginAttempt.bind(store), originalRevoke = store.revokeRoleSessions.bind(store);
  store.recordLoginAttempt = async () => {throw new Error('PRIVATE_DATABASE_CREDENTIAL');};
  let response = await request('/api/security/sign-out-all', owner, 'POST', {role: 'manager', password: credentials.owner});
  assert.equal(response.status, 503); assert.equal(response.headers.get('set-cookie'), null); assert.ok(!(await response.text()).includes('PRIVATE_DATABASE_CREDENTIAL'));
  store.recordLoginAttempt = originalAttempt;
  store.revokeRoleSessions = async () => {throw new Error('PRIVATE_DATABASE_CREDENTIAL');};
  response = await request('/api/security/sign-out-all', owner, 'POST', {role: 'owner', password: credentials.owner});
  assert.equal(response.status, 503); assert.equal(response.headers.get('set-cookie'), null); assert.ok(!(await response.text()).includes('PRIVATE_DATABASE_CREDENTIAL'));
  assert.equal((await request('/api/state', owner)).status, 200);
  let writes = 0;
  store.revokeRoleSessions = async role => {writes++; await originalRevoke(role); throw new Error('Lost response after commit');};
  response = await request('/api/security/sign-out-all', owner, 'POST', {role: 'owner', password: credentials.owner});
  assert.equal(response.status, 503); assert.equal(response.headers.get('set-cookie'), null); assert.equal(writes, 1);
  assert.equal((await request('/api/state', owner)).status, 401, 'An uncertain committed revocation still rejects old sessions.');
  const demo = await fixture(t, 'sqlite', {ownerPassword: '', managerPassword: ''});
  const posture = await (await demo.request('/api/security')).json(); assert.equal(posture.disabled, true);
  assert.equal((await demo.request('/api/security/sign-out-all', null, 'POST', {role: 'manager', password: 'unused-password'})).status, 403);
  assert.equal(await demo.store.getSessionGeneration('manager'), 0);
});
