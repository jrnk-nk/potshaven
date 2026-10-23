import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from './app.js';
import {createStore} from './store.js';

async function setup(t, {filename = ':memory:', ...options} = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'potshaven-auth-security-'));
  const store = createStore(filename, {seed: false});
  const app = createApp({store, dataDir, serveClient: false, sessionSecret: 'isolated-auth-security-secret', ownerPassword: 'isolated-owner-password', managerPassword: 'isolated-manager-password', imageKey: '', ...options});
  const server = await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
    rmSync(dataDir, {recursive: true, force: true});
  });
  const login = (role, password = `isolated-${role}-password`) => fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({role, password}),
  });
  return {login, store, base};
}

test('a manager sign-in cannot clear the owner password attempt limit', async t => {
  const {login} = await setup(t);
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await login('owner', 'incorrect-password')).status, 401);
    assert.equal((await login('manager')).status, 200);
  }
  assert.equal((await login('owner', 'incorrect-password')).status, 429);
  assert.equal((await login('owner')).status, 429);
  assert.equal((await login('manager')).status, 200);
});

test('failed manager sign-ins cannot lock the owner out', async t => {
  const {login} = await setup(t);
  for (let attempt = 0; attempt < 10; attempt++) assert.equal((await login('manager', 'incorrect-password')).status, 401);
  assert.equal((await login('manager')).status, 429);
  assert.equal((await login('owner')).status, 200);
});

test('a successful sign-in resets only its own role attempt counter', async t => {
  const {login} = await setup(t);
  for (let attempt = 0; attempt < 9; attempt++) assert.equal((await login('owner', 'incorrect-password')).status, 401);
  assert.equal((await login('owner')).status, 200);
  for (let attempt = 0; attempt < 9; attempt++) assert.equal((await login('owner', 'incorrect-password')).status, 401);
  assert.equal((await login('owner')).status, 200);
});

test('concurrent cold app instances share the persisted attempt limit without storing the source or password', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-shared-auth-'));
  const filename = join(directory, 'workspace.db');
  // Remove the shared database after the nested servers and stores close.
  try {
    await t.test('shared SQLite workspace', async t => {
      const first = await setup(t, {filename}), second = await setup(t, {filename});
      const attempts = await Promise.all(Array.from({length: 24}, (_, index) => (index % 2 ? first : second).login('owner', 'incorrect-password')));
      assert.equal(attempts.filter(response => response.status === 401).length, 10);
      assert.equal(attempts.filter(response => response.status === 429).length, 14);
      const cold = await setup(t, {filename});
      assert.equal((await cold.login('owner')).status, 429);
      assert.equal((await cold.login('manager')).status, 200);
      const metadata = first.store.db.prepare("SELECT key, value FROM metadata WHERE key LIKE 'login-attempt:%'").all();
      assert.equal(metadata.length, 1);
      assert.match(metadata[0].key, /^login-attempt:[a-f0-9]{64}$/);
      assert.equal(JSON.parse(metadata[0].value).count, 10);
      assert.doesNotMatch(JSON.stringify(metadata), /127\.0\.0\.1|isolated-owner-password|incorrect-password/);
    });
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('the persisted limit expires after fifteen minutes and successful sign-in resets its key', t => {
  const store = createStore(':memory:', {seed: false});
  t.after(() => store.close());
  const key = 'a'.repeat(64), start = 1_000_000, window = 15 * 60 * 1000;
  const expiredKey = 'b'.repeat(64);
  assert.equal(store.recordLoginAttempt(expiredKey, false, start), true);
  for (let attempt = 0; attempt < 10; attempt++) assert.equal(store.recordLoginAttempt(key, false, start + attempt * 1000), true);
  assert.equal(store.recordLoginAttempt(key, false, start + window - 1), false);
  assert.equal(store.recordLoginAttempt(key, true, start + window - 1), false);
  assert.equal(store.recordLoginAttempt(key, false, start + window), true);
  assert.equal(store.db.prepare('SELECT value FROM metadata WHERE key = ?').get(`login-attempt:${expiredKey}`), undefined);
  assert.equal(store.recordLoginAttempt(key, true, start + window), true);
  for (let attempt = 0; attempt < 10; attempt++) assert.equal(store.recordLoginAttempt(key, false, start + window), true);
  assert.equal(store.recordLoginAttempt(key, false, start + window), false);
  assert.throws(() => store.recordLoginAttempt('127.0.0.1', false, start), /Invalid sign-in attempt/);
  assert.throws(() => store.recordLoginAttempt(key, 'false', start), /Invalid sign-in attempt/);
  assert.throws(() => store.recordLoginAttempt(key, false, NaN), /Invalid sign-in attempt/);
});

test('a correct password cannot establish a session when attempt persistence fails', async t => {
  const {login, store, base} = await setup(t);
  store.recordLoginAttempt = async () => {throw new Error('Isolated persistence failure.');};
  const response = await login('owner');
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
});
