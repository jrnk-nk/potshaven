import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app.js';
import { createStore } from './store.js';
import { createMediaStorage } from './media-storage.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNI0AAAAASUVORK5CYII=';
const picture = `data:image/png;base64,${png}`;
const json = { 'Content-Type': 'application/json' };
async function setup(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'potshaven-media-'));
  const store = options.store || createStore(':memory:');
  const app = createApp({ store, dataDir, ownerPassword: '', managerPassword: '', sessionSecret: 'media-test-secret', imageKey: '', ...options });
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); if (!options.store) store.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { store, app, dataDir, base };
}

test('uploaded plant photos use stable private media URLs instead of repeating binary workspace data', async t => {
  const { base, dataDir, store } = await setup(t);
  const response = await fetch(`${base}/api/inventory`, { method: 'POST', headers: json, body: JSON.stringify({ name: 'Photo plant', image: picture, quantity: 5 }) });
  assert.equal(response.status, 201);
  const item = await response.json();
  assert.match(item.image, /^\/media\/uploads\/[a-f0-9]{64}\.png$/);
  assert.equal(store.get('inventory', item.id).image, item.image);
  const media = await fetch(base + item.image);
  assert.equal(media.status, 200);
  assert.match(media.headers.get('content-type'), /^image\/png/);
  assert.equal(media.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), Buffer.from(png, 'base64'));
  const second = await fetch(`${base}/api/jobs/job-1`, { method: 'PATCH', headers: json, body: JSON.stringify({ photos: [picture], completionPhotos: [{ url: picture, caption: 'Finished garden' }] }) });
  const job = await second.json();
  assert.equal(job.photos[0], item.image);
  assert.equal(job.completionPhotos[0].url, item.image);
  assert.equal(job.completionPhotos[0].caption, 'Finished garden');
  assert.equal(readdirSync(join(dataDir, 'uploads')).length, 1);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.inventory.find(record => record.id === item.id).image, item.image);
  assert.equal(JSON.stringify(state).includes(picture), false);
});

test('uploaded logos and picture URLs persist after reopening the database', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-media-persist-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'records.db');
  const store = createStore(filename);
  const { base } = await setup(t, { store });
  const response = await fetch(`${base}/api/settings`, { method: 'PATCH', headers: json, body: JSON.stringify({ logo: picture }) });
  assert.equal(response.status, 200);
  const settings = await response.json();
  assert.match(settings.logo, /^\/media\/uploads\//);
  const reopened = createStore(filename);
  assert.equal(reopened.settings().logo, settings.logo);
  reopened.close();
  t.after(() => store.close());
});

