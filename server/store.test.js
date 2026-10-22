import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, nextOccurrence } from './store.js';

function fixture(t) {
  const store = createStore(':memory:', { seed: false });
  t.after(() => store.close());
  store.put('inventory', { id: 'plant-1', name: 'Peace lily', category: 'Plants', quantity: 8, minStock: 2, cost: 75, unit: 'plants' });
  store.put('jobs', { id: 'job-1', title: 'Hotel planting', type: 'Project', status: 'Scheduled', crewIds: [], tasks: [] });
  return store;
}

test('using plants deducts stock, links the job and records the exact cost', t => {
  const store = fixture(t);
  const result = store.stock('plant-1', 3, { jobId: 'job-1', note: 'Entrance bed', actor: 'Manager' });
  assert.equal(result.item.quantity, 5);
  assert.equal(result.movement.jobId, 'job-1');
  assert.equal(result.movement.totalCost, 225);
  assert.equal(result.movement.actor, 'Manager');
  assert.equal(store.list('stockMovements').length, 1);
});

test('insufficient stock rolls back without changing the item or ledger', t => {
  const store = fixture(t);
  store.stock('plant-1', 6);
  assert.throws(() => store.stock('plant-1', 3), /Only 2 plants available/);
  assert.equal(store.get('inventory', 'plant-1').quantity, 2);
  assert.equal(store.list('stockMovements').length, 1);
});

test('zero, negative and nonnumeric quantities never alter stock', t => {
  const store = fixture(t);
  for (const quantity of [0, -1, '2', NaN, Infinity]) assert.throws(() => store.stock('plant-1', quantity));
  assert.equal(store.get('inventory', 'plant-1').quantity, 8);
  assert.equal(store.list('stockMovements').length, 0);
});

test('restocking and manual stock adjustments keep a ledger', t => {
  const store = fixture(t);
  assert.equal(store.stock('plant-1', 10, { type: 'restock' }).item.quantity, 18);
  store.update('inventory', 'plant-1', { quantity: 15 }, 'Owner');
  assert.equal(store.list('stockMovements')[1].type, 'adjustment');
  assert.equal(store.list('stockMovements')[1].change, -3);
  assert.equal(store.get('inventory', 'plant-1').quantity, 15);
});

test('records and settings persist after reopening the database', t => {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'test.db');
  let store = createStore(filename, { now: new Date('2026-10-22T12:00:00Z') });
  store.stock('plant-1', 2, { jobId: 'job-1' });
  store.updateSettings({ companyName: 'My Garden Company' });
  const expected = store.get('inventory', 'plant-1').quantity;
  store.close();
  store = createStore(filename);
  assert.equal(store.get('inventory', 'plant-1').quantity, expected);
  assert.equal(store.list('stockMovements').length, 1);
  assert.equal(store.settings().companyName, 'My Garden Company');
  assert.equal(store.list('places').length, 6);
  store.close();
});

test('linked inventory and places cannot be silently deleted', t => {
  const store = fixture(t);
  store.stock('plant-1', 1);
  assert.throws(() => store.remove('inventory', 'plant-1'), /used elsewhere/);
  assert.equal(store.get('inventory', 'plant-1').quantity, 7);
});

