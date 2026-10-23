import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from './store.js';
import {createApp} from './app.js';
import {FINANCIAL_FEATURES_ENABLED} from '../src/features.js';
import {isFinancialField, preserveFinancialMetadata} from './financial-access.js';

const today = '2026-10-23';
async function workspace(t, provider) {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-finance-off-'));
  const store = createStore(':memory:', {seed: false});
  store.updateSettings({companyName: 'PotsHaven', currency: 'GHS'});
  const records = {
    places: [{id: 'site', name: 'Hotel garden', inspections: [{id: 'visit', date: today, notes: 'Healthy', privateCost: 90401}]}],
    jobs: [{id: 'job', title: 'Water the garden', type: 'Maintenance', date: today, status: 'Scheduled', crewIds: [], placeId: 'site', budget: 90402, tasks: [{id: 'water', text: 'Water pots', done: false, details: {cost: 90403, source: 'Nursery'}}]}],
    inventory: [{id: 'palm', name: 'Palm', category: 'Plants', quantity: 20, minStock: 2, cost: 90404}],
    workers: [{id: 'ama', name: 'Ama', available: true, skills: [], agreedRate: 90405, rateBasis: 'Daily', agreementNotes: 'LEGACY_PRIVATE_PAY_TERMS'}],
    vehicles: [{id: 'van', name: 'Crew van', status: 'Available', purchaseCost: 90406}],
    contracts: [{id: 'agreement', title: 'Hotel maintenance', status: 'Active', renewalDate: today, amount: 90407}],
    payments: [{id: 'paid', description: 'LEGACY_PRIVATE_PAYMENT', amount: 90408}],
    expenses: [{id: 'expense', description: 'LEGACY_PRIVATE_EXPENSE', amount: 90409}],
    purchaseRequests: [{id: 'supply', title: 'Extra pots', quantity: 2, estimatedCost: 90410, receiptReference: 'LEGACY_RECEIPT', requestType: 'Restock', status: 'Pending', requestedBy: 'manager'}, {id: 'receipt', title: 'LEGACY_PRIVATE_RECEIPT', requestType: 'Receipt', estimatedCost: 90411, status: 'Pending', requestedBy: 'manager'}],
  };
  for (const [collection, items] of Object.entries(records)) for (const record of items) store.put(collection, record);
  const app = createApp({store, dataDir: directory, serveClient: false, ownerPassword: 'owner-secret', managerPassword: 'manager-secret', sessionSecret: 'financial-test-secret', imageKey: 'test-key', fetchAssistant: provider});
  const server = await new Promise(resolve => {const server = app.listen(0, '127.0.0.1', () => resolve(server));});
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {await new Promise(resolve => server.close(resolve)); store.close(); rmSync(directory, {recursive: true, force: true});});
  const cookies = {};
  for (const role of ['owner', 'manager']) {
    const response = await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({role, password: role + '-secret'})});
    assert.equal(response.status, 200);
    cookies[role] = response.headers.get('set-cookie').split(';')[0];
  }
  const request = (path, role = 'owner', method = 'GET', body) => fetch(base + path, {method, headers: {Cookie: cookies[role], ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
  return {request, store};
}

function assertNoMoney(value) {
  if (Array.isArray(value)) return value.forEach(assertNoMoney);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['payments', 'expenses'].includes(key)) {assert.deepEqual(child, []); continue;}
    assert.equal(isFinancialField(key), false, `Financial field leaked: ${key}`);
    assertNoMoney(child);
  }
}

test('financial features are off for both roles without modifying saved financial records', async t => {
  assert.equal(FINANCIAL_FEATURES_ENABLED, false);
  const {request, store} = await workspace(t);
  const before = store.state();
  for (const role of ['owner', 'manager']) {
    const response = await request('/api/state', role);
    assert.equal(response.status, 200);
    const state = await response.json();
    assertNoMoney(state);
    assert.deepEqual(state.payments, []);
    assert.deepEqual(state.expenses, []);
    assert.deepEqual(state.purchaseRequests.map(item => item.id), ['supply']);
    assert.ok(!JSON.stringify(state).includes('LEGACY_PRIVATE_RECEIPT'));
    assert.ok(!JSON.stringify(state).includes('LEGACY_RECEIPT'));
    for (let value = 90401; value <= 90411; value++) assert.ok(!JSON.stringify(state).includes(String(value)));
    for (const collection of ['payments', 'expenses']) assert.equal((await request('/api/' + collection, role)).status, 403);
    const briefing = await (await request('/api/assistant/briefing?today=' + today, role)).json();
    assert.ok(briefing.items.some(item => item.kind === 'unassigned'));
    assert.ok(!briefing.items.some(item => item.kind === 'contract' || item.page === 'business'));
  }
  const contracts = await (await request('/api/contracts')).json();
  assert.equal(contracts[0].renewalDate, today);
  assert.equal(contracts[0].amount, undefined);
  assert.deepEqual(store.state(), before);
});

