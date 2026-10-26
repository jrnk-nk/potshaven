import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import postgres from 'postgres';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from './app.js';
import {createStore} from './store.js';
import {createPostgresStore} from './postgres-store.js';
import {createMediaStorage} from './media-storage.js';

// Provider calls are deliberately injected. These tests never generate a paid
// image or read production records; the bytes only test durable image storage.
const imageBytes = Buffer.from('isolated-provider-image-bytes');
const imageReply = () => new Response(JSON.stringify({data: [{b64_json: imageBytes.toString('base64')}]}), {status: 200, headers: {'Content-Type': 'application/json'}});
const passwords = {owner: 'isolated-studio-owner-password', manager: 'isolated-studio-manager-password'};
const body = requestId => ({requestId, prompt: 'Arrange low plants around the hotel entrance.'});
const failure = () => Object.assign(new Error('private-database-host-and-password'), {code: 'CONNECTION_CLOSED'});

async function fixture(t, backend) {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-studio-admission-'));
  const stores = [], servers = [];
  let database, driver, query;
  if (backend === 'postgres') {
    database = new PGlite();
    driver = postgres('postgresql://fixture:fixture@unused.invalid/fixture', {prepare: false});
    query = async (sql, parameters = []) => (await database.query(sql, parameters.map((value, index) => value !== null && new RegExp(`\\$${index + 1}::jsonb\\b`).test(sql) ? driver.options.serializers[3802](value) : value))).rows;
  }
  const reopen = async () => {
    const store = backend === 'postgres' ? await createPostgresStore('', {query}) : createStore(join(directory, 'workspace.db'), {seed: false});
    stores.push(store); return store;
  };
  const serve = async (store, fetchImage) => {
    const app = createApp({store, dataDir: directory, serveClient: false,
      ownerPassword: passwords.owner, managerPassword: passwords.manager,
      sessionSecret: 'isolated-studio-admission-secret', imageKey: 'not-a-real-provider-key', fetchImage,
      ...(backend === 'postgres' ? {mediaStorage: createMediaStorage(store)} : {}),
    });
    const server = await new Promise(resolve => {const running = app.listen(0, '127.0.0.1', () => resolve(running));});
    servers.push(server);
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, {cookie, method = 'GET', value} = {}) => fetch(base + path, {method,
      headers: {...(cookie ? {Cookie: cookie} : {}), ...(value !== undefined ? {'Content-Type': 'application/json'} : {})},
      ...(value !== undefined ? {body: JSON.stringify(value)} : {}),
    });
    const login = async role => {
      const response = await request('/api/auth/login', {method: 'POST', value: {role, password: passwords[role]}});
      assert.equal(response.status, 200, await response.clone().text());
      return response.headers.get('set-cookie').split(';')[0];
    };
    return {base, request, login, generate: (cookie, value) => request('/api/designs/generate', {cookie, method: 'POST', value}), status: (cookie, requestId) => request(`/api/designs/requests/${requestId}`, {cookie})};
  };
  t.after(async () => {
    for (const server of servers) await new Promise(resolve => server.close(resolve));
    for (const store of stores) await store.close();
    await driver?.end({timeout: 0}); await database?.close();
    rmSync(directory, {recursive: true, force: true});
  });
  return {reopen, serve};
}

for (const backend of ['sqlite', 'postgres']) {
  test(`${backend} studio admission prevents duplicate cross-instance generation and recovers completed requests after restart`, {timeout: 30000}, async t => {
    const {reopen, serve} = await fixture(t, backend);
    const firstStore = await reopen(), secondStore = await reopen();
    let calls = 0, entered, release;
    const started = new Promise(resolve => {entered = resolve;});
    const gate = new Promise(resolve => {release = resolve;});
    const provider = async () => {calls++; entered(); await gate; return imageReply();};
    const first = await serve(firstStore, provider), second = await serve(secondStore, provider);
    const owner = await first.login('owner'), manager = await first.login('manager');
    const requestId = randomUUID(), instructions = body(requestId);
    assert.equal((await first.generate(undefined, instructions)).status, 401);
    assert.equal((await first.generate(manager, instructions)).status, 403);
    assert.equal((await first.status(manager, requestId)).status, 403);
    assert.equal((await first.status(owner, randomUUID())).status, 404);
    assert.equal((await first.generate(owner, {...instructions, requestId: '../invalid'})).status, 400);
    assert.equal(calls, 0);
    const running = first.generate(owner, instructions);
    try {
      await started;
      const status = await second.status(owner, requestId);
      assert.equal(status.status, 200);
      assert.match(status.headers.get('cache-control'), /no-store/);
      const pending = await status.json();
      assert.equal(pending.status, 'pending');
      assert.equal(pending.design, undefined);
      assert.ok(!JSON.stringify(pending).includes('fingerprint'));
      assert.equal((await second.generate(owner, instructions)).status, 409);
      assert.equal((await second.generate(owner, {...instructions, prompt: 'Different instructions.'})).status, 409);
      assert.equal((await second.generate(owner, body(randomUUID()))).status, 429);
      assert.equal(calls, 1, 'Neither a duplicate ID nor another instance may bypass studio capacity.');
    } finally {release();}
    const response = await running;
    assert.equal(response.status, 201, await response.clone().text());
    const design = await response.json();
    const operation = await firstStore.getProviderOperation('owner', 'studio', requestId);
    assert.equal(design.id, operation.resultId, 'The receipt allocates the design identity before generation.');
    assert.equal((await firstStore.list('designs')).length, 1);
    const cold = await serve(await reopen(), provider);
    const recovered = await cold.status(owner, requestId);
    assert.equal(recovered.status, 200);
    const saved = await recovered.json();
    assert.equal(saved.status, 'completed');
    assert.equal(saved.design.id, design.id);
    const repeated = await cold.generate(owner, instructions);
    assert.ok([200, 201].includes(repeated.status));
    assert.equal((await repeated.json()).id, design.id);
    assert.equal(calls, 1, 'A confirmed retry returns the saved design without another provider request.');
    assert.deepEqual(Buffer.from(await (await cold.request(design.image, {cookie: owner})).arrayBuffer()), imageBytes);
  });

  test(`${backend} a committed design survives an interrupted save response and is recovered without another paid request`, {timeout: 30000}, async t => {
    const {reopen, serve} = await fixture(t, backend);
    const unstable = await reopen(), healthy = await reopen();
    const put = unstable.put.bind(unstable);
    unstable.put = async (collection, ...args) => {
      const result = await put(collection, ...args);
      if (collection === 'designs') throw failure();
      return result;
    };
    let calls = 0;
    const provider = async () => {calls++; return imageReply();};
    const first = await serve(unstable, provider), second = await serve(healthy, provider);
    const owner = await first.login('owner'), requestId = randomUUID(), instructions = body(requestId);
    const response = await first.generate(owner, instructions);
    assert.ok(response.status >= 500, 'An unconfirmed write must not be reported as a confirmed new save.');
    assert.ok(!(await response.text()).includes('private-database-host-and-password'));
    const receipt = await healthy.getProviderOperation('owner', 'studio', requestId);
    const recovered = await second.status(owner, requestId);
    assert.equal(recovered.status, 200);
    const saved = await recovered.json();
    assert.equal(saved.status, 'completed');
    assert.equal(saved.design.id, receipt.resultId);
    assert.equal((await healthy.list('designs')).length, 1);
    const repeated = await second.generate(owner, instructions);
    assert.ok([200, 201].includes(repeated.status));
    assert.equal((await repeated.json()).id, receipt.resultId);
    assert.equal(calls, 1);
    assert.deepEqual(Buffer.from(await (await second.request(saved.design.image, {cookie: owner})).arrayBuffer()), imageBytes);
  });
}

