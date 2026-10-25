import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync, rmSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {PGlite} from '@electric-sql/pglite';
import {createPostgresStore} from './postgres-store.js';
import {createMediaStorage} from './media-storage.js';
import {createApp} from './app.js';

// This drill uses isolated embedded PostgreSQL and the real HTTP/authentication
// stack. It never contacts a provider or reads or mutates production records.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNI0AAAAASUVORK5CYII=', 'base64');
const picture = `data:image/png;base64,${png.toString('base64')}`;
const date = '2026-10-25';

test('a complete business handoff survives a cold app restart and an isolated database restore', {timeout: 90000}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-handoff-'));
  const database = new PGlite();
  const driver = postgres('postgresql://fixture:fixture@unused.invalid/fixture', {prepare: false});
  const databases = [database], stores = [], servers = [];
  t.after(async () => {
    for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve));
    for (const store of stores) await store.close();
    await driver.end({timeout: 0});
    for (const instance of databases) if (!instance.closed) await instance.close();
    rmSync(directory, {recursive: true, force: true});
  });
  const queryFor = instance => (sql, parameters = []) => instance.query(sql, parameters.map((value, index) => value !== null && new RegExp(`\\$${index + 1}::jsonb\\b`).test(sql) ? driver.options.serializers[3802](value) : value));
  const openStore = async instance => {
    const store = await createPostgresStore('', {query: queryFor(instance)});
    stores.push(store);
    return store;
  };
  await database.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  const store = await openStore(database);
  const passwords = {owner: randomBytes(24).toString('hex'), manager: randomBytes(24).toString('hex')};
  async function serve(store, passwords) {
    const app = createApp({
      store, dataDir: join(directory, randomUUID()), serveClient: false,
      ownerPassword: passwords.owner, managerPassword: passwords.manager,
      sessionSecret: await store.getSessionSecret(), mediaStorage: createMediaStorage(store), imageKey: '',
      fetchAssistant: () => {throw new Error('The handoff drill must never call the AI provider.');},
      fetchImage: () => {throw new Error('The handoff drill must never call the image provider.');},
    });
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const cookies = {};
    const request = (path, role = 'owner', method = 'GET', body) => fetch(base + path, {
      method, headers: {Origin: base, ...(cookies[role] ? {Cookie: cookies[role]} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    const json = async (path, role = 'owner', method = 'GET', body, expected = 200) => {
      const response = await request(path, role, method, body);
      const value = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
      return value;
    };
    const login = async role => {
      const response = await request('/api/auth/login', role, 'POST', {role, password: passwords[role]});
      assert.equal(response.status, 200);
      cookies[role] = response.headers.get('set-cookie').split(';')[0];
    };
    for (const role of ['owner', 'manager']) await login(role);
    return {server, base, request, json, cookies, login};
  }
  const app = await serve(store, passwords);
  const create = (collection, body, role = 'owner') => app.json(`/api/${collection}`, role, 'POST', body, 201);
  const state = role => app.json('/api/state', role);
  const patch = async (collection, id, body, role = 'manager') => {
    const baseline = (await state(role))[collection].find(record => record.id === id);
    return app.json(`/api/${collection}/${id}`, role, 'PATCH', {...body, _expected: baseline});
  };

  await app.json('/api/settings', 'owner', 'PATCH', {companyName: 'Handoff test company', tagline: 'Private isolated drill'});
  const site = await create('places', {name: 'Palm Court garden', address: 'Test site address', inspections: [], privateNotes: 'OWNER_PRIVATE_SITE_NOTE'});
  const worker = await create('workers', {name: 'Ama Mensah', role: 'Gardener', workforceType: 'External', engagementType: 'Weekly', engagementStart: date, engagementEnd: '2026-11-01', available: true, skills: ['Plant care'], agreementStatus: 'Signed', agreementReference: 'OWNER_PRIVATE_AGREEMENT_REFERENCE'});
  const vehicle = await create('vehicles', {name: 'Green pickup', registration: 'TEST-100', status: 'Available'});
  const stock = await create('inventory', {name: 'Peace lilies', quantity: 8, minStock: 2, category: 'Plants', unit: 'plants', image: picture});
  const job = await create('jobs', {title: 'Weekly entrance care', placeId: site.id, date, time: '08:00', status: 'Scheduled', type: 'Maintenance', recurrence: 'Weekly', crewIds: [], tasks: [{text: 'Replace two plants', done: false}, {text: 'Water and inspect irrigation', done: false}]});
  const ownerRequest = await create('purchaseRequests', {title: 'OWNER_PRIVATE_SUPPLY_PLAN', quantity: 1});
  const managerState = await state('manager');
  assert.equal(managerState.places[0].privateNotes, undefined);
  assert.equal(managerState.workers[0].agreementReference, undefined);
  assert.ok(!managerState.purchaseRequests.some(record => record.id === ownerRequest.id));
  for (const path of ['/api/activity', '/api/data-protection', '/api/designs']) assert.equal((await app.request(path, 'manager')).status, 403);
  assert.equal((await app.request('/api/settings', 'manager', 'PATCH', {companyName: 'Not allowed'})).status, 403);
  assert.equal((await app.request('/api/workers', 'manager', 'POST', {name: 'Unapproved worker'})).status, 403);

  const assigned = await patch('jobs', job.id, {crewIds: [worker.id], vehicleId: vehicle.id, status: 'In progress'});
  assert.deepEqual(assigned.crewIds, [worker.id]);
  assert.equal(assigned.vehicleId, vehicle.id);
  const visit = {id: randomUUID(), date, plantHealth: 'Healthy', irrigation: 'Working', workNeeded: 'Replace two plants', notes: 'Watered the entrance beds and checked irrigation.', photos: [picture]};
  const visited = await app.json(`/api/places/${site.id}`, 'manager', 'PATCH', {inspection: visit});
  const photoUrl = visited.inspections[0].photos[0];
  assert.match(photoUrl, /^\/media\/uploads\/[a-f0-9]{64}\.png$/);
  assert.equal(photoUrl, stock.image, 'Identical uploaded pictures reuse their durable private image.');
  const photo = await app.request(photoUrl, 'manager');
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);
  assert.equal((await app.request(photoUrl, 'anonymous')).status, 401);
  const used = await app.json(`/api/inventory/${stock.id}/use`, 'manager', 'POST', {quantity: 2, jobId: job.id, note: 'Used at the entrance beds'});
  assert.equal(used.item.quantity, 6);
  assert.equal(used.movement.jobId, job.id);
  assert.equal(used.movement.actor, 'Manager');
  const supply = await create('purchaseRequests', {title: 'Replacement planters', quantity: 2, placeId: site.id, jobId: job.id}, 'manager');
  assert.equal(supply.status, 'Pending');
  assert.equal(supply.requestedBy, 'manager');
  assert.equal((await app.request(`/api/purchaseRequests/${supply.id}`, 'manager', 'PATCH', {status: 'Approved'})).status, 403);
  const completed = await patch('jobs', job.id, {tasks: assigned.tasks.map(task => ({...task, done: true})), completionPhotos: [{url: photoUrl, caption: 'Entrance work complete'}], status: 'Completed'});
  assert.ok(completed.tasks.every(task => task.done));
  assert.equal(completed.status, 'Completed');
  assert.ok(completed.nextJobId, 'Recurring maintenance creates a follow-up during completion.');
  const afterWork = await state('owner');
  const followup = afterWork.jobs.find(record => record.id === completed.nextJobId);
  assert.equal(followup.previousJobId, job.id);
  assert.equal(followup.placeId, site.id);
  assert.equal(followup.status, 'Scheduled');
  assert.ok(followup.date > date);
  assert.ok(followup.tasks.every(task => !task.done));
  assert.equal(afterWork.stockMovements.length, 1);
  const feed = await app.json('/api/activity');
  assert.equal(feed.items.length, 5);
  assert.equal(feed.unreadCount, 5);
  for (const action of ['assigned', 'visit_recorded', 'stock_used', 'created', 'completed']) assert.ok(feed.items.some(item => item.action === action), action);
  assert.ok(feed.items.every(item => item.actor === 'Manager account' && item.siteId === site.id));
  assert.ok(!JSON.stringify(feed).includes('OWNER_PRIVATE_'));
  await app.json(`/api/purchaseRequests/${supply.id}`, 'owner', 'PATCH', {status: 'Approved', _expected: afterWork.purchaseRequests.find(record => record.id === supply.id)});
  const read = await app.json(`/api/activity/${feed.items[0].id}/read`, 'owner', 'POST');
  assert.ok(read.item.readAt);
  const expectedFeed = await app.json('/api/activity');
  assert.equal(expectedFeed.unreadCount, 4);
  assert.equal((await app.request(`/api/purchaseRequests/${supply.id}`, 'manager', 'PATCH', {notes: 'Cannot edit an approved request'})).status, 403);
  const protection = await app.json('/api/data-protection');
  assert.equal(protection.durableMedia, true);
  assert.deepEqual(protection.rls, {enabled: true, protectedTables: 4, totalTables: 4, browserAccessBlocked: true});
  assert.equal(protection.backups, 'unverified', 'Passing this isolated drill must never claim the production backup schedule is verified.');
  const chatIds = {owner: randomUUID(), manager: randomUUID()};
  const chats = {};
  for (const role of ['owner', 'manager']) {
    chats[role] = await app.json(`/api/assistant/conversations/${chatIds[role]}`, role, 'PUT', {
      exchangeId: randomUUID(), expectedVersion: 0,
      user: `${role.toUpperCase()}_CHAT_ONLY: What work is still unfinished?`,
      assistant: `Review the saved visits and follow up on any unchecked tasks. This is the ${role} conversation.`,
    });
    assert.equal(chats[role].version, 1);
    assert.equal(chats[role].messages.length, 2);
    const list = await app.json('/api/assistant/conversations', role);
    assert.equal(list.total, 1);
    assert.deepEqual(list.items.map(item => item.id), [chatIds[role]]);
  }
  assert.equal((await app.request(`/api/assistant/conversations/${chatIds.owner}`, 'manager')).status, 404);
  assert.equal((await app.request(`/api/assistant/conversations/${chatIds.manager}`, 'owner')).status, 404);
  assert.equal((await app.request('/api/assistant/conversations', 'anonymous')).status, 401);
  const expectedState = await store.state();
  assert.ok(!JSON.stringify(expectedState).includes('_CHAT_ONLY'), 'Private conversation text must not enter generic workspace data.');
  const expectedSessionSecret = await store.getSessionSecret();
  assert.deepEqual(readdirSync(directory), [], 'Hosted records and uploaded pictures must not create temporary application files.');

  // A fresh app/store instance must see the same rows, private image and receipts.
  await new Promise(resolve => app.server.close(resolve));
  const reopened = await openStore(database);
  const cold = await serve(reopened, passwords);
  assert.deepEqual(await reopened.state(), expectedState);
  assert.deepEqual(await cold.json('/api/activity'), expectedFeed);
  const coldPhoto = await cold.request(photoUrl, 'manager');
  assert.equal(coldPhoto.status, 200);
  assert.deepEqual(Buffer.from(await coldPhoto.arrayBuffer()), png);
  const coldState = await cold.json('/api/state', 'manager');
  assert.equal(coldState.jobs.find(record => record.id === job.id).status, 'Completed');
  assert.equal(coldState.inventory.find(record => record.id === stock.id).quantity, 6);
  assert.equal(coldState.places.find(record => record.id === site.id).inspections[0].id, visit.id);
  for (const role of ['owner', 'manager']) assert.deepEqual(await cold.json(`/api/assistant/conversations/${chatIds[role]}`, role), chats[role]);

  // Restore into a second independent database. Check security before running
  // application bootstrap, so a repair during startup cannot hide a bad backup.
  await new Promise(resolve => cold.server.close(resolve));
  const archive = await database.dumpDataDir();
  const restoredDatabase = new PGlite({loadDataDir: archive});
  databases.push(restoredDatabase);
  const restoredTables = (await restoredDatabase.query("SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace='potshaven_private'::regnamespace AND relkind='r' ORDER BY relname")).rows;
  assert.deepEqual(restoredTables.map(row => row.relname), ['activity', 'media', 'metadata', 'records']);
  assert.ok(restoredTables.every(row => row.relrowsecurity));
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await restoredDatabase.exec(`SET ROLE ${role}`);
    try {await assert.rejects(restoredDatabase.query('SELECT * FROM potshaven_private.records'), /permission denied/);}
    finally {await restoredDatabase.exec('RESET ROLE');}
  }
  const restored = await openStore(restoredDatabase);
  assert.deepEqual(await restored.state(), expectedState);
  assert.deepEqual(await restored.activityFeed(), expectedFeed);
  assert.equal(await restored.getSessionSecret(), expectedSessionSecret);
  const restorePasswords = {owner: randomBytes(24).toString('hex'), manager: randomBytes(24).toString('hex')};
  const recovered = await serve(restored, restorePasswords);
  for (const role of ['owner', 'manager']) assert.equal((await fetch(recovered.base + '/api/state', {headers: {Cookie: cold.cookies[role]}})).status, 401, 'Rotating passwords after recovery rejects pre-restore sessions.');
  assert.deepEqual(await recovered.json('/api/activity'), expectedFeed);
  const recoveredPhoto = await recovered.request(photoUrl, 'manager');
  assert.equal(recoveredPhoto.status, 200);
  assert.deepEqual(Buffer.from(await recoveredPhoto.arrayBuffer()), png);
  assert.equal((await recovered.request('/api/activity', 'manager')).status, 403);
  assert.equal((await recovered.json('/api/data-protection')).rls.browserAccessBlocked, true);
  for (const role of ['owner', 'manager']) assert.deepEqual(await recovered.json(`/api/assistant/conversations/${chatIds[role]}`, role), chats[role]);
  assert.equal((await recovered.request(`/api/assistant/conversations/${chatIds.owner}`, 'manager')).status, 404);
  const continued = await recovered.json(`/api/assistant/conversations/${chatIds.manager}`, 'manager', 'PUT', {
    exchangeId: randomUUID(), expectedVersion: 1, user: 'Prepare the next visit.', assistant: 'The recurring visit is saved. Review its crew before leaving.',
  });
  assert.equal(continued.version, 2);
  assert.equal(continued.messages.length, 4);
  assert.equal((await store.assistantConversation('manager', chatIds.manager)).version, 1);
  await recovered.json(`/api/inventory/${stock.id}/use`, 'manager', 'POST', {quantity: 1, jobId: followup.id});
  assert.equal((await restored.get('inventory', stock.id)).quantity, 5, 'Restored SQL mutation functions and sequences remain usable.');
  assert.equal((await restored.list('stockMovements')).length, 2);
  assert.equal((await store.get('inventory', stock.id)).quantity, 6, 'The recovery drill never changes its source database.');
  assert.equal((await restored.activityFeed()).items.length, 6);
});