test('legacy inline photos remain intact in storage but are externalized in API responses', async t => {
  const { base, store } = await setup(t);
  store.update('places', 'place-1', { image: picture });
  store.update('jobs', 'job-1', { photos: [picture, { image: picture, caption: 'Before' }] });
  const response = await fetch(`${base}/api/state`);
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.match(state.places[0].image, /^\/media\/uploads\//);
  assert.equal(state.jobs[0].photos[0], state.places[0].image);
  assert.equal(state.jobs[0].photos[1].image, state.places[0].image);
  assert.equal(state.jobs[0].photos[1].caption, 'Before');
  assert.equal(store.get('places', 'place-1').image, picture);
  assert.equal(store.get('jobs', 'job-1').photos[0], picture);
});

test('private uploaded media requires a valid signed session', async t => {
  const { base } = await setup(t, { ownerPassword: 'test-owner-password', managerPassword: 'test-manager-password' });
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ role: 'owner', password: 'test-owner-password' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${base}/api/inventory`, { method: 'POST', headers: { ...json, Cookie: cookie }, body: JSON.stringify({ name: 'Private photo', image: picture }) });
  const item = await response.json();
  assert.equal((await fetch(base + item.image)).status, 401);
  assert.equal((await fetch(base + item.image, { headers: { Cookie: cookie } })).status, 200);
});

test('cloud media and asynchronous stores work without writing local application files', async t => {
  const underlying = createStore(':memory:');
  t.after(() => underlying.close());
  const asynchronousStore = Object.fromEntries(['state', 'list', 'get', 'put', 'update', 'remove', 'settings', 'updateSettings', 'stock'].map(name => [name, async (...args) => underlying[name](...args)]));
  const media = new Map();
  const directory = join(tmpdir(), `potshaven-no-local-files-${Date.now()}`);
  const mediaStorage = createMediaStorage({
    async putMedia(key, bytes, contentType) { media.set(key, { bytes, contentType }); },
    async getMedia(key) { return media.get(key) || null; },
  });
  const { base } = await setup(t, { store: asynchronousStore, dataDir: directory, mediaStorage, serveClient: false });
  const created = await fetch(`${base}/api/inventory`, { method: 'POST', headers: json, body: JSON.stringify({ name: 'Cloud plant', image: picture, quantity: 6 }) });
  assert.equal(created.status, 201);
  const item = await created.json();
  assert.match(item.image, /^\/media\/uploads\//);
  assert.equal((await fetch(base + item.image)).status, 200);
  const used = await fetch(`${base}/api/inventory/${item.id}/use`, { method: 'POST', headers: json, body: JSON.stringify({ quantity: 2, jobId: 'job-1' }) });
  assert.equal(used.status, 200);
  assert.equal((await used.json()).item.quantity, 4);
  const edited = await fetch(`${base}/api/inventory/${item.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ notes: 'Shared across workers' }) });
  assert.equal(edited.status, 200);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).inventory.find(record => record.id === item.id).notes, 'Shared across workers');
  assert.equal(existsSync(directory), false);
  assert.equal((await fetch(`${base}/`)).status, 404);
});

test('built UI is located from the project rather than the current shell directory', { skip: !existsSync(new URL('../dist/index.html', import.meta.url)) }, async t => {
  const previous = process.cwd();
  let application;
  try { process.chdir(tmpdir()); application = await setup(t); }
  finally { process.chdir(previous); }
  const response = await fetch(application.base + '/');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<div id="root">/);
});


test('durable media validates file names and serves stored bytes behind authentication', async t => {
  const files = new Map();
  let reads = 0;
  const storage = createMediaStorage({
    async putMedia(key, bytes, contentType) { files.set(key, { bytes, contentType }); },
    async getMedia(key) { reads++; return files.get(key) || null; },
  });
  const key = 'uploads/' + 'a'.repeat(64) + '.png';
  const url = await storage.put(key, Buffer.from(png, 'base64'), 'image/png');
  assert.equal(url, '/media/' + key);
  await assert.rejects(storage.put('../private', Buffer.from('x'), 'image/png'), /supported image name/);
  await assert.rejects(storage.put(key, Buffer.from('x'), 'text/html'), /supported image name/);
  const { base } = await setup(t, { mediaStorage: storage, ownerPassword: 'owner-test-only', managerPassword: 'manager-test-only', serveClient: false });
  assert.equal((await fetch(base + url)).status, 401);
  assert.equal(reads, 0);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ role: 'owner', password: 'owner-test-only' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const image = await fetch(base + url, { headers: { Cookie: cookie } });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(png, 'base64'));
  const head = await fetch(base + url, { method: 'HEAD', headers: { Cookie: cookie } });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await fetch(base + '/media/uploads/not-a-hash.png', { headers: { Cookie: cookie } })).status, 404);
  assert.equal((await fetch(base + url, { method: 'POST', headers: { Cookie: cookie } })).status, 405);
});

test('empty company workspaces start with official branding and no demonstration records', () => {
  const store = createStore(':memory:', { seed: false });
  try {
    assert.equal(store.settings().companyName, 'PotsHavenGh');
    assert.equal(store.settings().tagline, 'Brighten your world');
    assert.equal(store.settings().logo, '/branding/potshaven-logo.png');
    assert.equal(store.list('places').length, 0);
    assert.equal(store.list('jobs').length, 0);
    store.updateSettings({ logo: '/branding/potshaven-logo.png' });
    assert.throws(() => store.updateSettings({ logo: '/branding/../../private' }), /Upload/);
  } finally { store.close(); }
});
