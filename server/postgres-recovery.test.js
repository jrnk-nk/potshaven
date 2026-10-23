import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createPostgresStore} from './postgres-store.js';

async function fixture(t) {
  const database = new PGlite();
  let fault;
  let calls = 0;
  const query = async (text, parameters = []) => {
    calls++;
    if (fault) return fault(text, parameters, () => database.query(text, parameters));
    return database.query(text, parameters);
  };
  const store = await createPostgresStore('', {query});
  t.after(() => database.close());
  return {
    store,
    setFault(value) {fault = value; calls = 0;},
    calls: () => calls,
  };
}

test('workspace reads recover from a dropped pooled connection without losing saved data', async t => {
  const {store, setFault, calls} = await fixture(t);
  await store.put('places', {id: 'hotel', name: 'Saved client hotel'});
  await store.putMedia('uploads/saved.png', Buffer.from('saved-photo'), 'image/png');
  const reads = [
    [() => store.state(), value => assert.equal(value.places[0].name, 'Saved client hotel')],
    [() => store.list('places'), value => assert.equal(value[0].name, 'Saved client hotel')],
    [() => store.get('places', 'hotel'), value => assert.equal(value.name, 'Saved client hotel')],
    [() => store.settings(), value => assert.equal(value.companyName, 'PotsHavenGh')],
    [() => store.health(), value => assert.equal(value, true)],
    [() => store.getMedia('uploads/saved.png'), value => assert.equal(value.bytes.toString(), 'saved-photo')],
  ];
  for (const [read, check] of reads) {
    setFault((_text, _parameters, execute) => {
      if (calls() === 1) throw Object.assign(new Error('Connection dropped'), {code: 'ECONNRESET'});
      return execute();
    });
    check(await read());
    assert.equal(calls(), 2, 'Retry the interrupted read once using a new driver query.');
  }
});

test('workspace recovery is bounded and does not retry invalid credentials, TLS or SQL errors', async t => {
  const {store, setFault, calls} = await fixture(t);
  for (const [code, attempts] of [['CONNECTION_CLOSED', 2], ['CONNECT_TIMEOUT', 2], ['EAI_AGAIN', 2], ['53300', 2], ['28P01', 1], ['ENOTFOUND', 1], ['SELF_SIGNED_CERT_IN_CHAIN', 1], ['42601', 1]]) {
    const failure = Object.assign(new Error('Private provider detail'), {code});
    setFault(() => {throw failure;});
    await assert.rejects(store.state(), error => error === failure);
    assert.equal(calls(), attempts, `Unexpected read attempts for ${code}.`);
  }
});

test('an interrupted stock write is never replayed after the database has committed it', async t => {
  const {store, setFault, calls} = await fixture(t);
  await store.put('inventory', {id: 'plants', name: 'Peace lilies', category: 'Plants', quantity: 8, cost: 75});
  setFault(async (_text, _parameters, execute) => {
    await execute();
    throw Object.assign(new Error('Connection closed after commit'), {code: 'CONNECTION_CLOSED'});
  });
  await assert.rejects(store.stock('plants', 3), error => error.code === 'CONNECTION_CLOSED');
  assert.equal(calls(), 1, 'SQL functions that write must not inherit read retries.');
  setFault(undefined);
  assert.equal((await store.get('inventory', 'plants')).quantity, 5);
  assert.equal((await store.list('stockMovements')).length, 1);
});