test('studio admission fails closed before provider access, and uncertain requests never regenerate under the same ID', {timeout: 15000}, async t => {
  const {reopen, serve} = await fixture(t, 'sqlite');
  const store = await reopen();
  const claim = store.claimProviderOperation.bind(store);
  let calls = 0;
  const app = await serve(store, async () => {calls++; throw Object.assign(new Error('private-provider-details'), {name: 'TimeoutError'});});
  const owner = await app.login('owner');
  const requestId = randomUUID(), instructions = body(requestId);
  store.claimProviderOperation = async () => {throw failure();};
  const refused = await app.generate(owner, instructions);
  assert.ok(refused.status >= 500);
  assert.ok(!(await refused.text()).includes('private-database-host-and-password'));
  assert.equal(calls, 0);
  store.claimProviderOperation = claim;
  const timedOut = await app.generate(owner, instructions);
  assert.ok(timedOut.status >= 500);
  assert.equal(calls, 1);
  const status = await app.status(owner, requestId);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).status, 'uncertain');
  const retry = await app.generate(owner, instructions);
  assert.equal(retry.status, 409);
  assert.equal(calls, 1, 'Timeouts cannot prove the provider did not process an image.');
});

test('studio can recover a saved design when final receipt acknowledgement fails', {timeout: 15000}, async t => {
  const {reopen, serve} = await fixture(t, 'sqlite');
  const store = await reopen(), other = await reopen();
  const finish = store.finishProviderOperation.bind(store);
  store.finishProviderOperation = async (role, kind, id, value, ...args) => {
    if (kind === 'studio' && value.status === 'completed') throw failure();
    return finish(role, kind, id, value, ...args);
  };
  let calls = 0;
  const provider = async () => {calls++; return imageReply();};
  const first = await serve(store, provider), second = await serve(other, provider);
  const owner = await first.login('owner'), requestId = randomUUID();
  const response = await first.generate(owner, body(requestId));
  // The business record itself has a confirmed save, so either a successful
  // result or a visible receipt error is safe if read-only recovery works.
  assert.ok(response.ok || response.status >= 500);
  const status = await second.status(owner, requestId);
  assert.equal(status.status, 200);
  const result = await status.json();
  assert.equal(result.status, 'completed');
  assert.equal(result.design.id, (await other.getProviderOperation('owner', 'studio', requestId)).resultId);
  assert.equal(calls, 1);
  assert.equal((await other.list('designs')).length, 1);
});

test('an interrupted acknowledgement of a committed studio claim never starts or replays a provider call', {timeout: 15000}, async t => {
  const {reopen, serve} = await fixture(t, 'sqlite');
  const unstable = await reopen();
  const claim = unstable.claimProviderOperation.bind(unstable);
  unstable.claimProviderOperation = async (...args) => {await claim(...args); throw failure();};
  let calls = 0;
  const provider = async () => {calls++; return imageReply();};
  const first = await serve(unstable, provider);
  const owner = await first.login('owner'), requestId = randomUUID(), instructions = body(requestId);
  const response = await first.generate(owner, instructions);
  assert.ok(response.status >= 500);
  assert.ok(!(await response.text()).includes('private-database-host-and-password'));
  assert.equal(calls, 0, 'An uncertain admission result cannot authorize spending.');
  const healthy = await reopen(), cold = await serve(healthy, provider);
  assert.equal((await (await cold.status(owner, requestId)).json()).status, 'pending');
  assert.equal((await cold.generate(owner, instructions)).status, 409);
  assert.equal(calls, 0, 'The saved pending request remains excluded after a cold restart.');
  assert.equal((await healthy.list('designs')).length, 0);
});
