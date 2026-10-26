import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import postgres from 'postgres';
import {PGlite} from '@electric-sql/pglite';
import {createStore, PROVIDER_LIMITS} from './store.js';
import {createPostgresStore} from './postgres-store.js';
import {providerFingerprint} from './provider-operations.js';

const at = 2000000000000;
const request = (kind = 'assistant', role = 'owner', extra = {}) => ({kind, role, requestId: randomUUID(), fingerprint: providerFingerprint({message: 'Private fixture prompt'}), ...extra});
async function fixture(t, backend) {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-provider-operations-'));
  let database, driver, query;
  const stores = [];
  if (backend === 'postgres') {
    database = new PGlite();
    driver = postgres('postgresql://fixture:fixture@unused.invalid/fixture', {prepare: false});
    query = async (sql, parameters = []) => (await database.query(sql, parameters.map((value, index) => value !== null && new RegExp(`\\$${index + 1}::jsonb\\b`).test(sql) ? driver.options.serializers[3802](value) : value))).rows;
  }
  const reopen = async (overrides = {}) => {
    const store = backend === 'postgres' ? await createPostgresStore('', {query, ...overrides}) : createStore(join(directory, 'workspace.db'), {seed: false});
    stores.push(store); return store;
  };
  t.after(async () => {for (const store of stores) await store.close(); await driver?.end({timeout: 0}); await database?.close(); rmSync(directory, {recursive: true, force: true});});
  return {store: await reopen(), reopen, query, database};
}

for (const backend of ['sqlite', 'postgres']) {
  test(`${backend} provider receipts isolate roles and never repeat a pending or completed paid request`, async t => {
    const {store, reopen} = await fixture(t, backend), before = await store.state();
    const original = request('assistant', 'owner', {resourceKey: 'conversation:one'});
    const claimed = await store.claimProviderOperation(original, at);
    assert.equal(claimed.claimed, true); assert.equal(claimed.operation.status, 'pending');
    assert.notEqual(claimed.operation.resultId, original.requestId);
    assert.ok(!JSON.stringify(claimed).includes('Private fixture prompt'));
    const second = await reopen();
    assert.deepEqual(await second.claimProviderOperation(original, at + 1), {...claimed, claimed: false});
    assert.equal(await second.getProviderOperation('manager', 'assistant', original.requestId, at), null);
    await assert.rejects(async () => second.claimProviderOperation({...original, fingerprint: 'b'.repeat(64)}, at), error => error.status === 409);
    await assert.rejects(async () => second.claimProviderOperation(request('assistant', 'owner', {resourceKey: 'conversation:one'}), at), error => error.status === 409);
    const manager = {...original, role: 'manager'};
    assert.equal((await second.claimProviderOperation(manager, at)).claimed, true);
    await assert.rejects(async () => store.claimProviderOperation(request(), at), error => error.status === 429);
    const result = {reply: 'The saved reply', conversationId: randomUUID()};
    const complete = await store.finishProviderOperation('owner', 'assistant', original.requestId, {status: 'completed', result}, at + 10);
    assert.equal(complete.status, 'completed'); assert.deepEqual(complete.result, result);
    const cold = await reopen();
    assert.deepEqual((await cold.claimProviderOperation(original, at + 20)).operation, complete);
    assert.deepEqual(await cold.finishProviderOperation('owner', 'assistant', original.requestId, {status: 'completed', result}, at + 30), complete);
    await assert.rejects(async () => cold.finishProviderOperation('owner', 'assistant', original.requestId, {status: 'failed'}, at + 30), error => error.status === 409);
    assert.equal((await cold.claimProviderOperation(request(), at + 30)).claimed, true, 'Completion releases capacity.');
    assert.deepEqual(await cold.state(), before, 'Private receipts do not leak through company records or settings.');
  });

  test(`${backend} shared provider admission survives concurrency, expired leases and rate windows`, async t => {
    const {store, reopen} = await fixture(t, backend), other = await reopen();
    const jobs = [request('studio'), request('studio')];
    const attempts = await Promise.allSettled(jobs.map((job, index) => Promise.resolve().then(() => [store, other][index].claimProviderOperation(job, at))));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(result => result.status === 'rejected').reason.status, 429);
    const winner = jobs[attempts.findIndex(result => result.status === 'fulfilled')];
    const expires = at + PROVIDER_LIMITS.studio.leaseMs;
    assert.equal((await other.getProviderOperation('owner', 'studio', winner.requestId, expires)).status, 'uncertain');
    const retry = await other.claimProviderOperation(winner, expires);
    assert.equal(retry.claimed, false); assert.equal(retry.operation.status, 'uncertain');
    assert.equal((await other.claimProviderOperation(request('studio'), expires)).claimed, true, 'Expiration releases capacity for a different explicit request.');
    const readiness = request('readiness');
    await store.claimProviderOperation(readiness, at);
    await store.finishProviderOperation('owner', 'readiness', readiness.requestId, {status: 'completed', result: {ok: true}}, at + 1);
    await assert.rejects(async () => other.claimProviderOperation(request('readiness'), at + 2), error => error.status === 429);
    assert.equal((await other.claimProviderOperation(request('readiness'), at + 60000)).claimed, true);
    // The same ID remains a receipt forever, even after the rate/lease window.
    assert.equal((await other.claimProviderOperation(readiness, expires + 1)).claimed, false);
    const uncertain = request('assistant'); await store.claimProviderOperation(uncertain, at);
    await store.finishProviderOperation('owner', 'assistant', uncertain.requestId, {status: 'uncertain'}, at + 2);
    assert.equal((await other.claimProviderOperation(uncertain, expires)).claimed, false);
    const recovered = await other.finishProviderOperation('owner', 'assistant', uncertain.requestId, {status: 'completed', result: {reply: 'Late confirmed reply'}}, expires);
    assert.equal(recovered.status, 'completed');
    const same = request('assistant');
    const duplicates = await Promise.all([store, other].map(item => Promise.resolve().then(() => item.claimProviderOperation(same, expires + 10))));
    assert.deepEqual(duplicates.map(item => item.claimed).sort(), [false, true]);
    assert.equal(duplicates[0].operation.resultId, duplicates[1].operation.resultId);
    await store.finishProviderOperation(same.role, same.kind, same.requestId, {status: 'failed'}, expires + 11);
    assert.equal((await other.claimProviderOperation(same, expires + 600000)).claimed, false);
    await assert.rejects(async () => other.finishProviderOperation(same.role, same.kind, same.requestId, {status: 'completed', result: {reply: 'Must not replace failure'}}, expires + 12), error => error.status === 409);
  });

  test(`${backend} session generations revoke one role durably and increment atomically`, async t => {
    const {store, reopen, query} = await fixture(t, backend), other = await reopen();
    assert.equal(await store.getSessionGeneration('owner'), 0);
    const generations = await Promise.all([store, other].map(item => Promise.resolve().then(() => item.revokeRoleSessions('manager'))));
    assert.deepEqual(generations.sort(), [1, 2]);
    assert.equal(await store.getSessionGeneration('owner'), 0);
    assert.equal(await (await reopen()).getSessionGeneration('manager'), 2);
    await assert.rejects(async () => store.revokeRoleSessions('administrator'), error => error.status === 400);
    for (const invalid of [undefined, {}, request('wrong'), {...request(), role: 'public'}, {...request(), requestId: '../settings'}, {...request(), fingerprint: 'raw prompt'}]) await assert.rejects(async () => store.claimProviderOperation(invalid, at));
    const valid = request(); await store.claimProviderOperation(valid, at);
    await assert.rejects(async () => store.finishProviderOperation('owner', 'assistant', valid.requestId, {status: 'pending'}, at));
    await assert.rejects(async () => store.finishProviderOperation('owner', 'assistant', valid.requestId, {status: 'completed', result: {body: 'x'.repeat(64001)}}, at));
    if (backend === 'sqlite') store.db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run('session-generation:owner', '-1');
    else await query("INSERT INTO potshaven_private.metadata(key,value) VALUES ('session-generation:owner', '-1'::jsonb)");
    await assert.rejects(async () => store.getSessionGeneration('owner'), error => error.status === 503);
    await assert.rejects(async () => store.revokeRoleSessions('owner'), 'A corrupt generation must not become zero and revive legacy sessions.');
    await assert.rejects(async () => store.getSessionGeneration('owner'), error => error.status === 503);
    const corruptKey = `provider-operation:assistant:owner:${randomUUID()}`;
    const malformed = {status: 'pending', kind: 'assistant', role: 'owner', resourceKey: ''};
    if (backend === 'sqlite') store.db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run(corruptKey, JSON.stringify(malformed));
    else await query('INSERT INTO potshaven_private.metadata(key,value) VALUES ($1,$2::jsonb)', [corruptKey, malformed]);
    await assert.rejects(async () => other.claimProviderOperation(request(), at + 1000000), error => error.status === 503);
  });
}

