import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import postgres from 'postgres';
import {PGlite} from '@electric-sql/pglite';
import {createStore} from './store.js';
import {createPostgresStore} from './postgres-store.js';
import {createApp} from './app.js';
import {managerActivity} from './activity.js';

async function fixture(t, backend) {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-activity-'));
  let database, driver, query;
  const stores = [];
  if (backend === 'postgres') {
    database = new PGlite();
    driver = postgres('postgresql://fixture:fixture@unused.invalid/fixture', {prepare: false});
    query = async (sql, parameters = []) => database.query(sql, parameters.map((value, index) => value !== null && new RegExp(`\\$${index + 1}::jsonb\\b`).test(sql) ? driver.options.serializers[3802](value) : value));
  }
  const reopen = async () => {
    const store = backend === 'postgres' ? await createPostgresStore('', {query}) : createStore(join(directory, 'workspace.db'), {seed: false});
    stores.push(store);
    return store;
  };
  const store = await reopen();
  t.after(async () => {
    for (const item of stores) await item.close();
    await driver?.end({timeout: 0});
    await database?.close();
    rmSync(directory, {recursive: true, force: true});
  });
  await store.put('places', {id: 'site', name: 'Hotel garden', privateNotes: 'PRIVATE_SITE_NOTES'});
  await store.put('inventory', {id: 'plants', name: 'Peace lilies', category: 'Plants', quantity: 8, unit: 'plants', cost: 9973});
  await store.put('jobs', {id: 'visit', title: 'Weekly garden care', type: 'Maintenance', status: 'Scheduled', date: '2026-10-23', placeId: 'site', crewIds: [], tasks: [{text: 'Water plants', done: false, privateCost: 9872}], recurrence: 'Weekly', budget: 9541});
  return {store, reopen, database, directory, query};
}

