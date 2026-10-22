import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app.js';
import { createStore } from './store.js';
import { request } from 'node:http';

async function setup(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'potshaven-api-'));
  const store = options.store || createStore(':memory:');
  const app = createApp({ store, dataDir, sessionSecret: 'isolated-test-secret', imageKey: '', ...options });
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); if (!options.store) store.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { store, base };
}

test('demo exposes sample data and explicit image integration state', async t => {
  const { base } = await setup(t);
  const response = await fetch(`${base}/api/state`);
  const state = await response.json();
  assert.equal(response.status, 200);
  assert.equal(state.demoMode, true);
  assert.equal(state.role, 'owner');
  assert.equal(state.places.length, 6);
  assert.equal(state.imageGenerationConfigured, false);
  const generation = await fetch(`${base}/api/designs/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'A lush tropical entrance garden' }) });
  assert.equal(generation.status, 503);
  assert.match((await generation.json()).error, /OPENAI_API_KEY/);
});

test('authenticated manager can schedule work but cannot approve purchases or change branding', async t => {
  const { base } = await setup(t, { ownerPassword: 'owner-example-password', managerPassword: 'manager-example-password' });
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'manager', password: 'manager-example-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  const job = await fetch(`${base}/api/jobs`, { method: 'POST', headers, body: JSON.stringify({ title: 'New planting visit', placeId: 'place-1', date: '2026-10-23' }) });
  assert.equal(job.status, 201);
  const branding = await fetch(`${base}/api/settings`, { method: 'PATCH', headers, body: JSON.stringify({ companyName: 'Not allowed' }) });
  assert.equal(branding.status, 403);
  const approval = await fetch(`${base}/api/purchaseRequests/purchase-1`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'Approved' }) });
  assert.equal(approval.status, 403);
  const created = await job.json();
  assert.equal(created.status, 'Scheduled');
  assert.equal(created.type, 'Maintenance');
});

test('stock API rejects overuse and immutable movement history', async t => {
  const { base } = await setup(t);
  const headers = { 'Content-Type': 'application/json' };
  const response = await fetch(`${base}/api/inventory/plant-1/use`, { method: 'POST', headers, body: JSON.stringify({ quantity: 999, jobId: 'job-1' }) });
  assert.equal(response.status, 409);
  const valid = await fetch(`${base}/api/inventory/plant-1/use`, { method: 'POST', headers, body: JSON.stringify({ quantity: 2, jobId: 'job-1' }) });
  assert.equal(valid.status, 200);
  const { movement } = await valid.json();
  const deletion = await fetch(`${base}/api/stockMovements/${movement.id}`, { method: 'DELETE' });
  assert.equal(deletion.status, 403);
  const history = await (await fetch(`${base}/api/stockMovements`)).json();
  assert.equal(history.length, 1);
});

test('cross-site writes and malformed records fail without mutating data', async t => {
  const { base, store } = await setup(t);
  const cross = await fetch(`${base}/api/places`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: JSON.stringify({ name: 'Wrong origin' }) });
  assert.equal(cross.status, 403);
  const invalid = await fetch(`${base}/api/places`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '' }) });
  assert.equal(invalid.status, 400);
  assert.equal(store.list('places').length, 6);
});

test('Vite preserved browser host and forwarded host allow same-origin writes', async t => {
  const { base } = await setup(t);
  const preservedStatus = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/places`, { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'localhost:5173', Origin: 'http://localhost:5173' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    req.on('error', reject);
    req.end(JSON.stringify({ name: 'Vite host test' }));
  });
  assert.equal(preservedStatus, 201);
  const forwarded = await fetch(`${base}/api/places`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Host': 'localhost:5173', Origin: 'http://localhost:5173' }, body: JSON.stringify({ name: 'Vite forwarded host test' }) });
  assert.equal(forwarded.status, 201);
});

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNI0AAAAASUVORK5CYII=';
const imageResponse = () => new Response(JSON.stringify({ data: [{ b64_json: tinyPng }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('Sunburst generations use max quality and highest stable landscape size without external calls', async t => {
  const calls = [];
  const { base, store } = await setup(t, { imageKey: 'test-key-not-a-real-credential', fetchImage: async (url, options) => { calls.push({ url, options }); return imageResponse(); } });
  const response = await fetch(`${base}/api/designs/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'Create a lush tropical garden for the entrance.', placeId: 'place-1', measurements: '18m × 8m' }) });
  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/images/generations');
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.model, 'gpt-image-2.5-sunburst');
  assert.equal(payload.quality, 'max');
  assert.equal(payload.size, '2560x1440');
  assert.equal(payload.n, 1);
  assert.match(payload.prompt, /18m × 8m/);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  const design = await response.json();
  assert.equal(design.quality, 'max');
  assert.equal(store.list('designs').length, 1);
  const media = await fetch(`${base}${design.image}`);
  assert.equal(media.status, 200);
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), Buffer.from(tinyPng, 'base64'));
  const health = await (await fetch(`${base}/api/health`)).json();
  const state = await (await fetch(`${base}/api/state`)).json();
  for (const metadata of [health, state]) {
    assert.equal(metadata.imageModel, 'gpt-image-2.5-sunburst');
    assert.equal(metadata.imageQuality, 'max');
    assert.equal(metadata.imageSize, '2560x1440');
  }
});

test('Sunburst photo edits send the original image with max quality and configured dimensions', async t => {
  const calls = [];
  const { base } = await setup(t, { imageKey: 'test-key-not-a-real-credential', fetchImage: async (url, options) => { calls.push({ url, options }); return imageResponse(); } });
  const response = await fetch(`${base}/api/designs/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'Arrange tropical plants along this hotel entrance.', originalImage: `data:image/png;base64,${tinyPng}` }) });
  assert.equal(response.status, 201);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/images/edits');
  const form = calls[0].options.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get('model'), 'gpt-image-2.5-sunburst');
  assert.equal(form.get('quality'), 'max');
  assert.equal(form.get('size'), '2560x1440');
  const upload = form.get('image');
  assert.equal(upload.type, 'image/png');
  assert.deepEqual(Buffer.from(await upload.arrayBuffer()), Buffer.from(tinyPng, 'base64'));
});

test('older image-model overrides retain compatible quality and dimensions', async t => {
  let payload;
  const { base } = await setup(t, { imageKey: 'test-key-not-a-real-credential', imageModel: 'gpt-image-1.5', fetchImage: async (url, options) => { payload = JSON.parse(options.body); return imageResponse(); } });
  const response = await fetch(`${base}/api/designs/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'A peaceful modern garden with warm terracotta pots.' }) });
  assert.equal(response.status, 201);
  assert.equal(payload.model, 'gpt-image-1.5');
  assert.equal(payload.quality, 'high');
  assert.equal(payload.size, '1536x1024');
});

test('enabling passwords and rotating passwords invalidate sessions sharing the retained server secret', async t => {
  const sessionSecret = 'same-retained-random-secret-for-this-isolated-test';
  const demo = await setup(t, { sessionSecret });
  const headers = { 'Content-Type': 'application/json' };
  const demoLogin = await fetch(`${demo.base}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ role: 'manager' }) });
  assert.equal(demoLogin.status, 200);
  const demoCookie = demoLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${demo.base}/api/state`, { headers: { Cookie: demoCookie } })).status, 200);
  const protectedApp = await setup(t, { store: demo.store, sessionSecret, ownerPassword: 'test-owner-password', managerPassword: 'test-manager-password' });
  const demoReuse = await fetch(`${protectedApp.base}/api/state`, { headers: { Cookie: demoCookie } });
  assert.equal(demoReuse.status, 401);
  const protectedLogin = await fetch(`${protectedApp.base}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ role: 'manager', password: 'test-manager-password' }) });
  assert.equal(protectedLogin.status, 200);
  const protectedCookie = protectedLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${protectedApp.base}/api/state`, { headers: { Cookie: protectedCookie } })).status, 200);
  const rotatedApp = await setup(t, { store: demo.store, sessionSecret, ownerPassword: 'test-owner-password', managerPassword: 'test-rotated-manager-password' });
  assert.equal((await fetch(`${rotatedApp.base}/api/state`, { headers: { Cookie: protectedCookie } })).status, 401);
  const newLogin = await fetch(`${rotatedApp.base}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ role: 'manager', password: 'test-rotated-manager-password' }) });
  assert.equal(newLogin.status, 200);
});
