import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from './app.js';
import {createStore} from './store.js';
import {createPostgresStore} from './postgres-store.js';
import {createMediaStorage} from './media-storage.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNI0AAAAASUVORK5CYII=';
const otherPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=';
const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9/KKKKAP/2Q==';
const pictures = [png, otherPng].map(value => `data:image/png;base64,${value}`);
const json = {'Content-Type': 'application/json'};
const imageReply = () => new Response(JSON.stringify({data: [{b64_json: jpeg}]}), {status: 200, headers: json});

async function setup(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'potshaven-chat-'));
  const store = options.store || createStore(':memory:', {seed: false});
  const calls = [];
  const app = createApp({
    store, dataDir, ownerPassword: '', managerPassword: '', sessionSecret: 'isolated-design-chat-secret', imageKey: 'not-a-real-api-key',
    fetchImage: async (url, request) => {calls.push({url, ...request}); return imageReply();},
    ...options,
  });
  const server = await new Promise(resolve => {const server = app.listen(0, '127.0.0.1', () => resolve(server));});
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (!options.store) store.close();
    rmSync(dataDir, {recursive: true, force: true});
  });
  return {store, calls, dataDir, base: `http://127.0.0.1:${server.address().port}`};
}

async function generate(base, body, headers = json) {
  const response = await fetch(`${base}/api/designs/generate`, {method: 'POST', headers, body: JSON.stringify(body)});
  return {status: response.status, data: await response.json()};
}

function multipartImages(form) {
  assert.ok(form instanceof FormData);
  return [...form.getAll('image'), ...form.getAll('image[]')];
}

async function imageBytes(form) {
  return Promise.all(multipartImages(form).map(async image => Buffer.from(await image.arrayBuffer())));
}

test('multiple site photos become saved chat attachments and genuine multipart edit inputs', async t => {
  const {base, calls, store} = await setup(t);
  const brief = 'Keep the hotel entrance open and add flowering plants in terracotta pots.';
  const {status, data: design} = await generate(base, {prompt: `  ${brief}  `, referenceImages: pictures});
  assert.equal(status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/images/edits');
  assert.deepEqual(await imageBytes(calls[0].body), [Buffer.from(png, 'base64'), Buffer.from(otherPng, 'base64')]);
  assert.match(calls[0].body.get('prompt'), /Keep the hotel entrance open/);
  assert.equal(design.prompt, brief);
  assert.equal(design.conversationId, design.id);
  assert.equal(design.source, 'Design studio');
  assert.equal(design.published, false);
  assert.deepEqual(design.instructionHistory, [brief]);
  assert.equal(design.referenceImages.length, 2);
  for (let index = 0; index < design.referenceImages.length; index++) {
    assert.match(design.referenceImages[index], /^\/media\/uploads\/[a-f0-9]{64}\.png$/);
    const attachment = await fetch(base + design.referenceImages[index]);
    assert.equal(attachment.status, 200);
    assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), Buffer.from([png, otherPng][index], 'base64'));
  }
  assert.deepEqual(store.get('designs', design.id).referenceImages, design.referenceImages);
  const state = await (await fetch(`${base}/api/state`)).text();
  assert.ok(!state.includes('data:image/'), 'Saved chat state must contain media URLs rather than inline photos.');
});