for (const backend of ['sqlite', 'postgres']) {
  test(`${backend} activity is private, ordered, contextual and durably acknowledged`, async t => {
    const {store, reopen, database} = await fixture(t, backend);
    const request = {id: 'request', title: 'Replacement pots', jobId: 'visit', requestedBy: 'manager', status: 'Pending', notes: 'PRIVATE_REQUEST_NOTES', estimatedCost: 9865};
    const created = await managerActivity(store, {role: 'manager', collection: 'purchaseRequests', operation: 'create', record: request});
    await store.put('purchaseRequests', request, {activity: {...created, estimatedCost: 9865, notes: 'PRIVATE_EVENT_NOTES', payload: request}});
    const before = await store.get('jobs', 'visit');
    const completed = await managerActivity(store, {role: 'manager', collection: 'jobs', operation: 'update', previous: before, record: {...before, status: 'Completed'}});
    await store.update('jobs', 'visit', {status: 'Completed'}, 'Manager', {expected: before, activity: completed});
    const feed = await store.activityFeed();
    assert.deepEqual(feed.items.map(item => item.action), ['completed', 'created']);
    assert.equal(feed.unreadCount, 2);
    assert.ok(feed.items.every(item => item.actor === 'Manager account' && item.siteId === 'site' && item.siteName === 'Hotel garden' && item.readAt === null));
    assert.equal(feed.items[0].title, 'Weekly garden care');
    assert.equal(feed.items[1].jobId, 'visit');
    assert.ok(!JSON.stringify(feed).includes('PRIVATE_'));
    for (const name of ['budget', 'cost', 'estimatedCost', 'notes', 'payload', 'privateCost']) assert.ok(!JSON.stringify(feed).includes(`"${name}"`));
    const limited = await store.activityFeed(1);
    assert.equal(limited.items.length, 1);
    assert.equal(limited.unreadCount, 2, 'The badge counts unread events beyond the displayed page.');
    const firstRead = await store.readActivity(completed.id);
    assert.match(firstRead.readAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal((await store.readActivity(completed.id)).readAt, firstRead.readAt);
    assert.equal((await store.activityFeed()).unreadCount, 1);
    await store.readAllActivity();
    const reopened = await reopen();
    const saved = await reopened.activityFeed();
    assert.equal(saved.unreadCount, 0);
    assert.ok(saved.items.every(item => typeof item.readAt === 'string'));
    await reopened.readAllActivity();
    assert.deepEqual((await reopened.activityFeed()).items, saved.items, 'Repeated acknowledgements retain the first read time.');
    assert.equal((await reopened.state()).activity, undefined, 'Activity is not a generic workspace collection.');
    assert.equal(await managerActivity(store, {role: 'owner', collection: 'jobs', operation: 'update', record: before}), undefined);
    assert.equal(await managerActivity(store, {role: 'manager', collection: 'jobs', operation: 'update', record: before, previous: before}), undefined);
    if (database) {
      await database.exec('CREATE ROLE activity_anon');
      const result = await database.query("SELECT has_table_privilege('activity_anon', 'potshaven_private.activity', 'SELECT') AS allowed");
      assert.equal(result.rows[0].allowed, false);
    }
  });

  test(`${backend} activity and create, completion, stock deduction commit or roll back together`, async t => {
    const {store} = await fixture(t, backend);
    const initial = {id: 'first', name: 'First site'};
    const event = await managerActivity(store, {role: 'manager', collection: 'places', operation: 'create', record: initial});
    await store.put('places', initial, {activity: event});
    // Force a ledger insertion failure after the business mutation has run.
    await assert.rejects(async () => store.put('places', {id: 'second', name: 'Must roll back'}, {activity: event}));
    assert.equal(await store.get('places', 'second'), undefined);
    const visit = await store.get('jobs', 'visit');
    const beforeJobs = await store.list('jobs');
    await assert.rejects(async () => store.update('jobs', 'visit', {status: 'Completed'}, 'Manager', {expected: {...visit, notes: 'stale snapshot'}, activity: {...event, id: 'stale-event'}}), error => error.status === 409);
    assert.equal((await store.activityFeed()).items.length, 1, 'A stale manager edit cannot record work that was never saved.');
    await assert.rejects(async () => store.update('jobs', 'visit', {status: 'Completed'}, 'Manager', {expected: visit, activity: event}));
    assert.deepEqual(await store.list('jobs'), beforeJobs, 'Completion and its recurring follow-up both roll back if the inbox cannot be recorded.');
    await assert.rejects(async () => store.stock('plants', 3, {jobId: 'visit', actor: 'Manager', activity: event}));
    assert.equal((await store.get('inventory', 'plants')).quantity, 8);
    assert.equal((await store.list('stockMovements')).length, 0);
    const stockEvent = await managerActivity(store, {role: 'manager', collection: 'inventory', operation: 'use', record: await store.get('inventory', 'plants'), quantity: 3, jobId: 'visit'});
    await store.stock('plants', 3, {jobId: 'visit', actor: 'Manager', activity: stockEvent});
    assert.equal((await store.get('inventory', 'plants')).quantity, 5);
    assert.equal((await store.list('stockMovements')).length, 1);
    const feed = await store.activityFeed();
    assert.equal(feed.items.length, 2);
    assert.equal(feed.items[0].action, 'stock_used');
    assert.equal(feed.items[0].quantity, 3);
    assert.equal(feed.items[0].unit, 'plants');
    assert.equal(feed.items[0].siteName, 'Hotel garden');
    await assert.rejects(async () => store.stock('plants', 100, {jobId: 'visit', activity: {...stockEvent, id: 'failed-stock'}}));
    assert.equal((await store.activityFeed()).items.length, 2, 'A rejected save never creates an owner notification.');
  });
}

test('owner activity API reports manager work, rejects other readers, and does not duplicate no-op completion', async t => {
  const {store, directory} = await fixture(t, 'sqlite');
  await store.put('workers', {id: 'worker', name: 'Ama', available: true});
  await store.put('vehicles', {id: 'van', name: 'Garden van', status: 'Available'});
  const app = createApp({store, dataDir: directory, serveClient: false, ownerPassword: 'activity-owner', managerPassword: 'activity-manager', sessionSecret: 'isolated-activity-test', imageKey: ''});
  const server = await new Promise(resolve => {const server = app.listen(0, '127.0.0.1', () => resolve(server));});
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookies = {};
  for (const role of ['owner', 'manager']) {
    const response = await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({role, password: 'activity-' + role})});
    assert.equal(response.status, 200);
    cookies[role] = response.headers.get('set-cookie').split(';')[0];
  }
  const request = (path, role = 'owner', method = 'GET', body) => fetch(base + path, {method, headers: {Cookie: cookies[role], ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
  assert.equal((await fetch(base + '/api/activity')).status, 401);
  assert.equal((await request('/api/activity', 'manager')).status, 403);
  assert.equal((await request('/api/activity/read-all', 'manager', 'POST')).status, 403);
  assert.equal((await request('/api/activity/unknown/read', 'manager', 'POST')).status, 403);
  assert.equal((await request('/api/activity?limit=101')).status, 400);
  const writes = [
    ['/api/purchaseRequests', 'POST', {title: 'More planters', jobId: 'visit', quantity: 4}],
    ['/api/jobs/visit', 'PATCH', {crewIds: ['worker'], vehicleId: 'van'}],
    ['/api/jobs/visit', 'PATCH', {tasks: [{text: 'Water plants', done: true}]}],
    ['/api/places/site', 'PATCH', {inspections: [{id: 'visit-notes', date: '2026-10-23', notes: 'PRIVATE_INSPECTION_NOTES'}]}],
    ['/api/workers/worker', 'PATCH', {available: false}],
    ['/api/vehicles/van', 'PATCH', {status: 'Servicing'}],
    ['/api/inventory/plants/use', 'POST', {quantity: 1, jobId: 'visit'}],
    ['/api/jobs/visit', 'PATCH', {status: 'Completed'}],
  ];
  for (const [path, method, body] of writes) {
    const response = await request(path, 'manager', method, body);
    assert.ok(response.ok, `${path} failed: ${response.status} ${await response.text()}`);
  }
  let response = await request('/api/activity');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  let feed = await response.json();
  assert.equal(feed.items.length, writes.length);
  assert.equal(feed.unreadCount, writes.length);
  for (const action of ['created', 'assigned', 'visit_recorded', 'stock_used', 'completed']) assert.ok(feed.items.some(item => item.action === action));
  assert.ok(feed.items.every(item => item.actor === 'Manager account'));
  assert.ok(!JSON.stringify(feed).includes('PRIVATE_'));
  assert.equal((await request('/api/jobs/visit', 'manager', 'PATCH', {status: 'Completed'})).status, 200);
  assert.equal((await request('/api/jobs/visit', 'owner', 'PATCH', {notes: 'Owner note'})).status, 200);
  assert.equal((await request('/api/inventory/plants/use', 'manager', 'POST', {quantity: 100, jobId: 'visit'})).status, 409);
  feed = await (await request('/api/activity')).json();
  assert.equal(feed.items.length, writes.length, 'Owner saves, rejected requests and unchanged completion do not invent manager actions.');
  const id = feed.items[0].id;
  const first = await (await request(`/api/activity/${id}/read`, 'owner', 'POST')).json();
  const second = await (await request(`/api/activity/${id}/read`, 'owner', 'POST')).json();
  assert.equal(first.item.readAt, second.item.readAt);
  assert.equal((await request('/api/activity/absent/read', 'owner', 'POST')).status, 404);
  assert.equal((await request('/api/activity/read-all', 'owner', 'POST')).status, 200);
  assert.equal((await (await request('/api/activity')).json()).unreadCount, 0);
});

test('an interrupted PostgreSQL stock response never repeats its committed activity or stock movement', async t => {
  const {store, query} = await fixture(t, 'postgres');
  const event = await managerActivity(store, {role: 'manager', collection: 'inventory', operation: 'use', record: await store.get('inventory', 'plants'), quantity: 2, jobId: 'visit'});
  let armed = false, writes = 0;
  const unstable = await createPostgresStore('', {query: async (sql, parameters) => {
    const result = await query(sql, parameters);
    if (armed && sql.startsWith('SELECT potshaven_private.stock(')) {writes++; throw Object.assign(new Error('Response interrupted after commit'), {code: 'CONNECTION_CLOSED'});}
    return result;
  }});
  armed = true;
  await assert.rejects(unstable.stock('plants', 2, {jobId: 'visit', actor: 'Manager', activity: event}), error => error.code === 'CONNECTION_CLOSED');
  assert.equal(writes, 1);
  assert.equal((await store.get('inventory', 'plants')).quantity, 6);
  assert.equal((await store.list('stockMovements')).length, 1);
  assert.equal((await store.activityFeed()).items.length, 1);
});

test('PostgreSQL upgrades version two in place while keeping old mutation signatures usable', async t => {
  const {store, database, query, reopen} = await fixture(t, 'postgres');
  const records = await store.state();
  const secret = await store.getSessionSecret();
  await database.exec(`
    DROP FUNCTION potshaven_private.update_record(text,text,jsonb,text,text,text,text,jsonb,jsonb);
    DROP FUNCTION potshaven_private.stock(text,numeric,text,text,text,text,text,text,jsonb);
    DROP TABLE potshaven_private.activity;
    UPDATE potshaven_private.metadata SET value='"2"'::jsonb WHERE key='schemaVersion';
  `);
  const upgraded = await reopen();
  assert.deepEqual(await upgraded.state(), records);
  assert.equal(await upgraded.getSessionSecret(), secret);
  assert.equal((await query("SELECT value FROM potshaven_private.metadata WHERE key='schemaVersion'")).rows[0].value, '4');
  assert.deepEqual(await upgraded.activityFeed(), {items: [], unreadCount: 0});
  const event = await managerActivity(upgraded, {role: 'manager', collection: 'inventory', operation: 'use', record: await upgraded.get('inventory', 'plants'), quantity: 1, jobId: 'visit'});
  await upgraded.stock('plants', 1, {jobId: 'visit', activity: event});
  // A previous deployment still using the eight-argument function can finish safely.
  await query('SELECT potshaven_private.stock($1, $2::numeric, $3, $4, $5, $6, $7, $8) AS data', ['plants', 1, 'use', 'visit', '', 'Owner', 'old-deployment-movement', new Date().toISOString()]);
  assert.equal((await upgraded.get('inventory', 'plants')).quantity, 6);
  assert.equal((await upgraded.list('stockMovements')).length, 2);
  assert.equal((await upgraded.activityFeed()).items.length, 1);
});
