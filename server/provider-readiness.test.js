import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from './app.js';
import {createStore} from './store.js';

async function running(t, options) {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-provider-check-'));
  const store = createStore(':memory:', {seed: false});
  store.put('places', {name: 'PRIVATE_SITE_MUST_NOT_SEND'});
  const server = createApp({store, dataDir: directory, serveClient: false, ownerPassword: 'owner', managerPassword: 'manager', imageKey: 'private-test-key', sessionSecret: 'test-secret', ...options}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {await new Promise(resolve => server.close(resolve)); store.close(); rmSync(directory, {recursive: true, force: true});});
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async role => (await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({role, password: role})})).headers.get('set-cookie').split(';')[0];
  return {store, login, check: cookie => fetch(base + '/api/readiness/assistant', {method: 'POST', headers: {'Content-Type': 'application/json', ...(cookie ? {Cookie: cookie} : {})}, body: '{}'})};
}

test('explicit owner check verifies a real provider response without sending company records or saving work', async t => {
  let calls = 0;
  const {login, check, store} = await running(t, {fetchAssistant: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(init.body);
    assert.equal(body.store, false); assert.equal(body.model, 'gpt-5.4');
    assert.ok(body.max_output_tokens <= 256);
    assert.ok(!JSON.stringify(body).includes('PRIVATE_SITE_MUST_NOT_SEND'));
    return {ok: true, json: async () => ({status: 'completed', output: [{content: [{type: 'output_text', text: 'Ready.'}]}]})};
  }});
  assert.equal((await check()).status, 401);
  assert.equal((await check(await login('manager'))).status, 403);
  assert.equal(calls, 0);
  const owner = await login('owner'), before = store.state();
  const response = await check(owner), result = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Object.keys(result).sort(), ['check', 'checkedAt', 'ok']);
  assert.equal(result.ok, true); assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  assert.deepEqual(store.state(), before); assert.equal(calls, 1);
  assert.equal((await check(owner)).status, 429); assert.equal(calls, 1);
});

test('connection checks reject unconfigured, rejected, incomplete and malformed provider responses without leaking provider details', async t => {
  const cases = [
    {options: {imageKey: ''}, status: 503},
    ...[401, 403, 429, 500].map(status => ({options: {fetchAssistant: async () => ({ok: false, status, json: async () => ({error: 'secret-provider-error'})})}, status: 502})),
    ...[{status: 'incomplete', output_text: 'Ready'}, {output_text: ''}, {output_text: 'secret-unexpected-output'}, null].map(body => ({options: {fetchAssistant: async () => ({ok: true, json: async () => body})}, status: 502})),
    {options: {fetchAssistant: async () => {throw Error('private-test-key');}}, status: 502},
  ];
  for (const entry of cases) await t.test(JSON.stringify({status: entry.status, case: cases.indexOf(entry)}), async t => {
    const {check, login} = await running(t, entry.options);
    const response = await check(await login('owner'));
    assert.equal(response.status, entry.status);
    const body = await response.text();
    assert.ok(!/secret-provider-error|private-test-key|secret-unexpected-output/.test(body));
  });
});