test('short follow-ups edit the selected version, remember the brief, and retain independent earlier branches', async t => {
  const {base, calls, store} = await setup(t);
  const brief = 'A tropical hotel entrance with low palms and a clear central walkway.';
  const root = await generate(base, {prompt: brief, referenceImages: [pictures[0]]});
  assert.equal(root.status, 201);
  const original = structuredClone(store.get('designs', root.data.id));
  const revised = await generate(base, {prompt: 'Less', parentDesignId: root.data.id});
  assert.equal(revised.status, 201, JSON.stringify(revised.data));
  assert.equal(revised.data.parentDesignId, root.data.id);
  assert.equal(revised.data.conversationId, root.data.id);
  assert.deepEqual(revised.data.instructionHistory, [brief, 'Less']);
  assert.deepEqual(revised.data.referenceImages, [], 'Follow-up messages should not repeat earlier attachments.');
  assert.deepEqual(revised.data.contextImages, root.data.contextImages);
  const revisionImages = await imageBytes(calls[1].body);
  assert.deepEqual(revisionImages[0], Buffer.from(jpeg, 'base64'), 'The generated parent version must be the primary edit image.');
  assert.deepEqual(revisionImages[1], Buffer.from(png, 'base64'), 'The original site photo remains available as context.');
  assert.match(calls[1].body.get('prompt'), /clear central walkway/);
  assert.match(calls[1].body.get('prompt'), /Less/);
  assert.deepEqual(store.get('designs', root.data.id), original, 'Editing must never mutate the earlier version.');

  const branchPrompt = 'Instead, use blue and white pots around the original layout.';
  const branch = await generate(base, {prompt: branchPrompt, parentDesignId: root.data.id, referenceImages: [pictures[1]]});
  assert.equal(branch.status, 201);
  assert.equal(branch.data.conversationId, root.data.id);
  assert.equal(branch.data.parentDesignId, root.data.id);
  assert.deepEqual(branch.data.instructionHistory, [brief, branchPrompt]);
  assert.equal(branch.data.referenceImages.length, 1, 'A later message keeps its own new photo attachment.');
  assert.equal(branch.data.contextImages.length, 2, 'New reference photos supplement the original site context.');
  assert.deepEqual(await imageBytes(calls[2].body), [Buffer.from(jpeg, 'base64'), Buffer.from(otherPng, 'base64'), Buffer.from(png, 'base64')]);
  assert.ok(!calls[2].body.get('prompt').includes('\nLess\n'), 'An edit branched from the original must not inherit another branch’s instructions.');
  assert.equal(store.list('designs').length, 3);
});

test('bad references and invalid parent versions are rejected before a paid image request', async t => {
  const {base, calls, store} = await setup(t);
  store.put('designs', {id: 'portfolio-only', title: 'Finished garden', source: 'Portfolio upload', image: pictures[0]});
  store.put('designs', {id: 'remote-image', title: 'Untrusted remote reference', source: 'Design studio', image: 'https://untrusted.invalid/private.png'});
  store.put('designs', {id: 'traversal-image', title: 'Invalid local reference', source: 'Design studio', image: '/media/../../.env'});
  const invalidRequests = [
    [{prompt: '   '}, 400],
    [{prompt: 'x'.repeat(6001)}, 400],
    [{prompt: 'Add flowers', referenceImages: 'not a list'}, 400],
    [{prompt: 'Add flowers', referenceImages: [pictures[0], pictures[0], pictures[0], pictures[0], pictures[0]]}, 400],
    [{prompt: 'Add flowers', referenceImages: ['https://untrusted.invalid/photo.png']}, 400],
    [{prompt: 'Add flowers', referenceImages: ['data:image/png;base64,not-valid-base64!']}, 400],
    [{prompt: 'Add flowers', parentDesignId: 'no-such-design'}, 404],
    [{prompt: 'Add flowers', parentDesignId: 'portfolio-only'}, 400],
    [{prompt: 'Add flowers', parentDesignId: 'remote-image'}, 400],
    [{prompt: 'Add flowers', parentDesignId: 'traversal-image'}, 400],
  ];
  for (const [body, expectedStatus] of invalidRequests) {
    const response = await generate(base, body);
    assert.equal(response.status, expectedStatus, `${JSON.stringify(body).slice(0, 150)}: ${JSON.stringify(response.data)}`);
    assert.equal(typeof response.data.error, 'string');
  }
  assert.equal(calls.length, 0);
  assert.equal(store.list('designs').length, 3);
});

