// Exercises request recovery without paid calls. Provider and network outcomes are controlled fixtures.
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {existsSync, mkdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vite = await createServer({configFile: false, root, plugins: [react()], logLevel: 'error', server: {host: '127.0.0.1', port: 0}});
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox']});
const page = await browser.newPage({viewport: {width: 390, height: 844}, reducedMotion: 'reduce'});
page.setDefaultTimeout(15000);
const context = page.context(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const collections = ['places', 'jobs', 'inventory', 'stockMovements', 'workers', 'vehicles', 'contracts', 'payments', 'expenses', 'purchaseRequests', 'equipment', 'issues', 'careGuides', 'designs'];
const state = {...Object.fromEntries(collections.map(name => [name, []])), settings: {companyName: 'PotsHavenGh'}, role: 'owner', demoMode: false, imageGenerationConfigured: true};
const receipts = new Map(), requests = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6P18QAAAAASUVORK5CYII=', 'base64');
let mode = 'normal', calls = 0, signedOut = false, releaseReply;
const createDesign = body => {
  const parent = state.designs.find(item => item.id === body.parentDesignId);
  const id = `recovered-${state.designs.length + 1}`;
  const design = {id, title: body.prompt.slice(0, 80), prompt: body.prompt, source: 'Design studio', image: `/media/designs/${id}.png`, conversationId: parent?.conversationId || id, parentDesignId: parent?.id || '', referenceImages: [], placeId: '', createdAt: new Date().toISOString()};
  state.designs.push(design);
  receipts.set(body.requestId, {status: 'completed', createdAt: new Date().toISOString(), design});
  return design;
};
const studio = page.getByRole('region', {name: 'Design studio', exact: true});
const composer = studio.getByRole('textbox', {name: 'Message design studio', exact: true});
const send = studio.getByRole('button', {name: 'Send message', exact: true});
const recovery = studio.getByRole('region', {name: 'Design request recovery', exact: true});

try {
  await context.route('**/media/**', route => route.fulfill({contentType: 'image/png', body: png}));
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/state') return route.fulfill({status: signedOut ? 401 : 200, json: signedOut ? {error: 'Please sign in.'} : {...state, designs: state.role === 'manager' ? [] : state.designs}});
    if (path === '/api/activity') return route.fulfill({json: {items: [], unreadCount: 0}});
    if (path.startsWith('/api/designs/requests/')) {
      const result = receipts.get(path.split('/').at(-1));
      return route.fulfill({status: result ? 200 : 404, json: result || {error: 'Request not found.'}});
    }
    if (path === '/api/designs/generate' && request.method() === 'POST') {
      const body = request.postDataJSON(), original = request.postData(); requests.push({body, original});
      assert.match(body.requestId, /^[a-f0-9-]{36}$/i);
      const current = receipts.get(body.requestId);
      if (current?.status === 'completed') return route.fulfill({json: current.design});
      if (current) return route.fulfill({status: 409, json: {error: 'Check the request first.'}});
      const outcome = mode; mode = 'normal';
      if (outcome === 'not-admitted') return route.fulfill({status: 429, json: {error: 'Busy.'}});
      calls++;
      receipts.set(body.requestId, {status: 'pending', createdAt: new Date().toISOString()});
      if (outcome === 'pending') return route.fulfill({status: 409, json: {error: 'Request still running.'}});
      if (outcome === 'hold') await new Promise(resolve => {releaseReply = resolve;});
      const design = createDesign(body);
      if (outcome === 'lost-response') return route.abort('failed');
      return route.fulfill({status: 201, json: design}).catch(() => {});
    }
    throw Error(`Unexpected recovery request ${request.method()} ${path}`);
  });
  await page.goto(origin + '/#studio');
  await page.getByRole('region', {name: 'Studio gallery', exact: true}).getByRole('button', {name: 'New space', exact: true}).click();
  mode = 'lost-response';
  const firstPrompt = 'Create a simple entrance with green pots.';
  await composer.fill(firstPrompt); await send.click();
  await expect(recovery.getByRole('alert')).toBeVisible();
  await expect(send).toBeDisabled();
  await expect(composer).toHaveValue(firstPrompt);
  assert.equal(calls, 1); assert.equal(requests.length, 1); assert.equal(state.designs.length, 1);
  const stored = await page.evaluate(() => sessionStorage.getItem('potshaven:studio-request:owner'));
  assert.deepEqual(Object.keys(JSON.parse(stored)[0]).sort(), ['conversationId', 'createdAt', 'id']);
  assert.ok(!stored.includes(firstPrompt) && !stored.includes('data:image'));
  console.log('PASS interrupted image responses preserve the request reference and block blind resubmission');

  await page.reload();
  await expect(page.getByRole('region', {name: 'Unfinished design requests', exact: true})).toBeVisible();
  assert.equal(requests.length, 1, 'Reload must not repeat image generation.');
  // A duplicated/opened tab inherits the original reference and can check it without generating.
  const childPromise = context.waitForEvent('page');
  await page.evaluate(() => window.open(location.href, 'saved-request-review'));
  const second = await childPromise; second.setDefaultTimeout(15000);
  await second.getByRole('region', {name: 'Unfinished design requests', exact: true}).getByRole('button', {name: /Review request/}).click();
  await second.getByRole('button', {name: 'Check request', exact: true}).click();
  await expect(second.getByRole('region', {name: 'Design studio', exact: true}).getByAltText('Design version 1', {exact: true})).toBeVisible();
  assert.equal(calls, 1); assert.equal(requests.length, 1);
  await second.close();
  await page.getByRole('region', {name: 'Unfinished design requests', exact: true}).getByRole('button', {name: /Review request/}).click();
  await expect(composer).toHaveValue(firstPrompt);
  await recovery.getByRole('button', {name: 'Check request', exact: true}).click();
  await expect(studio.getByAltText('Design version 1', {exact: true})).toBeVisible();
  await expect(recovery).toHaveCount(0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('potshaven:studio-request:owner')), null);
  assert.equal(calls, 1); assert.equal(requests.length, 1);
  console.log('PASS reload and a second tab recover the same saved design through read-only checks');

  mode = 'not-admitted';
  await composer.fill('Keep the entrance clear and add two pots.'); await send.click();
  await expect(recovery.getByRole('alert')).toBeVisible();
  const refused = requests.at(-1);
  await recovery.getByRole('button', {name: 'Check request', exact: true}).click();
  await expect(recovery).toContainText('No result is visible yet');
  await expect(send).toBeDisabled();
  await recovery.getByRole('button', {name: 'Retry original request', exact: true}).click();
  await expect(studio.getByAltText('Design version 2', {exact: true})).toBeVisible();
  assert.equal(requests.at(-1).original, refused.original, 'A request with no visible receipt must retain its exact ID and payload on explicit retry.');
  assert.equal(calls, 2); assert.equal(requests.length, 3);
  console.log('PASS an unconfirmed admission retries only on request and keeps its original ID and exact payload');

  mode = 'pending';
  await composer.fill('Add a small border around the pots.'); await send.click();
  await expect(recovery.getByRole('alert')).toBeVisible();
  const uncertainId = requests.at(-1).body.requestId;
  await recovery.getByRole('button', {name: 'Check request', exact: true}).click();
  await expect(recovery).toContainText('still being prepared');
  await expect(recovery.getByRole('button', {name: 'Retry original request', exact: true})).toHaveCount(0);
  receipts.set(uncertainId, {...receipts.get(uncertainId), status: 'uncertain'});
  await recovery.getByRole('button', {name: 'Check request', exact: true}).click();
  await expect(recovery).toContainText('This request needs a check');
  await expect(send).toBeDisabled();
  assert.equal(requests.length, 4);
  await page.setViewportSize({width: 360, height: 640});
  const phone = await studio.evaluate(element => ({width: document.documentElement.scrollWidth, viewport: innerWidth, composer: element.querySelector('.dc-composer').getBoundingClientRect().bottom, nav: document.querySelector('.mobile-bottom-nav').getBoundingClientRect().top}));
  assert.ok(phone.width <= phone.viewport && phone.composer <= phone.nav + 1, 'Recovery must not cover the small-phone composer.');
  await expect(recovery.getByRole('button', {name: 'Check request', exact: true})).toBeInViewport();
  mkdirSync('/tmp/potshaven-checks', {recursive: true});
  await page.screenshot({path: '/tmp/potshaven-checks/studio-request-recovery-mobile.png', fullPage: true});
  await recovery.getByRole('button', {name: 'Prepare separate request', exact: true}).click();
  const separate = page.getByRole('dialog', {name: 'Prepare a separate request?', exact: true});
  await expect(separate).toContainText('earlier request may still finish');
  await separate.getByRole('button', {name: 'Keep checking', exact: true}).click();
  await expect(send).toBeDisabled();
  await recovery.getByRole('button', {name: 'Prepare separate request', exact: true}).click();
  await separate.getByRole('button', {name: 'Prepare separate request', exact: true}).click();
  await expect(send).toBeEnabled();
  assert.equal(requests.length, 4, 'Preparing a separate request must not send it.');
  console.log('PASS pending and uncertain requests never restart themselves; explicit separate-request warning preserves a usable phone layout');

  mode = 'hold';
  const privatePrompt = 'PRIVATE_LATE_OWNER_IDEA';
  await composer.fill(privatePrompt); await send.click();
  await expect.poll(() => typeof releaseReply).toBe('function');
  signedOut = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(studio).toHaveCount(0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('potshaven:studio-request:owner')), null, 'Session expiry must clear private pending references.');
  state.role = 'manager'; signedOut = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('heading', {name: 'This area belongs to the owner', exact: true})).toBeVisible();
  releaseReply();
  await expect.poll(() => state.designs.length).toBe(3);
  await expect(page.getByText(privatePrompt, {exact: true})).toHaveCount(0);
  await expect(page.getByRole('region', {name: 'Unfinished design requests', exact: true})).toHaveCount(0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('potshaven:studio-request:owner')), null);
  assert.deepEqual(errors, []);
  console.log('PASS sign-out clears request references and late owner generation cannot enter the manager workspace');
} catch (error) {
  mkdirSync('/tmp/potshaven-checks', {recursive: true});
  await page.screenshot({path: '/tmp/potshaven-checks/studio-request-recovery-failure.png', fullPage: true}).catch(() => {});
  throw error;
} finally {await browser.close(); await vite.close();}
