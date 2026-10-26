import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from './app.js';
import {createStore} from './store.js';
import {createPostgresStore} from './postgres-store.js';

const message = 'Prepare a maintenance visit for the entrance plants.';
const answer = {reply: 'Review this maintenance visit.', actions: [{collection: 'jobs', operation: 'create', recordId: null, changesJson: JSON.stringify({title: 'Entrance plant check'})}]};
const providerAnswer = () => ({ok: true, json: async () => ({output_text: JSON.stringify(answer)})});
const conversation = (id = randomUUID(), expectedVersion = 0) => ({id, expectedVersion, exchangeId: randomUUID()});
const gate = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};

async function setup(t, kind, fetchAssistant) {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-shared-admission-'));
  let database;
  const stores = [], servers = [];
  const openStore = async () => {
    let store;
    if (kind === 'postgres') {
      database ||= new PGlite();
      store = await createPostgresStore('', {query: async (sql, values = []) => (await database.query(sql, values)).rows});
    } else store = createStore(join(directory, 'company.db'), {seed: false});
    stores.push(store); return store;
  };
  const start = async (store) => {
    store ||= await openStore();
    const server = createApp({store, dataDir: directory, serveClient: false, ownerPassword: 'owner-test', managerPassword: 'manager-test', sessionSecret: 'admission-test-secret', imageKey: 'mock-only-key', fetchAssistant}).listen(0, '127.0.0.1');
    servers.push(server); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`, cookies = {};
    for (const role of ['owner', 'manager']) {
      const response = await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({role, password: role + '-test'})});
      assert.equal(response.status, 200); cookies[role] = response.headers.get('set-cookie').split(';')[0];
    }
    const post = (body, role = 'owner', route = '/api/assistant') => fetch(base + route, {method: 'POST', headers: {'Content-Type': 'application/json', Cookie: cookies[role]}, body: JSON.stringify(body)});
    return {store, post, base, cookies};
  };
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    for (const store of stores) await store.close();
    await database?.close(); rmSync(directory, {recursive: true, force: true});
  });
  const first = await start(), second = await start();
  return {first, second, start};
}

for (const kind of ['sqlite', 'postgres']) {
  test(`${kind}: separate instances share assistant operation and conversation admission, then recover text without another paid call`, async t => {
    let calls = 0; const entered = gate(), release = gate();
    const {first, second, start} = await setup(t, kind, async () => {calls++; entered.resolve(); await release.promise; return providerAnswer();});
    const descriptor = conversation(), body = {message, today: '2026-10-26', conversation: descriptor};
    const pending = first.post(body); await entered.promise;
    try {
      const duplicate = await second.post(body); assert.equal(duplicate.status, 409);
      assert.match((await duplicate.json()).error, /already being prepared/);
      const overlap = await second.post({...body, conversation: conversation(descriptor.id)}); assert.equal(overlap.status, 409);
      assert.equal(calls, 1, 'Shared admission must precede the provider even on a different app instance.');
    } finally {release.resolve();}
    const firstResult = await pending; assert.equal(firstResult.status, 200);
    assert.equal((await firstResult.json()).conversation.version, 1);
    const cold = await start();
    const recovered = await cold.post(body); assert.equal(recovered.status, 200);
    const result = await recovered.json(); assert.equal(result.reply, answer.reply); assert.deepEqual(result.actions, []); assert.equal(calls, 1);
    const receipt = await first.store.getProviderOperation('owner', 'assistant', descriptor.exchangeId);
    assert.equal(receipt.status, 'completed'); assert.equal(receipt.result.conversationId, descriptor.id);
    assert.equal(await first.store.getProviderOperation('manager', 'assistant', descriptor.exchangeId), null);
    assert.ok(!JSON.stringify(await first.store.state()).includes(descriptor.exchangeId));
    assert.equal((await cold.post({...body, siteId: 'different-site'})).status, 409, 'A saved exchange ID cannot change its request fingerprint.');
    assert.equal(calls, 1);
  });

  test(`${kind}: uncertain requests remain blocked after restart, while confirmed text can be recovered when history saving failed`, async t => {
    let calls = 0, failProvider = true;
    const {first, second} = await setup(t, kind, async () => {calls++; if (failProvider) throw new Error('private-provider-token'); return providerAnswer();});
    const descriptor = conversation(), body = {message, conversation: descriptor};
    const failed = await first.post(body); assert.equal(failed.status, 502);
    assert.ok(!(await failed.text()).includes('private-provider-token'));
    const repeat = await second.post(body); assert.equal(repeat.status, 409); assert.equal(calls, 1);
    assert.equal((await first.store.getProviderOperation('owner', 'assistant', descriptor.exchangeId)).status, 'uncertain');
    failProvider = false;
    const newDescriptor = conversation(), newBody = {message, conversation: newDescriptor};
    const original = first.store.appendAssistantExchange;
    first.store.appendAssistantExchange = () => {throw new Error('PRIVATE_DATABASE_URL');};
    try {
      const reply = await first.post(newBody); assert.equal(reply.status, 200);
      const value = await reply.json(); assert.equal(value.reply, answer.reply); assert.match(value.historyError, /save could not be confirmed/);
      assert.equal(value.actions.length, 1);
    } finally {first.store.appendAssistantExchange = original;}
    const recovered = await second.post(newBody); assert.equal(recovered.status, 200);
    const value = await recovered.json(); assert.equal(value.reply, answer.reply); assert.deepEqual(value.actions, []); assert.match(value.historyError, /recovered without another request/); assert.equal(calls, 2);
  });
}

test('shared capacity and readiness cooldown survive new app instances; manager checks never invoke the provider', async t => {
  let calls = 0, waiting = 0; const twoEntered = gate(), release = gate();
  const {first, second, start} = await setup(t, 'sqlite', async (url, init) => {
    calls++;
    if (typeof JSON.parse(init.body).input === 'string') return {ok: true, json: async () => ({status: 'completed', output_text: 'Ready'})};
    if (++waiting === 2) twoEntered.resolve();
    await release.promise; return providerAnswer();
  });
  const firstRequest = first.post({message}), secondRequest = second.post({message}, 'manager'); await twoEntered.promise;
  try {
    const third = await second.post({message: 'Another different plan'}); assert.equal(third.status, 429); assert.equal(calls, 2);
  } finally {release.resolve();}
  assert.equal((await firstRequest).status, 200); assert.equal((await secondRequest).status, 200);
  assert.equal((await first.post({}, 'manager', '/api/readiness/assistant')).status, 403); assert.equal(calls, 2);
  assert.equal((await first.post({}, 'owner', '/api/readiness/assistant')).status, 200); assert.equal(calls, 3);
  const cold = await start();
  assert.equal((await cold.post({}, 'owner', '/api/readiness/assistant')).status, 429); assert.equal(calls, 3);
});

test('a lost admission response fails closed without a provider call or a second claim', async t => {
  let calls = 0;
  const {first, second} = await setup(t, 'sqlite', async () => {calls++; return providerAnswer();});
  const descriptor = conversation(), body = {message, conversation: descriptor};
  const original = first.store.claimProviderOperation; let writes = 0;
  first.store.claimProviderOperation = async (...args) => {writes++; await original(...args); throw Object.assign(new Error('PRIVATE_DATABASE_URL'), {code: 'CONNECTION_CLOSED'});};
  const failed = await first.post(body); assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('PRIVATE_DATABASE_URL'));
  assert.equal(writes, 1); assert.equal(calls, 0);
  const retry = await second.post(body); assert.equal(retry.status, 409); assert.equal(calls, 0);
});