test('operational owner and manager edits preserve hidden amounts and nested metadata', async t => {
  const {request, store} = await workspace(t);
  for (const role of ['owner', 'manager']) {
    const response = await request('/api/jobs/job', role, 'PATCH', {tasks: [{id: 'water', text: 'Water pots', done: role === 'manager'}]});
    assert.equal(response.status, 200, await response.clone().text());
    assertNoMoney(await response.json());
    assert.deepEqual(store.get('jobs', 'job').tasks[0].details, {cost: 90403, source: 'Nursery'});
    assert.equal(store.get('jobs', 'job').budget, 90402);
    assert.equal((await request('/api/workers/ama', role, 'PATCH', {available: false})).status, 200);
    assert.equal(store.get('workers', 'ama').agreedRate, 90405);
    assert.equal((await request('/api/purchaseRequests/supply', role, 'PATCH', {notes: 'Bring to the hotel.'})).status, 200);
    assert.equal(store.get('purchaseRequests', 'supply').estimatedCost, 90410);
    assert.equal(store.get('purchaseRequests', 'supply').receiptReference, 'LEGACY_RECEIPT');
  }
  const used = await request('/api/inventory/palm/use', 'owner', 'POST', {quantity: 3, jobId: 'job'});
  assert.equal(used.status, 200);
  const result = await used.json();
  assertNoMoney(result);
  assert.equal(result.item.quantity, 17);
  assert.equal(store.get('inventory', 'palm').cost, 90404);
  assert.equal(store.list('stockMovements')[0].totalCost, 3 * 90404);
  assertNoMoney(await (await request('/api/stockMovements')).json());
  const settings = await request('/api/settings', 'owner', 'PATCH', {tagline: 'Brighten your world'});
  assert.equal(settings.status, 200);
  assertNoMoney(await settings.json());
  assert.equal(store.settings().currency, 'GHS');
});

test('financial writes and receipt mutations are rejected for both roles without data loss', async t => {
  const {request, store} = await workspace(t);
  const before = store.state();
  const denied = [
    ['/api/payments', 'POST', {description: 'New payment'}],
    ['/api/payments/paid', 'DELETE'],
    ['/api/expenses/expense', 'PATCH', {description: 'Changed'}],
    ['/api/inventory/palm', 'PATCH', {cost: 1}],
    ['/api/inventory/palm/use', 'POST', {quantity: 1, jobId: 'job', unitCost: 1}],
    ['/api/jobs/job', 'PATCH', {budget: 1}],
    ['/api/jobs/job', 'PATCH', {tasks: [{id: 'water', text: 'Water pots', done: true, details: {cost: 1}}]}],
    ['/api/workers/ama', 'PATCH', {agreedRate: 1}],
    ['/api/workers/ama', 'PATCH', {rateBasis: 'Weekly'}],
    ['/api/purchaseRequests/supply', 'PATCH', {estimatedCost: 1}],
    ['/api/purchaseRequests/supply', 'PATCH', {receiptReference: 'new receipt'}],
    ['/api/purchaseRequests', 'POST', {title: 'New receipt', requestType: 'Receipt'}],
    ['/api/purchaseRequests/receipt', 'PATCH', {notes: 'Changed receipt'}],
    ['/api/purchaseRequests/receipt', 'DELETE'],
    ['/api/settings', 'PATCH', {currency: 'USD'}],
  ];
  for (const role of ['owner', 'manager']) for (const [path, method, body] of denied) {
    assert.equal((await request(path, role, method, body)).status, 403, `${role}: ${method} ${path}`);
    assert.deepEqual(store.state(), before);
  }
  const removed = await request('/api/jobs/job', 'owner', 'PATCH', {tasks: []});
  assert.equal(removed.status, 409);
  assert.deepEqual(store.state(), before);
});

test('owner assistant excludes saved money and cannot return financial change proposals', async t => {
  let seen, proposal = {collection: 'workers', operation: 'update', recordId: 'ama', changesJson: JSON.stringify({available: false})};
  const {request, store} = await workspace(t, async (url, options) => {
    const payload = JSON.parse(options.body);
    seen = {instructions: payload.instructions, snapshot: JSON.parse(payload.input[0].content.split('\n').slice(1).join('\n'))};
    return {ok: true, json: async () => ({output_text: JSON.stringify({reply: 'Review this change.', actions: [proposal]})})};
  });
  const before = store.state();
  const body = {today, message: 'Prepare the requested change'};
  assert.equal((await request('/api/assistant', 'owner', 'POST', body)).status, 200);
  assertNoMoney(seen.snapshot);
  assert.deepEqual(seen.snapshot.contracts, []);
  assert.ok(!JSON.stringify(seen.snapshot).includes('LEGACY_PRIVATE_PAY_TERMS'));
  assert.ok(!seen.snapshot.workers[0].editableFields.includes('agreementNotes'));
  assert.match(seen.instructions, /Money features are temporarily unavailable for every role/);
  for (const [collection, recordId, changes] of [['workers', 'ama', {agreedRate: 1}], ['workers', 'ama', {rateBasis: 'Weekly'}], ['jobs', 'job', {budget: 1}], ['jobs', 'job', {tasks: [{text: 'Water pots', done: true, cost: 1}]}]]) {
    proposal = {collection, operation: 'update', recordId, changesJson: JSON.stringify(changes)};
    assert.equal((await request('/api/assistant', 'owner', 'POST', body)).status, 403);
    assert.deepEqual(store.state(), before);
  }
});

test('nested financial metadata is preserved or an ambiguous destructive edit is rejected', () => {
  const previous = {tasks: [{id: 'task', text: 'Water pots', done: false, details: {cost: 123, source: 'nursery'}}]};
  const patch = {tasks: [{id: 'task', text: 'Water pots', done: true}]};
  const saved = preserveFinancialMetadata(patch, previous);
  assert.deepEqual(saved.tasks[0].details, previous.tasks[0].details);
  assert.equal(saved.tasks[0].done, true);
  assert.throws(() => preserveFinancialMetadata({tasks: []}, previous), error => error.status === 409);
  assert.throws(() => preserveFinancialMetadata({tasks: [{id: 'different', done: true}]}, previous), error => error.status === 409);
  assert.throws(() => preserveFinancialMetadata({tasks: [{id: 'task', details: null}]}, previous), error => error.status === 409);
  assert.throws(() => preserveFinancialMetadata({tasks: [{id: 'task'}, {id: 'task'}]}, previous), error => error.status === 409);
  assert.deepEqual(patch, {tasks: [{id: 'task', text: 'Water pots', done: true}]});
});
