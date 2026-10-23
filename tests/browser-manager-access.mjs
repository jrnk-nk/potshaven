// Real owner/manager boundaries through the browser, API, and private media.
// All data is isolated; the paid providers are injected and must never be called.
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {mkdtempSync, existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {createApp} from '../server/app.js';
import {createStore} from '../server/store.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(join(tmpdir(), 'potshaven-manager-access-'));
const store = createStore(join(dataDir, 'access.db'), {seed: false});
const date = new Date().toISOString().slice(0, 10);
const designId = '11111111-1111-4111-8111-111111111111';
const stockImageId = '22222222-2222-4222-8222-222222222222';
const privateImage = `/media/${designId}.png`;
const stockImage = `/media/${stockImageId}.png`;
mkdirSync(join(dataDir, 'designs'), {recursive: true});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1cAAAAASUVORK5CYII=', 'base64');
for (const id of [designId, stockImageId]) writeFileSync(join(dataDir, 'designs', `${id}.png`), png);
store.updateSettings({companyName: 'PotsHavenGh', ownerName: 'Private Business Owner', watermark: 'Private brand setting'});
store.put('places', {id: 'garden', name: 'Palm Court', address: 'Accra', client: 'Site contact', commercialNotes: 'Private commercial terms'});
store.put('workers', {id: 'ama', name: 'Ama Ops', role: 'Gardener', available: true, skills: ['Pruning'], agreedRate: 12345, rateBasis: 'Weekly', agreementReference: 'Private signed terms', agreementNotes: 'Confidential contract terms'});
store.put('vehicles', {id: 'van', name: 'Crew van', registration: 'GR 123', status: 'Available', purchasePrice: 90000});
store.put('jobs', {id: 'visit', title: 'Palm Court visit', placeId: 'garden', date, time: '08:00', type: 'Maintenance', status: 'Scheduled', crewIds: [], vehicleId: '', recurrence: 'None', tasks: [{text: 'Water the pots', done: false}], budget: 98765});
store.put('inventory', {id: 'plant', name: 'Peace lily', category: 'Plants', quantity: 10, minStock: 2, unit: 'plants', cost: 45.5, supplierCost: 39, image: stockImage});
store.put('designs', {id: designId, title: 'Create a private garden design', prompt: 'Private studio instructions', studioTitle: 'Palm Court concept', placeId: 'garden', conversationId: designId, image: privateImage, source: 'Design studio', published: true, createdAt: new Date().toISOString()});
store.put('payments', {id: 'payment', description: 'Private client payment', amount: 7777, status: 'Pending'});
store.put('expenses', {id: 'expense', description: 'Private owner expense', amount: 3333});
store.put('contracts', {id: 'contract', title: 'Private client agreement', amount: 5555, status: 'Active'});
store.put('purchaseRequests', {id: 'owner-request', title: 'Owner private supplies', quantity: 2, estimatedCost: 500, requestedBy: 'owner', status: 'Pending'});
store.put('purchaseRequests', {id: 'manager-request', title: 'Manager gloves', quantity: 2, estimatedCost: 50, requestedBy: 'manager', status: 'Pending'});
let paidCalls = 0;
const app = createApp({store, dataDir, ownerPassword: 'owner-access-test', managerPassword: 'manager-access-test', imageKey: 'test-provider-key', sessionSecret: 'isolated-role-test-session', fetchImage: async () => {paidCalls++; throw new Error('No paid image calls allowed.');}, fetchAssistant: async () => {paidCalls++; throw new Error('No paid assistant calls allowed.');}});
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const apiOrigin = `http://127.0.0.1:${server.address().port}`;
const vite = await createServer({configFile: false, root, plugins: [react()], logLevel: 'error', server: {host: '127.0.0.1', port: 0, proxy: {'/api': {target: apiOrigin, changeOrigin: false, xfwd: true}, '/media': {target: apiOrigin, changeOrigin: false, xfwd: true}}}});
await vite.listen();
const baseURL = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox']});
const managerContext = await browser.newContext({viewport: {width: 390, height: 844}});
const manager = await managerContext.newPage();
manager.setDefaultTimeout(15000);
const errors = [];
manager.on('pageerror', error => errors.push(error.message));
async function signIn(page, role, password) {
  await page.goto(`${baseURL}/#overview`);
  await expect(page.getByRole('heading', {name: 'Welcome back.', exact: true})).toBeVisible({timeout: 60000});
  await page.getByRole('combobox').selectOption(role);
  await page.getByLabel('Password', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Enter your workspace', exact: true}).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}
async function stateFor(context) {
  const response = await context.request.get(`${baseURL}/api/state`);
  assert.equal(response.status(), 200);
  return response.json();
}
try {
  await signIn(manager, 'manager', 'manager-access-test');
  const privateState = await stateFor(managerContext);
  assert.equal(privateState.role, 'manager');
  for (const collection of ['designs', 'payments', 'expenses', 'contracts']) assert.deepEqual(privateState[collection], [], `${collection} must not reach a manager browser.`);
  assert.equal(privateState.inventory[0].cost, undefined);
  assert.equal(privateState.inventory[0].supplierCost, undefined);
  assert.equal(privateState.workers[0].agreedRate, undefined);
  assert.equal(privateState.workers[0].agreementReference, undefined);
  assert.equal(privateState.workers[0].agreementNotes, undefined);
  assert.equal(privateState.jobs[0].budget, undefined);
  assert.equal(privateState.vehicles[0].purchasePrice, undefined);
  assert.equal(privateState.settings.ownerName, undefined);
  assert.equal(privateState.settings.watermark, undefined);
  assert.equal(privateState.imageGenerationConfigured, false);
  assert.deepEqual(privateState.purchaseRequests.map(request => request.id), ['manager-request']);
  assert.ok(!JSON.stringify(privateState).includes('Private studio instructions'));
  assert.equal((await managerContext.request.get(`${baseURL}${stockImage}`)).status(), 200, 'Approved stock photos stay available.');
  assert.equal((await managerContext.request.get(`${baseURL}${privateImage}`)).status(), 403, 'Guessing a studio image URL does not grant access.');
  console.log('PASS authenticated manager state omits owner records, pay, stock costs, budgets and private studio media');

  const beforeDenied = store.state();
  const denied = [
    ['GET', '/api/designs'], ['GET', '/api/payments'], ['GET', '/api/expenses'], ['GET', '/api/contracts'],
    ['POST', '/api/designs/generate', {prompt: 'Create a design'}],
    ['POST', '/api/workers', {name: 'Unapproved hire'}], ['POST', '/api/vehicles', {name: 'Unapproved van'}],
    ['POST', '/api/inventory', {name: 'Unapproved stock', category: 'Plants', quantity: 10}],
    ['PATCH', '/api/inventory/plant', {quantity: 999}], ['POST', '/api/inventory/plant/restock', {quantity: 2}],
    ['PATCH', '/api/workers/ama', {agreedRate: 1}], ['PATCH', '/api/jobs/visit', {budget: 1}],
    ['PATCH', '/api/settings', {companyName: 'Changed company'}], ['DELETE', '/api/places/garden'],
    ['PATCH', '/api/purchaseRequests/owner-request', {title: 'Changed owner request'}],
    ['PATCH', '/api/purchaseRequests/manager-request', {status: 'Approved'}],
  ];
  for (const [method, path, data] of denied) {
    const response = await managerContext.request.fetch(`${baseURL}${path}`, {method, ...(data ? {data} : {})});
    assert.equal(response.status(), 403, `${method} ${path}`);
  }
  assert.deepEqual(store.state(), beforeDenied, 'Denied requests cannot alter records.');
  assert.equal(paidCalls, 0, 'Studio denial happens before calling any provider.');
  console.log('PASS manager API bypass attempts are denied before writes or provider calls');

  const bottom = manager.getByRole('navigation', {name: 'Everyday navigation'});
  await expect(bottom).toContainText('Today');
  await expect(bottom).not.toContainText('Designs');
  await expect(bottom).not.toContainText('Business');
  await manager.getByRole('button', {name: 'Open menu', exact: true}).click();
  const menu = manager.getByRole('dialog', {name: 'Workspace menu'});
  for (const label of ['Design studio', 'Business', 'Portfolio & reports']) await expect(menu.getByRole('button', {name: label, exact: true})).toHaveCount(0);
  await expect(menu).not.toContainText('Private Business Owner');
  await manager.keyboard.press('Escape');
  for (const route of ['studio', 'portfolio', 'business', 'activity']) {
    await manager.goto(`${baseURL}/#${route}`);
    await expect(manager.getByRole('heading', {name: route === 'business' ? 'This page isn’t available right now' : 'This area belongs to the owner', exact: true})).toBeVisible();
    await expect(manager.locator('.design-chat,.studio-space-gallery,.business-page')).toHaveCount(0);
  }
  await manager.goto(`${baseURL}/#settings`);
  await expect(manager.getByRole('button', {name: 'Sign out', exact: true})).toBeVisible();
  await expect(manager.getByLabel('Company name', {exact: true})).toHaveCount(0);
  await expect(manager.getByLabel('Image watermark', {exact: true})).toHaveCount(0);
  await expect(manager.getByRole('button', {name: 'Save company settings', exact: true})).toHaveCount(0);
  await expect(manager.getByRole('link', {name: /Open the design studio/})).toHaveCount(0);
  console.log('PASS manager navigation and direct links exclude studio, finance, portfolio and company settings');

  await manager.goto(`${baseURL}/#team`);
  await expect(manager.getByRole('heading', {name: 'Team & vehicles', exact: true})).toBeVisible();
  await expect(manager.getByRole('button', {name: 'Add crew member', exact: true})).toHaveCount(0);
  await expect(manager.getByRole('button', {name: 'Edit profile', exact: true})).toHaveCount(0);
  await expect(manager.locator('main')).not.toContainText('Private signed terms');
  await expect(manager.locator('main')).not.toContainText('12345');
  await manager.getByRole('button', {name: 'Vehicles', exact: true}).click();
  await expect(manager.getByRole('button', {name: 'Add vehicle', exact: true})).toHaveCount(0);
  await manager.goto(`${baseURL}/#inventory`);
  await expect(manager.getByRole('heading', {name: 'Plants & stock', exact: true})).toBeVisible();
  await expect(manager.getByRole('button', {name: /Add stock/})).toHaveCount(0);
  await expect(manager.getByRole('button', {name: /Restock/})).toHaveCount(0);
  await expect(manager.getByRole('button', {name: 'Edit Peace lily', exact: true})).toHaveCount(0);
  await manager.getByRole('button', {name: 'Use stock', exact: true}).click();
  await manager.getByLabel('Quantity used', {exact: true}).fill('3');
  await manager.getByRole('combobox', {name: 'Used on job', exact: true}).selectOption('visit');
  await manager.getByRole('button', {name: 'Deduct stock', exact: true}).click();
  await expect(manager.getByRole('dialog')).toHaveCount(0);
  assert.equal(store.get('inventory', 'plant').quantity, 7);
  assert.equal(store.get('inventory', 'plant').cost, 45.5, 'Usage never reveals or edits unit cost.');
  const afterUsage = await stateFor(managerContext);
  assert.equal(afterUsage.stockMovements.at(-1).unitCost, undefined);
  assert.equal(afterUsage.stockMovements.at(-1).totalCost, undefined);
  await manager.getByRole('button', {name: /New request/}).click();
  await manager.getByLabel('Item or materials needed', {exact: true}).fill('Crew safety gloves');
  await manager.getByLabel('Quantity', {exact: true}).fill('4');
  await expect(manager.getByLabel(/Estimated total/)).toHaveCount(0);
  await manager.getByRole('button', {name: 'Save changes', exact: true}).click();
  await expect(manager.getByRole('dialog')).toHaveCount(0);
  const request = store.list('purchaseRequests').find(item => item.title === 'Crew safety gloves');
  assert.equal(request.status, 'Pending');
  assert.equal(request.requestedBy, 'manager');
  await manager.getByLabel('Inventory tools', {exact: true}).selectOption('Purchase requests');
  await expect(manager.getByRole('button', {name: 'Approve', exact: true})).toHaveCount(0);
  await expect(manager.locator('main')).not.toContainText('Owner private supplies');
  console.log('PASS manager uses stock on an actual job and requests supplies without stock editing or approval controls');

  await manager.goto(`${baseURL}/#schedule`);
  const visit = manager.locator('.ops-stop').filter({hasText: 'Palm Court visit'});
  await visit.getByRole('button', {name: /View \/ edit/}).click();
  await expect(manager.getByLabel(/Budget/)).toHaveCount(0);
  await manager.getByLabel('Ama Ops', {exact: true}).check();
  await manager.getByLabel('Vehicle', {exact: true}).selectOption('van');
  await manager.getByRole('button', {name: 'Save job', exact: true}).click();
  await expect(manager.getByRole('dialog')).toHaveCount(0);
  assert.deepEqual(store.get('jobs', 'visit').crewIds, ['ama']);
  assert.equal(store.get('jobs', 'visit').vehicleId, 'van');
  assert.equal(store.get('jobs', 'visit').budget, 98765);
  assert.equal(store.get('workers', 'ama').agreedRate, 12345);
  assert.ok(await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  console.log('PASS manager assigns approved people and vehicles while budgets and pay remain unchanged');

  const ownerContext = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const owner = await ownerContext.newPage();
  owner.on('pageerror', error => errors.push(error.message));
  await signIn(owner, 'owner', 'owner-access-test');
  const ownerState = await stateFor(ownerContext);
  assert.equal(ownerState.designs.length, 1);
  assert.equal(ownerState.payments.length, 0);
  assert.equal(ownerState.expenses.length, 0);
  assert.equal(ownerState.contracts.length, 1);
  assert.equal(ownerState.workers[0].agreedRate, undefined);
  assert.equal(ownerState.inventory[0].cost, undefined);
  assert.equal(ownerState.jobs[0].budget, undefined);
  assert.equal((await ownerContext.request.get(`${baseURL}/api/designs`)).status(), 200);
  for (const collection of ['payments', 'expenses']) assert.equal((await ownerContext.request.get(`${baseURL}/api/${collection}`)).status(), 403);
  assert.equal(store.get('payments', 'payment').amount, 7777);
  assert.equal(store.get('expenses', 'expense').amount, 3333);
  assert.equal(store.get('jobs', 'visit').budget, 98765);
  assert.equal((await ownerContext.request.get(`${baseURL}${privateImage}`)).status(), 200);
  const hire = await ownerContext.request.post(`${baseURL}/api/workers`, {data: {name: 'Approved hire', role: 'Gardener', available: true, skills: []}});
  assert.equal(hire.status(), 201);
  const adjustment = await ownerContext.request.patch(`${baseURL}/api/inventory/plant`, {data: {quantity: 8}});
  assert.equal(adjustment.status(), 200);
  await owner.goto(`${baseURL}/#studio`);
  await expect(owner.getByRole('heading', {name: 'Your gallery', exact: true})).toBeVisible();
  await owner.goto(`${baseURL}/#settings`);
  await expect(owner.getByLabel('Company name', {exact: true})).toBeVisible();
  await expect(owner.getByRole('button', {name: 'Save company settings', exact: true})).toBeVisible();
  assert.equal(paidCalls, 0);
  assert.deepEqual(errors, []);
  mkdirSync('/tmp/potshaven-checks', {recursive: true});
  await manager.screenshot({path: '/tmp/potshaven-checks/manager-access-mobile.png', fullPage: true});
  console.log('PASS owner keeps studio, settings, hiring and stock control; financial data stays hidden and preserved');
} catch (error) {
  mkdirSync('/tmp/potshaven-checks', {recursive: true});
  await manager.screenshot({path: '/tmp/potshaven-checks/manager-access-failure.png', fullPage: true}).catch(() => {});
  if (errors.length) console.error('Browser runtime errors:', errors);
  throw error;
} finally {
  await browser.close(); await vite.close(); await new Promise(resolve => server.close(resolve));
  store.close(); rmSync(dataDir, {recursive: true, force: true});
}
