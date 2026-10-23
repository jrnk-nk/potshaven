import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from './store.js';
import {createApp} from './app.js';

const visit = (id, notes = id) => ({id, date: '2026-10-23', plantHealth: 'Healthy', irrigation: 'Working', notes, photos: []});
async function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-site-visits-'));
  const store = createStore(':memory:', {seed: false});
  store.put('places', {id: 'site', name: 'Hotel garden', inspections: []});
  const app = createApp({store, dataDir: directory, serveClient: false, ownerPassword: 'owner-secret', managerPassword: 'manager-secret', sessionSecret: 'visits-test-secret'});
  const server = await new Promise(resolve => {const server = app.listen(0, '127.0.0.1', () => resolve(server));});
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {await new Promise(resolve => server.close(resolve)); store.close(); rmSync(directory, {recursive: true, force: true});});
  const cookies = {};
  for (const role of ['owner', 'manager']) {
    const response = await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({role, password: role + '-secret'})});
    assert.equal(response.status, 200);
    cookies[role] = response.headers.get('set-cookie').split(';')[0];
  }
  const save = (role, body) => fetch(base + '/api/places/site', {method: 'PATCH', headers: {'Content-Type': 'application/json', ...(cookies[role] ? {Cookie: cookies[role]} : {})}, body: JSON.stringify(body)});
  return {store, save};
}

test('stale full-history saves cannot erase visits recorded by another session', async t => {
  const {save, store} = await setup(t);
  assert.equal((await save('manager', {inspections: [visit('first')]})).status, 200);
  for (const role of ['owner', 'manager']) {
    assert.equal((await save(role, {inspections: [visit('stale')]})).status, 409);
    assert.equal((await save(role, {inspections: []})).status, 409);
    assert.deepEqual(store.get('places', 'site').inspections.map(entry => entry.id), ['first']);
  }
});

test('simultaneous visit appends retain both visits and emit one event per manager save', async t => {
  const {save, store} = await setup(t);
  const update = store.update.bind(store);
  let calls = 0, release;
  const bothReady = new Promise(resolve => {release = resolve;});
  store.update = async (...args) => {
    calls++;
    if (calls === 2) release();
    if (calls <= 2) await bothReady;
    return update(...args);
  };
  const responses = await Promise.all([save('owner', {inspection: visit('owner-visit')}), save('manager', {inspection: visit('manager-visit')})]);
  for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
  assert.equal(calls, 3, 'The conflicting append retries once after a confirmed compare-and-swap rejection.');
  const site = store.get('places', 'site');
  assert.deepEqual(site.inspections.map(entry => entry.id).sort(), ['manager-visit', 'owner-visit']);
  assert.equal(site.inspection, undefined);
  assert.equal(store.activityFeed().items.length, 1);
  assert.equal(store.activityFeed().items[0].action, 'visit_recorded');
});

test('visit retry is idempotent after a committed write loses its response', async t => {
  const {save, store} = await setup(t);
  const update = store.update.bind(store);
  let calls = 0;
  store.update = (...args) => {
    calls++;
    update(...args);
    throw Object.assign(new Error('Connection closed after commit'), {code: 'ECONNRESET'});
  };
  const entry = visit('stable-visit');
  assert.equal((await save('manager', {inspection: entry})).status, 503);
  assert.equal(calls, 1, 'An ambiguous write must never be automatically replayed.');
  assert.equal(store.get('places', 'site').inspections.length, 1);
  assert.equal(store.activityFeed().items.length, 1);
  assert.equal((await save('manager', {inspection: entry})).status, 200);
  assert.equal(calls, 1, 'An explicit retry of the same stable ID finds the saved visit.');
  assert.equal(store.activityFeed().items.length, 1);
  assert.equal((await save('manager', {inspection: visit('stable-visit', 'Different visit')})).status, 409);
});

test('visit append validates operational fields and preserves hidden historical metadata', async t => {
  const {save, store} = await setup(t);
  store.update('places', 'site', {inspections: [{...visit('old'), privateCost: 620, details: {cost: 30}}]});
  const before = store.get('places', 'site');
  assert.equal((await save('anonymous', {inspection: visit('new')})).status, 401);
  for (const role of ['owner', 'manager']) {
    for (const entry of [{...visit('new'), privateCost: 30}, {...visit('new'), notes: {amount: 20}}]) assert.equal((await save(role, {inspection: entry})).status, 403);
    for (const entry of [{...visit('new'), id: ''}, {...visit('new'), date: '2026-02-30'}, {...visit('new'), photos: ['a', 'b', 'c', 'd', 'e']}]) assert.equal((await save(role, {inspection: entry})).status, 400);
    assert.equal((await save(role, {inspection: visit('new'), name: 'Also change site'})).status, 400);
  }
  assert.deepEqual(store.get('places', 'site'), before);
  const response = await save('manager', {inspection: visit('new')});
  assert.equal(response.status, 200);
  const visible = await response.json();
  assert.deepEqual(visible.inspections.map(entry => entry.id), ['new', 'old']);
  assert.equal(visible.inspections[1].privateCost, undefined);
  assert.deepEqual(store.get('places', 'site').inspections[1], before.inspections[0]);
});
