import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import postgres from 'postgres';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from './app.js';
import {createStore} from './store.js';
import {createPostgresStore} from './postgres-store.js';

const exchange = (expectedVersion = 0, user = 'Plan a visit to the hotel', assistant = 'Review the visit before saving any changes.') => ({exchangeId: randomUUID(), expectedVersion, user, assistant});
async function fixture(t, backend) {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-assistant-history-'));
  let database, driver, query;
  const stores = [];
  if (backend === 'postgres') {
    database = new PGlite();
    driver = postgres('postgresql://fixture:fixture@unused.invalid/fixture', {prepare: false});
    query = (sql, parameters = []) => database.query(sql, parameters.map((value, index) => value !== null && new RegExp(`\\$${index + 1}::jsonb\\b`).test(sql) ? driver.options.serializers[3802](value) : value));
  }
  const reopen = async (overrides = {}) => {
    const store = backend === 'postgres' ? await createPostgresStore('', {query, ...overrides}) : createStore(join(directory, 'workspace.db'), {seed: false});
    stores.push(store); return store;
  };
  const store = await reopen();
  t.after(async () => {for (const item of stores) await item.close(); await driver?.end({timeout: 0}); await database?.close(); rmSync(directory, {recursive: true, force: true});});
  return {store, reopen, directory, query};
}

for (const backend of ['sqlite', 'postgres']) {
  test(`${backend} saved assistant conversations survive reopening and stay private to each role`, async t => {
    const {store, reopen} = await fixture(t, backend);
    const id = randomUUID(), first = exchange(0, 'OWNER_ONLY_HOTEL_PLAN');
    const before = await store.state();
    const saved = await store.appendAssistantExchange('owner', id, first);
    assert.equal(saved.id, id); assert.equal(saved.version, 1); assert.equal(saved.messages.length, 2);
    assert.equal(saved.title, first.user);
    assert.deepEqual(Object.keys(saved).sort(), ['id', 'messages', 'title', 'updatedAt', 'version']);
    assert.deepEqual(saved.messages.map(message => message.role), ['user', 'assistant']);
    assert.ok(saved.messages.every(message => typeof message.createdAt === 'string'));
    assert.equal(await store.assistantConversation('manager', id), undefined);
    assert.deepEqual(await store.assistantConversations('manager'), {items: [], total: 0, nextOffset: null});
    await assert.rejects(async () => store.appendAssistantExchange('manager', id, exchange(1)), error => error.status === 404);
    const restarted = await reopen();
    assert.deepEqual(await restarted.assistantConversation('owner', id), saved);
    assert.deepEqual(await restarted.state(), before, 'Chats do not leak through the shared state or settings.');
    await restarted.appendAssistantExchange('manager', randomUUID(), exchange(0, 'MANAGER_ONLY_DAILY_PLAN'));
    const ownerList = await restarted.assistantConversations('owner');
    assert.equal(ownerList.total, 1); assert.equal(ownerList.items[0].messageCount, 2);
    assert.ok(!JSON.stringify(ownerList).includes('MANAGER_ONLY'));
    assert.ok(!Object.hasOwn(ownerList.items[0], 'messages'), 'Conversation lists contain summaries only.');
    for (const role of [undefined, 'admin', 'owner:%']) await assert.rejects(async () => store.assistantConversations(role), error => error.status === 401);
    for (const bad of ['not-a-uuid', '../settings', '%', {id}]) await assert.rejects(async () => store.assistantConversation('owner', bad), error => error.status === 400);
  });

  test(`${backend} assistant exchanges are idempotent, stale-safe and bounded without discarding history`, async t => {
    const {store} = await fixture(t, backend);
    const id = randomUUID(), first = exchange();
    const saved = await store.appendAssistantExchange('owner', id, first);
    assert.deepEqual(await store.appendAssistantExchange('owner', id, first), saved);
    await assert.rejects(async () => store.appendAssistantExchange('owner', id, {...first, assistant: 'Different answer'}), error => error.status === 409);
    await assert.rejects(async () => store.appendAssistantExchange('owner', id, exchange(0)), error => error.status === 409);
    const contenders = await Promise.allSettled(['Assign Ama', 'Assign Kwame'].map(user => Promise.resolve().then(() => store.appendAssistantExchange('owner', id, exchange(1, user)))));
    assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(contenders.find(result => result.status === 'rejected').reason.status, 409);
    const current = await store.assistantConversation('owner', id);
    assert.equal(current.version, 2); assert.equal(current.messages.length, 4);
    assert.deepEqual(await store.appendAssistantExchange('owner', id, first), current, 'An old duplicate returns the current conversation without replacing newer exchanges.');
    for (const bad of [{...exchange(2), proposals: [{operation: 'delete'}]}, {...exchange(2), expectedVersion: -1}, {...exchange(2), user: 'x'.repeat(4001)}, {...exchange(2), assistant: 'x'.repeat(8001)}, {...exchange(2), assistant: ' '}, {...exchange(2), exchangeId: 'invalid'}]) await assert.rejects(async () => store.appendAssistantExchange('owner', id, bad), error => error.status === 400);
    for (let version = 2; version < 50; version++) await store.appendAssistantExchange('owner', id, exchange(version, `Question ${version}`));
    const full = await store.assistantConversation('owner', id);
    await assert.rejects(async () => store.appendAssistantExchange('owner', id, exchange(50)), error => error.status === 409 && /full/.test(error.message));
    assert.deepEqual(await store.assistantConversation('owner', id), full);
    assert.equal(full.messages.length, 100); assert.equal(full.messages[0].content, first.user);
    for (let index = 0; index < 51; index++) await store.appendAssistantExchange('owner', randomUUID(), exchange(0, `Conversation ${index}`));
    const list = await store.assistantConversations('owner');
    assert.equal(list.total, 52); assert.equal(list.items.length, 50); assert.equal(list.nextOffset, 50);
    assert.deepEqual(list.items.map(item => `${item.updatedAt}:${item.id}`), list.items.map(item => `${item.updatedAt}:${item.id}`).sort().reverse());
    const older = await store.assistantConversations('owner', {offset: list.nextOffset});
    assert.equal(older.total, 52); assert.equal(older.items.length, 2); assert.equal(older.nextOffset, null);
    assert.equal(new Set([...list.items, ...older.items].map(item => item.id)).size, 52);
    assert.ok(older.items.some(item => item.id === id), 'The original conversation remains reachable beyond the first page.');
    assert.deepEqual(await store.assistantConversations('owner', {offset: 100}), {items: [], total: 52, nextOffset: null});
    for (const offset of [-1, 0.5, 1000001, '50', NaN, Infinity, null]) await assert.rejects(async () => store.assistantConversations('owner', {offset}), error => error.status === 400);
    assert.equal((await store.assistantConversation('owner', id)).messages.length, 100, 'Listing only recent conversations never deletes older ones.');
  });
}