test('PostgreSQL lost admission/finalization acknowledgements are never replayed and remain discoverable', async t => {
  const {reopen, query} = await fixture(t, 'postgres');
  let loseClaim = true, loseFinish = true, claims = 0, finishes = 0;
  const faulty = await reopen({query: async (sql, params) => {
    const result = await query(sql, params);
    if (sql.startsWith('SELECT potshaven_private.claim_provider_operation')) {
      claims++;
      if (loseClaim) {loseClaim = false; throw Object.assign(new Error('Admission response lost'), {code: 'CONNECTION_CLOSED'});}
    }
    if (sql.startsWith('SELECT potshaven_private.finish_provider_operation')) {
      finishes++;
      if (loseFinish) {loseFinish = false; throw Object.assign(new Error('Completion response lost'), {code: 'CONNECTION_CLOSED'});}
    }
    return result;
  }});
  const input = request();
  await assert.rejects(faulty.claimProviderOperation(input, at), /Admission response lost/);
  assert.equal(claims, 1, 'A mutation with unknown commit status cannot be retried internally.');
  const recovered = await (await reopen()).claimProviderOperation(input, at + 1);
  assert.equal(recovered.claimed, false); assert.equal(recovered.operation.status, 'pending');
  await assert.rejects(faulty.finishProviderOperation(input.role, input.kind, input.requestId, {status: 'completed', result: {reply: 'Saved'}}, at + 2), /Completion response lost/);
  assert.equal(finishes, 1);
  assert.equal((await faulty.getProviderOperation(input.role, input.kind, input.requestId, at + 3)).result.reply, 'Saved');
});

test('provider request fingerprints are stable across object key order without storing raw values', () => {
  assert.equal(providerFingerprint({b: [1, 'x'], a: {d: true, c: null}}), providerFingerprint({a: {c: null, d: true}, b: [1, 'x']}));
  assert.notEqual(providerFingerprint({a: 1}), providerFingerprint({a: 2}));
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => providerFingerprint(cycle), /could not be identified/);
});
