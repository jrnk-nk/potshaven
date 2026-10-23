import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStore} from './store.js';
import {createApp} from './app.js';

const today = '2026-10-23';
const answer = (actions = [], reply = 'Review this operational change before saving.') => ({output_text: JSON.stringify({reply, actions})});
const action = (collection, operation, changes, recordId = null) => ({collection, operation, changesJson: JSON.stringify(changes), recordId});

async function setup(t, provider) {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-assistant-access-'));
  const store = createStore(':memory:', {seed: false});
  for (const [collection, records] of Object.entries({
    places: [{id: 'hotel', name: 'Hotel garden', privateNotes: 'OWNER_PRIVATE_CLIENT_TERMS', notes: 'Bring watering tools.'}],
    workers: [{id: 'ama', name: 'Ama', role: 'Gardener', available: true, skills: ['Pruning'], agreedRate: 99991, rateBasis: 'Daily', agreementNotes: 'OWNER_PRIVATE_PAY_TERMS', agreementReference: 'OWNER_PRIVATE_AGREEMENT'}],
    vehicles: [{id: 'van', name: 'Crew van', status: 'Available', purchaseCost: 99992}],
    jobs: [{id: 'care', title: 'Garden care', placeId: 'hotel', date: today, type: 'Maintenance', status: 'Scheduled', crewIds: [], tasks: [], budget: 99993}],
    inventory: [{id: 'palm', name: 'Palm', category: 'Plants', quantity: 2, minStock: 5, cost: 99994}],
    contracts: [{id: 'contract', title: 'OWNER_PRIVATE_CONTRACT', status: 'Active', renewalDate: today}],
    payments: [{id: 'payment', description: 'OWNER_PRIVATE_PAYMENT', amount: 99995, status: 'Paid'}],
    expenses: [{id: 'expense', description: 'OWNER_PRIVATE_EXPENSE', amount: 99996}],
    designs: [{id: 'design', title: 'OWNER_PRIVATE_DESIGN', prompt: 'OWNER_PRIVATE_PROMPT', image: '/images/place-1.svg', source: 'Design studio'}],
  })) for (const record of records) store.put(collection, record);
  const app = createApp({store, dataDir: directory, serveClient: false, ownerPassword: 'owner-secret', managerPassword: 'manager-secret', imageKey: 'test-key-not-real', sessionSecret: 'assistant-access-test-secret', fetchAssistant: provider});
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {await new Promise(resolve => server.close(resolve)); store.close(); rmSync(directory, {recursive: true, force: true});});
  async function login(role) {
    const response = await fetch(`${base}/api/auth/login`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({role, password: `${role}-secret`})});
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  const manager = await login('manager'), owner = await login('owner');
  return {store, base, manager, owner, post: (cookie, body = {}) => fetch(`${base}/api/assistant`, {method: 'POST', headers: {'Content-Type': 'application/json', Cookie: cookie}, body: JSON.stringify({today, message: 'Prepare the requested change', ...body})})};
}

test('manager assistant and briefing use only permitted operational records', async t => {
  let seen;
  const {post, base, manager, store} = await setup(t, async (url, request) => {
    const payload = JSON.parse(request.body);
    seen = {instructions: payload.instructions, snapshot: JSON.parse(payload.input[0].content.split('\n').slice(1).join('\n'))};
    return {ok: true, json: async () => answer()};
  });
  const before = store.state();
  assert.equal((await post(manager, {message: 'What needs attention?'})).status, 200);
  const snapshot = JSON.stringify(seen.snapshot);
  assert.match(snapshot, /Garden care/);
  assert.match(snapshot, /Palm/);
  assert.ok(!snapshot.includes('OWNER_PRIVATE_'));
  for (const amount of [99991, 99992, 99993, 99994, 99995, 99996]) assert.ok(!snapshot.includes(String(amount)), `private amount ${amount}`);
  assert.equal(seen.snapshot.role, 'manager');
  assert.deepEqual(seen.snapshot.workers[0].editableFields, ['available']);
  assert.equal(seen.snapshot.workers[0].skillsEditable, false);
  assert.deepEqual(seen.snapshot.contracts, []);
  assert.match(seen.instructions, /studio, gallery.*belong to the owner/i);
  const briefingResponse = await fetch(`${base}/api/assistant/briefing?today=${today}`, {headers: {Cookie: manager}});
  assert.equal(briefingResponse.status, 200);
  const briefing = await briefingResponse.json();
  assert.ok(briefing.items.some(item => item.kind === 'unassigned'));
  assert.ok(briefing.items.some(item => item.kind === 'stock'));
  assert.ok(!briefing.items.some(item => item.page === 'business'));
  assert.ok(!JSON.stringify(briefing).includes('OWNER_PRIVATE_'));
  assert.deepEqual(store.state(), before);
});

