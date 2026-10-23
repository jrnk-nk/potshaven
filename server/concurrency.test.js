import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from './store.js';
import {createApp} from './app.js';

async function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-concurrency-'));
  const store = createStore(':memory:', {seed: false});
  store.put('places', {id: 'site', name: 'Hotel garden', inspections: []});
  store.put('jobs', {
    id: 'job', title: 'Water and prune', placeId: 'site', type: 'Maintenance',
    status: 'Scheduled', date: '2026-10-23', crewIds: [],
    budget: 750, privateNote: 'OWNER_PRIVATE_DETAILS',
    tasks: [{id: 'water', title: 'Water pots', done: false, cost: 25}, {id: 'prune', title: 'Prune hedge', done: false}],
  });
  store.put('inventory', {id: 'plants', name: 'Peace lilies', category: 'Plants', quantity: 20, cost: 45, unit: 'plants'});
  const app = createApp({store, dataDir: directory, serveClient: false, ownerPassword: 'owner-secret', managerPassword: 'manager-secret', sessionSecret: 'isolated-concurrency-test', imageKey: ''});
  const server = await new Promise(resolve => {const server = app.listen(0, '127.0.0.1', () => resolve(server));});
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {await new Promise(resolve => server.close(resolve)); store.close(); rmSync(directory, {recursive: true, force: true});});
  const cookies = {};
  for (const role of ['owner', 'manager']) {
    const response = await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({role, password: role + '-secret'})});
    assert.equal(response.status, 200);
    cookies[role] = response.headers.get('set-cookie').split(';')[0];
  }
  const request = (path, role = 'manager', method = 'GET', body) => fetch(base + path, {method, headers: {Cookie: cookies[role], ...(body === undefined ? {} : {'Content-Type': 'application/json'})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const record = async (collection, id, role = 'manager') => {
    const response = await request('/api/' + collection, role);
    assert.equal(response.status, 200);
    return (await response.json()).find(item => item.id === id);
  };
  return {store, request, record};
}

test('a stale manager checklist cannot undo another saved task or create an owner update', async t => {
  const {store, request, record} = await workspace(t);
  const baseline = await record('jobs', 'job');
  assert.equal(baseline.budget, undefined);
  assert.equal(baseline.privateNote, undefined);
  assert.equal(baseline.tasks[0].cost, undefined);
  const first = await request('/api/jobs/job', 'manager', 'PATCH', {_expected: baseline, tasks: baseline.tasks.map(task => ({...task, done: task.id === 'water'}))});
  assert.equal(first.status, 200, await first.text());
  const afterFirst = store.get('jobs', 'job');
  const activityAfterFirst = store.activityFeed();
  assert.equal(activityAfterFirst.items.length, 1);

  const stale = await request('/api/jobs/job', 'manager', 'PATCH', {_expected: baseline, tasks: baseline.tasks.map(task => ({...task, done: task.id === 'prune'}))});
  assert.equal(stale.status, 409, await stale.text());
  assert.deepEqual(store.get('jobs', 'job'), afterFirst);
  assert.deepEqual(store.activityFeed(), activityAfterFirst);

  const current = await record('jobs', 'job');
  const accepted = await request('/api/jobs/job', 'manager', 'PATCH', {_expected: current, tasks: current.tasks.map(task => ({...task, done: true}))});
  assert.equal(accepted.status, 200, await accepted.text());
  assert.ok(store.get('jobs', 'job').tasks.every(task => task.done));
  assert.equal(store.get('jobs', 'job').tasks[0].cost, 25);
  assert.equal(store.get('jobs', 'job').privateNote, 'OWNER_PRIVATE_DETAILS');
  assert.equal(store.get('jobs', 'job')._expected, undefined);
  assert.equal(store.activityFeed().items.length, 2);
});

test('an old owner inventory form cannot restore stock already used by a manager', async t => {
  const {store, request, record} = await workspace(t);
  const openedItem = await record('inventory', 'plants', 'owner');
  assert.equal(openedItem.cost, undefined);
  const used = await request('/api/inventory/plants/use', 'manager', 'POST', {quantity: 5, jobId: 'job'});
  assert.equal(used.status, 200, await used.text());
  assert.equal(store.get('inventory', 'plants').quantity, 15);
  const movements = store.list('stockMovements');
  const events = store.activityFeed();
  const stale = await request('/api/inventory/plants', 'owner', 'PATCH', {_expected: openedItem, name: 'Peace lilies renamed', quantity: openedItem.quantity});
  assert.equal(stale.status, 409, await stale.text());
  assert.equal(store.get('inventory', 'plants').quantity, 15);
  assert.equal(store.get('inventory', 'plants').name, 'Peace lilies');
  assert.deepEqual(store.list('stockMovements'), movements);
  assert.deepEqual(store.activityFeed(), events);

  const current = await record('inventory', 'plants', 'owner');
  const accepted = await request('/api/inventory/plants', 'owner', 'PATCH', {_expected: current, name: 'Peace lilies renamed', quantity: 14});
  assert.equal(accepted.status, 200, await accepted.text());
  assert.equal(store.get('inventory', 'plants').quantity, 14);
  assert.equal(store.get('inventory', 'plants').cost, 45);
  assert.equal(store.list('stockMovements').length, 2);
  assert.equal(store.list('stockMovements')[1].change, -1);
  assert.deepEqual(store.activityFeed(), events, 'The owner edit does not impersonate manager activity.');
});

test('malformed edit baselines are rejected before mutation and optional legacy writes remain compatible', async t => {
  const {store, request} = await workspace(t);
  const original = store.get('jobs', 'job');
  for (const value of [null, [], 'old-record', 42, false, {}, {id: 'another-job'}]) {
    const response = await request('/api/jobs/job', 'manager', 'PATCH', {_expected: value, notes: 'Must not be saved'});
    assert.equal(response.status, 400, await response.text());
    assert.deepEqual(store.get('jobs', 'job'), original);
  }
  assert.equal(store.activityFeed().items.length, 0);
  const legacy = await request('/api/jobs/job', 'manager', 'PATCH', {notes: 'Compatible operational update'});
  assert.equal(legacy.status, 200, await legacy.text());
  assert.equal(store.get('jobs', 'job').notes, 'Compatible operational update');
});