test('assistant history API requires sign-in, isolates roles and rejects executable payloads', async t => {
  const {store, directory} = await fixture(t, 'sqlite');
  const app = createApp({store, dataDir: directory, serveClient: false, sessionSecret: 'history-test-session-secret', ownerPassword: 'history-owner', managerPassword: 'history-manager', imageKey: ''});
  const server = await new Promise(resolve => {const server = app.listen(0, '127.0.0.1', () => resolve(server));});
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, cookies = {};
  const request = (role, path = '', method = 'GET', body) => fetch(`${base}/api/assistant/conversations${path}`, {method, headers: {...(role ? {Cookie: cookies[role]} : {}), 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
  for (const role of ['owner', 'manager']) {
    const login = await fetch(`${base}/api/auth/login`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({role, password: `history-${role}`})});
    assert.equal(login.status, 200); cookies[role] = login.headers.get('set-cookie').split(';')[0];
  }
  const id = randomUUID(), first = exchange(0, 'PRIVATE_OWNER_CONVERSATION');
  for (const [path, method, body] of [['', 'GET'], [`/${id}`, 'GET'], [`/${id}`, 'PUT', first]]) assert.equal((await request(null, path, method, body)).status, 401);
  const created = await request('owner', `/${id}`, 'PUT', first);
  assert.equal(created.status, 200); assert.equal(created.headers.get('cache-control'), 'private, no-store'); assert.match(created.headers.get('vary'), /Cookie/);
  const saved = await created.json(); assert.equal(saved.version, 1);
  assert.equal((await request('manager', `/${id}`)).status, 404);
  assert.equal((await request('manager', `/${id}`, 'PUT', exchange(1))).status, 404);
  assert.deepEqual(await (await request('manager')).json(), {items: [], total: 0, nextOffset: null});
  for (const offset of ['-1', '1.5', '1000001', 'NaN', '1e2', '50abc', '', '0&offset=50']) assert.equal((await request('owner', `?offset=${offset}`)).status, 400);
  assert.equal((await request('owner', '?offset=0')).status, 200);
  assert.deepEqual(await (await request('owner', '?offset=50')).json(), {items: [], total: 1, nextOffset: null});
  assert.deepEqual(await (await request('owner', `/${id}`)).json(), saved);
  assert.deepEqual(await (await request('owner', `/${id}`, 'PUT', first)).json(), saved);
  assert.equal((await request('owner', `/${id}`, 'PUT', exchange(0))).status, 409);
  assert.equal((await request('owner', `/${id}`, 'PUT', {...exchange(1), actions: [{collection: 'workers', operation: 'create'}]})).status, 400);
  assert.equal((await request('owner', '/invalid')).status, 400);
  const state = await fetch(`${base}/api/state`, {headers: {Cookie: cookies.owner}});
  assert.ok(!(await state.text()).includes(first.user));
  assert.equal((await store.list('workers')).length, 0);
  const crossOrigin = await fetch(`${base}/api/assistant/conversations/${id}`, {method: 'PUT', headers: {Cookie: cookies.owner, 'Content-Type': 'application/json', Origin: 'https://unrelated.invalid'}, body: JSON.stringify(exchange(1))});
  assert.equal(crossOrigin.status, 403);
  store.assistantConversations = async () => {throw Object.assign(new Error('PRIVATE_DATABASE_CONNECTION_STRING'), {code: 'CONNECTION_CLOSED'});};
  const failed = await request('owner'); assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('PRIVATE_DATABASE_CONNECTION_STRING'));
});

test('PostgreSQL history CAS protects simultaneous reads and never repeats a write after a lost response', async t => {
  const {store, reopen, query} = await fixture(t, 'postgres');
  const id = randomUUID(), key = `assistant-chat:owner:${id}`;
  await store.appendAssistantExchange('owner', id, exchange());
  let release, reads = 0, armed = false;
  const gate = new Promise(resolve => {release = resolve;});
  const concurrent = await reopen({query: async (sql, parameters = []) => {
    const result = await query(sql, parameters);
    if (armed && sql === 'SELECT value FROM potshaven_private.metadata WHERE key = $1' && parameters[0] === key && reads < 2) {
      reads++; if (reads === 2) release(); await gate;
    }
    return result;
  }});
  armed = true;
  const contenders = await Promise.allSettled([concurrent.appendAssistantExchange('owner', id, exchange(1, 'First phone')), concurrent.appendAssistantExchange('owner', id, exchange(1, 'Second phone'))]);
  assert.equal(reads, 2); assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(contenders.find(result => result.status === 'rejected').reason.status, 409);
  const duplicate = exchange(2, 'Same message on two requests');
  const duplicates = await Promise.all([concurrent.appendAssistantExchange('owner', id, duplicate), concurrent.appendAssistantExchange('owner', id, duplicate)]);
  assert.equal(duplicates[0].version, 3); assert.deepEqual(duplicates[1], duplicates[0]);
  let writes = 0, loseResponse = false;
  const unstable = await reopen({query: async (sql, parameters = []) => {
    const result = await query(sql, parameters);
    if (loseResponse && sql.startsWith('UPDATE potshaven_private.metadata SET value = $2::jsonb') && parameters[0] === key) {writes++; throw Object.assign(new Error('Connection lost after commit'), {code: 'CONNECTION_CLOSED'});}
    return result;
  }});
  const last = exchange(3, 'Keep this saved even if the reply is interrupted');
  loseResponse = true;
  await assert.rejects(unstable.appendAssistantExchange('owner', id, last), error => error.code === 'CONNECTION_CLOSED');
  assert.equal(writes, 1); assert.equal((await store.assistantConversation('owner', id)).version, 4);
  assert.equal((await unstable.appendAssistantExchange('owner', id, last)).version, 4); assert.equal(writes, 1, 'An explicit idempotent retry confirms the saved exchange without another write.');
});