test('completing recurring maintenance schedules one clean follow-up, including on repeated completion', t => {
  const store = fixture(t);
  const scheduled = new Date();
  scheduled.setUTCDate(scheduled.getUTCDate() - 3);
  const deadline = new Date(scheduled);
  deadline.setUTCDate(deadline.getUTCDate() + 2);
  const date = scheduled.toISOString().slice(0, 10);
  store.put('jobs', { id: 'recurring-1', title: 'Weekly care', type: 'Maintenance', status: 'Scheduled', date, deadline: deadline.toISOString().slice(0, 10), recurrence: 'Weekly', placeId: 'place-1', crewIds: ['worker-1'], vehicleId: 'vehicle-1', tasks: [{ text: 'Water plants', done: true }], photos: ['example-photo'], budget: 800 });
  const completed = store.update('jobs', 'recurring-1', { status: 'Completed' });
  assert.ok(completed.nextJobId);
  const followUp = store.get('jobs', completed.nextJobId);
  assert.equal(followUp.previousJobId, 'recurring-1');
  assert.equal(followUp.status, 'Scheduled');
  assert.equal(followUp.placeId, 'place-1');
  assert.deepEqual(followUp.crewIds, ['worker-1']);
  assert.equal(followUp.vehicleId, 'vehicle-1');
  assert.deepEqual(followUp.tasks, [{ text: 'Water plants', done: false }]);
  assert.deepEqual(followUp.photos, []);
  assert.equal(new Date(followUp.deadline) - new Date(followUp.date), 2 * 86400000);
  assert.ok(followUp.date > new Date().toISOString().slice(0, 10));
  const count = store.list('jobs').length;
  store.update('jobs', 'recurring-1', { status: 'Completed' });
  store.update('jobs', 'recurring-1', { status: 'Scheduled' });
  store.update('jobs', 'recurring-1', { status: 'Completed' });
  assert.equal(store.list('jobs').length, count);
});

test('recurring dates skip overdue occurrences and clamp month ends without drifting', () => {
  assert.equal(nextOccurrence('2026-01-01', 'Weekly', new Date('2026-10-22T12:00:00Z')), '2026-10-29');
  assert.equal(nextOccurrence('2026-01-01', 'Fortnightly', new Date('2026-10-22T12:00:00Z')), '2026-11-05');
  assert.equal(nextOccurrence('2026-01-31', 'Monthly', new Date('2026-02-20T12:00:00Z')), '2026-02-28');
  assert.equal(nextOccurrence('2026-01-31', 'Monthly', new Date('2026-02-28T12:00:00Z')), '2026-03-31');
  assert.equal(nextOccurrence('2026-01-31', 'Quarterly', new Date('2026-02-28T12:00:00Z')), '2026-04-30');
});

test('invalid recurrence rolls back completion and creates no follow-up', t => {
  const store = fixture(t);
  store.put('jobs', { id: 'recurring-1', title: 'Weekly care', type: 'Maintenance', status: 'Scheduled', date: 'not-a-date', recurrence: 'Weekly', crewIds: [], tasks: [] });
  const count = store.list('jobs').length;
  assert.throws(() => store.update('jobs', 'recurring-1', { status: 'Completed' }), /valid scheduled date/);
  assert.equal(store.get('jobs', 'recurring-1').status, 'Scheduled');
  assert.equal(store.list('jobs').length, count);
});

test('owner name, accent colour and currency persist, while invalid settings are rejected', t => {
  const store = fixture(t);
  store.updateSettings({ ownerName: 'Mrs. Adjei', accentColor: '#315c43', currency: 'USD' });
  assert.equal(store.settings().ownerName, 'Mrs. Adjei');
  assert.equal(store.settings().accentColor, '#315c43');
  assert.equal(store.settings().currency, 'USD');
  assert.throws(() => store.updateSettings({ accentColor: 'url(https://example.com)' }), /accent colour/);
  assert.throws(() => store.updateSettings({ currency: 'INVALID' }), /ISO currency/);
  assert.equal(store.settings().accentColor, '#315c43');
  assert.equal(store.settings().currency, 'USD');
});

test('opting out of initial demo seed stays empty after future default restarts', t => {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-no-seed-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'company.db');
  let store = createStore(filename, { seed: false });
  assert.equal(store.list('places').length, 0);
  store.put('places', { id: 'real-place', name: 'Our first place' });
  store.close();
  store = createStore(filename);
  assert.equal(store.list('places').length, 1);
  assert.equal(store.get('places', 'real-place').name, 'Our first place');
  assert.equal(store.list('workers').length, 0);
  store.close();
});