test('manager assistant cannot propose hiring, private terms, fleet creation or restricted job changes', async t => {
  let proposal;
  const {post, manager, store} = await setup(t, async () => ({ok: true, json: async () => answer([proposal])}));
  const before = store.state();
  for (const forbidden of [
    action('workers', 'create', {name: 'New hire', role: 'Gardener'}),
    action('workers', 'update', {agreedRate: 500}, 'ama'),
    action('workers', 'update', {skills: ['Driving']}, 'ama'),
    action('workers', 'update', {agreementStatus: 'Signed'}, 'ama'),
    action('vehicles', 'create', {name: 'New van'}),
    action('vehicles', 'update', {registration: 'NEW-REG'}, 'van'),
    action('jobs', 'create', {title: 'New contractual project', type: 'Project'}),
  ]) {
    proposal = forbidden;
    const response = await post(manager);
    assert.equal(response.status, 403, JSON.stringify(forbidden));
    assert.deepEqual(store.state(), before, 'Proposing changes never writes records.');
  }
});

test('manager assistant prepares existing crew/vehicle assignments and availability without writes', async t => {
  let next;
  const {post, manager, store} = await setup(t, async () => ({ok: true, json: async () => answer([next])}));
  const before = store.state();
  for (const requested of [
    action('jobs', 'update', {crewIds: ['ama'], vehicleId: 'van'}, 'care'),
    action('jobs', 'create', {title: 'Water the pots', placeId: 'hotel'}),
    action('workers', 'update', {available: false}, 'ama'),
    action('vehicles', 'update', {status: 'Servicing', notes: 'Tyres need checking.'}, 'van'),
    action('issues', 'create', {title: 'Inspect irrigation', placeId: 'hotel'}),
  ]) {
    next = requested;
    const response = await post(manager);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.actions.length, 1);
    assert.ok(!JSON.stringify(result).includes('OWNER_PRIVATE_'));
    assert.ok(!JSON.stringify(result).includes('99991'));
    assert.deepEqual(store.state(), before);
  }
});

test('owner assistant retains worker agreements and permitted hiring actions', async t => {
  let snapshot;
  const {post, owner} = await setup(t, async (url, request) => {
    const payload = JSON.parse(request.body);
    snapshot = JSON.parse(payload.input[0].content.split('\n').slice(1).join('\n'));
    return {ok: true, json: async () => answer([action('workers', 'create', {name: 'Kojo', role: 'Gardener'})])};
  });
  const response = await post(owner, {message: 'Prepare a new worker named Kojo, a gardener.'});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).actions[0].collection, 'workers');
  assert.equal(snapshot.workers[0].agreedRate, 99991);
  assert.equal(snapshot.workers[0].agreementNotes, 'OWNER_PRIVATE_PAY_TERMS');
  assert.equal(snapshot.contracts[0].title, 'OWNER_PRIVATE_CONTRACT');
});


test('manager assistant cannot erase hidden legacy checklist metadata through a filtered snapshot', async t => {
  let snapshot;
  const {post, manager, store} = await setup(t, async (url, request) => {
    snapshot = JSON.parse(JSON.parse(request.body).input[0].content.split('\n').slice(1).join('\n'));
    return {ok: true, json: async () => answer([action('jobs', 'update', {tasks: [{text: 'Photograph the beds', done: true}]}, 'care')])};
  });
  store.update('jobs', 'care', {tasks: [{text: 'Photograph the beds', done: false, privateProof: 'OWNER_PRIVATE_TASK_PROOF'}]});
  const before = store.state();
  const response = await post(manager, {message: 'Mark the photograph task done.'});
  assert.equal(response.status, 409);
  assert.equal(snapshot.jobs.find(job => job.id === 'care').tasksEditable, false);
  assert.ok(!JSON.stringify(snapshot).includes('OWNER_PRIVATE_TASK_PROOF'));
  assert.deepEqual(store.state(), before);
});