test('a failed edit leaves chat history intact and can be explicitly retried without duplicate versions', async t => {
  let requests = 0;
  const {base, store} = await setup(t, {fetchImage: async () => {
    requests++;
    return requests === 2
      ? new Response(JSON.stringify({error: {message: 'provider-only detail'}}), {status: 429, headers: json})
      : imageReply();
  }});
  const root = await generate(base, {prompt: 'Keep the existing building and arrange pots at the entrance.'});
  assert.equal(root.status, 201);
  const original = structuredClone(store.get('designs', root.data.id));
  const body = {prompt: 'More flowers', parentDesignId: root.data.id};
  const failed = await generate(base, body);
  assert.equal(failed.status, 502);
  assert.match(failed.data.error, /limit|balance|later/i);
  assert.equal(store.list('designs').length, 1);
  assert.deepEqual(store.get('designs', root.data.id), original);
  const retry = await generate(base, body);
  assert.equal(retry.status, 201);
  assert.equal(store.list('designs').length, 2);
  assert.deepEqual(retry.data.instructionHistory, [original.prompt, 'More flowers']);
  assert.equal(requests, 3, 'Only explicit requests should call the paid image service.');
});

test('legacy single-photo requests can be continued as a saved conversation', async t => {
  const {base, calls} = await setup(t);
  const root = await generate(base, {prompt: 'A calm garden with warm terracotta pots.', originalImage: pictures[0]});
  assert.equal(root.status, 201);
  assert.equal(calls[0].body.get('image').type, 'image/png');
  assert.equal(root.data.referenceImages.length, 1);
  const edit = await generate(base, {prompt: 'Greener', parentDesignId: root.data.id});
  assert.equal(edit.status, 201);
  assert.equal(edit.data.conversationId, root.data.id);
  assert.deepEqual((await imageBytes(calls[1].body))[0], Buffer.from(jpeg, 'base64'));
});

test('cloud chat resumes from durable PostgreSQL media after a new app instance with private attachments', async t => {
  const database = new PGlite();
  t.after(() => database.close());
  const query = async (text, parameters = []) => (await database.query(text, parameters)).rows;
  const firstStore = await createPostgresStore('', {query});
  const auth = {ownerPassword: 'chat-owner-password', managerPassword: 'chat-manager-password'};
  const first = await setup(t, {store: firstStore, mediaStorage: createMediaStorage(firstStore), ...auth});
  const login = await fetch(`${first.base}/api/auth/login`, {method: 'POST', headers: json, body: JSON.stringify({role: 'owner', password: auth.ownerPassword})});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = {...json, Cookie: cookie};
  const root = await generate(first.base, {prompt: 'A planted roundabout with a clear view for drivers.', referenceImages: pictures}, headers);
  assert.equal(root.status, 201, JSON.stringify(root.data));
  assert.match(root.data.image, /^\/media\/designs\/[a-f0-9-]+\.jpg$/);
  assert.equal((await fetch(first.base + root.data.referenceImages[0])).status, 401);
  assert.equal((await fetch(first.base + root.data.image)).status, 401);
  const photo = await fetch(first.base + root.data.referenceImages[0], {headers: {Cookie: cookie}});
  assert.equal(photo.status, 200);
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), Buffer.from(png, 'base64'));

  const restoredStore = await createPostgresStore('', {query});
  const restored = await setup(t, {store: restoredStore, mediaStorage: createMediaStorage(restoredStore), ...auth});
  const edit = await generate(restored.base, {prompt: 'Lower plants', parentDesignId: root.data.id}, headers);
  assert.equal(edit.status, 201, JSON.stringify(edit.data));
  assert.equal(edit.data.conversationId, root.data.id);
  assert.deepEqual((await imageBytes(restored.calls[0].body))[0], Buffer.from(jpeg, 'base64'));
  assert.deepEqual(edit.data.instructionHistory, [root.data.prompt, 'Lower plants']);
  assert.equal((await restoredStore.list('designs')).length, 2);
  assert.deepEqual(readdirSync(first.dataDir), []);
  assert.deepEqual(readdirSync(restored.dataDir), []);
});
