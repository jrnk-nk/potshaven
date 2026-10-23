import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from './app.js';
import {createStore} from './store.js';

async function fixture(t, {postgres = false, report} = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'potshaven-protection-'));
  const store = createStore(join(dataDir, 'workspace.db'), {seed: false});
  if (report) store.dataProtection = report;
  const mediaStorage = postgres ? {put: async () => '/media/test.png', serve: (req, res) => res.sendStatus(404)} : undefined;
  const app = createApp({store, dataDir, mediaStorage, sessionSecret: 'isolated-protection-test-session', ownerPassword: 'protection-owner', managerPassword: 'protection-manager', imageKey: ''});
  const server = await new Promise(resolve => {const server = app.listen(0, '127.0.0.1', () => resolve(server));});
  t.after(async () => {await new Promise(resolve => server.close(resolve)); store.close(); rmSync(dataDir, {recursive: true, force: true});});
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookies = {};
  for (const role of ['owner', 'manager']) {
    const response = await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({role, password: `protection-${role}`})});
    assert.equal(response.status, 200);
    cookies[role] = response.headers.get('set-cookie').split(';')[0];
  }
  return {store, request: role => fetch(base + '/api/data-protection', {headers: role ? {Cookie: cookies[role]} : {}})};
}

test('data protection checks are owner-only, use the actual adapter and return no records or credentials', async t => {
  let reads = 0;
  const {request} = await fixture(t, {postgres: true, report: async () => {
    reads++;
    return {storage: 'postgres', database: 'connected', rls: {enabled: true, protectedTables: 4, totalTables: 4, browserAccessBlocked: true, secret: 'MUST_NOT_LEAK'}, records: [{name: 'Private company data'}], connection: 'postgres://private-password'};
  }});
  assert.equal((await request()).status, 401);
  assert.equal((await request('manager')).status, 403);
  assert.equal(reads, 0, 'Unauthorized requests never run the database inspection.');
  const response = await request('owner');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('vary'), /Cookie/);
  const result = await response.json();
  assert.equal(reads, 1);
  assert.equal(result.storage, 'postgres');
  assert.equal(result.database, 'connected');
  assert.equal(result.durableMedia, true);
  assert.equal(result.backups, 'unverified');
  assert.deepEqual(result.rls, {enabled: true, protectedTables: 4, totalTables: 4, browserAccessBlocked: true});
  assert.match(result.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(result).sort(), ['backups', 'checkedAt', 'database', 'durableMedia', 'rls', 'storage']);
  assert.ok(!JSON.stringify(result).includes('private-password'));
});

test('local storage is identified honestly and failed protection checks cannot report a healthy fallback', async t => {
  const local = await fixture(t);
  const result = await (await local.request('owner')).json();
  assert.equal(result.storage, 'sqlite');
  assert.equal(result.rls, null);
  assert.equal(result.durableMedia, false);
  assert.equal(result.backups, 'unverified');
  local.store.dataProtection = async () => {throw Object.assign(new Error('Connection with PRIVATE_DATABASE_PASSWORD interrupted'), {code: 'ECONNRESET'});};
  const response = await local.request('owner');
  assert.equal(response.status, 503);
  const failed = await response.json();
  assert.equal(failed.code, 'DATABASE_UNAVAILABLE');
  assert.equal(failed.storage, undefined);
  assert.ok(!JSON.stringify(failed).includes('PRIVATE_DATABASE_PASSWORD'));
  local.store.dataProtection = async () => ({storage: 'postgres', database: 'connected', rls: {enabled: true, totalTables: 4, protectedTables: 100, browserAccessBlocked: true}});
  const malformed = await local.request('owner');
  assert.equal(malformed.status, 503);
  assert.equal((await malformed.json()).database, undefined);
  const missingHostedCheck = await fixture(t, {postgres: true});
  const unsupported = await missingHostedCheck.request('owner');
  assert.equal(unsupported.status, 503);
  assert.equal((await unsupported.json()).storage, undefined, 'A hosted adapter without inspection support must never be mislabeled local and healthy.');
});
