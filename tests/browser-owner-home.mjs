// Owner control and manager operations have separate homes. API data is mocked;
// backend authorization is covered separately by the access API tests.
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {existsSync, mkdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = '/tmp/potshaven-checks';
mkdirSync(artifacts, {recursive: true});
const vite = await createServer({configFile: false, root, plugins: [react()], logLevel: 'error', server: {host: '127.0.0.1', port: 0}});
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({executablePath, headless: true, args: ['--no-sandbox']});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
page.setDefaultTimeout(15000);
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(error.message));
const collections = ['places', 'jobs', 'inventory', 'stockMovements', 'workers', 'vehicles', 'contracts', 'payments', 'expenses', 'purchaseRequests', 'equipment', 'issues', 'careGuides', 'designs'];
const date = new Date().toISOString().slice(0, 10);
const state = Object.fromEntries(collections.map(name => [name, []]));
Object.assign(state, {
  settings: {companyName: 'PotsHavenGh', ownerName: 'PrivateOwnerName', currency: 'GHS', logo: '/branding/potshaven-logo.png'},
  role: 'owner', demoMode: false, assistantConfigured: true, imageGenerationConfigured: true,
  places: [{id: 'hotel', name: 'Palm Court'}],
  workers: [{id: 'ama', name: 'Ama Mensah', available: true, workforceType: 'Internal', engagementType: 'Permanent'}],
  vehicles: [{id: 'van', name: 'Crew van', status: 'Available'}],
  jobs: [
    {id: 'visit', title: 'Entrance care', placeId: 'hotel', date, time: '08:00', type: 'Maintenance', status: 'Scheduled', crewIds: ['ama'], vehicleId: 'van', tasks: [{text: 'Water pots', done: true}, {text: 'Photograph the entrance', done: false}]},
    {id: 'project', title: 'Courtyard installation', placeId: 'hotel', date, deadline: date, type: 'Project', status: 'In progress', budget: 9000, crewIds: ['ama'], vehicleId: 'van', tasks: [{text: 'Prepare beds', done: true}, {text: 'Install pots', done: false}]},
    {id: 'finished', title: 'Finished project', placeId: 'hotel', date, type: 'Project', status: 'Completed', crewIds: ['ama'], vehicleId: 'van', tasks: []},
  ],
  inventory: [{id: 'plant', name: 'Palm', category: 'Plants', quantity: 8, minStock: 2, cost: 50}],
  payments: [{id: 'received', description: 'Private paid invoice', status: 'Paid', amount: 1200, dueDate: date}, {id: 'unpaid', description: 'Private unpaid invoice', status: 'Unpaid', amount: 600, dueDate: date}],
  expenses: [{id: 'cost', description: 'Private operating cost', amount: 200, date}],
  stockMovements: [{id: 'used', inventoryId: 'plant', type: 'use', quantity: 2, totalCost: 100, date}],
  purchaseRequests: [{id: 'pending', title: 'Pots for the entrance', status: 'Pending', requestedBy: 'manager', estimatedCost: 150, quantity: 4, date}, {id: 'receipt', title: 'Travel receipt', status: 'Pending', requestedBy: 'manager', estimatedCost: 80, quantity: 1, date}],
  designs: [{id: 'private-design', title: 'Private studio instruction', prompt: 'Private studio instruction', source: 'Design studio', image: '/media/private-design.jpg', createdAt: date}],
});

const privateMediaRequests = [];
const currency = amount => new Intl.NumberFormat('en-GH', {style: 'currency', currency: 'GHS', maximumFractionDigits: 0}).format(amount);
async function home() {
  await page.goto(`${origin}/#overview`);
  await expect(page.locator('.owner-home, .simple-home')).toBeVisible();
  return page.locator('.owner-home, .simple-home');
}

try {
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/state' && request.method() === 'GET') return route.fulfill({json: state});
    throw new Error(`Unexpected role-home API request: ${request.method()} ${path}`);
  });
  await page.route('**/media/private-design.jpg', route => {privateMediaRequests.push(route.request().url()); return route.fulfill({status: 403, json: {error: 'Owner access required.'}});});

  let dashboard = await home();
  await expect(dashboard.getByRole('heading', {name: 'Your business at a glance', exact: true})).toBeVisible();
  const received = dashboard.getByRole('button', {name: /Money received/});
  await expect(received).toContainText(currency(1200));
  await expect(dashboard.getByRole('button', {name: /Payments outstanding/})).toContainText(currency(600));
  await expect(dashboard.getByRole('button', {name: /Recorded costs/})).toContainText(currency(300));
  await expect(dashboard.getByRole('button', {name: /Waiting for approval/})).toContainText('2');
  await expect(dashboard.getByRole('button', {name: /Active projects/})).toContainText('1');
  await expect(dashboard.getByText(/profit/i)).toHaveCount(0);
  console.log('PASS owner Home shows recorded money, costs, approvals and active projects without inventing profit');

  await received.click();
  await expect.poll(() => new URL(page.url()).hash).toBe('#business');
  dashboard = await home();
  await dashboard.getByRole('button', {name: /Active projects/}).click();
  await expect.poll(() => new URL(page.url()).hash).toBe('#projects');
  dashboard = await home();
  await dashboard.getByRole('button', {name: /Waiting for approval/}).click();
  await expect.poll(() => new URL(page.url()).hash).toBe('#inventory');
  await expect(page.getByRole('combobox', {name: 'Inventory tools', exact: true})).toHaveValue('Purchase requests');
  console.log('PASS owner business cards open the real finance, project and purchasing routes');

  await page.setViewportSize({width: 390, height: 844});
  dashboard = await home();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Owner Home must fit a phone.');
  await page.screenshot({path: join(artifacts, 'owner-business-home-mobile.png'), fullPage: true});

  state.role = 'manager';
  await page.reload();
  dashboard = page.locator('.simple-home');
  await expect(dashboard.getByRole('heading', {name: 'Your working day', exact: true})).toBeVisible();
  await expect(dashboard.getByRole('heading', {name: 'Today at a glance', exact: true})).toBeVisible();
  await expect(dashboard.getByText('Entrance care', {exact: true})).toBeVisible();
  await expect(dashboard.getByText(/Ama.*Crew van/).first()).toBeVisible();
  await expect(dashboard.locator('.md-job-progress').filter({hasText: '1/2 tasks checked'}).first()).toBeVisible();
  for (const label of ['Money received', 'Payments outstanding', 'Recorded costs', 'Waiting for approval', 'Open your gallery', 'Client reports']) {
    await expect(dashboard.getByText(label, {exact: true})).toHaveCount(0);
  }
  await expect(page.getByText('PrivateOwnerName', {exact: true})).toHaveCount(0);
  await expect(dashboard.getByRole('button', {name: /gallery|studio|portfolio/i})).toHaveCount(0);
  await expect(page.getByRole('navigation', {name: 'Everyday navigation'}).getByRole('button', {name: 'Designs', exact: true})).toHaveCount(0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Manager Home must fit a phone.');
  await page.screenshot({path: join(artifacts, 'manager-operations-home-mobile.png'), fullPage: true});
  console.log('PASS manager Home focuses on work, checklists, people and vehicles with no studio or financial overview');

  await dashboard.getByRole('button', {name: 'Prepare daily brief', exact: false}).first().click();
  const brief = page.getByRole('dialog', {name: 'Your daily work brief', exact: true});
  await expect(brief).toBeVisible();
  const text = await brief.getByRole('textbox', {name: 'Daily work brief', exact: true}).inputValue();
  assert.match(text, /Entrance care/);
  assert.match(text, /People: Ama Mensah/);
  assert.match(text, /Vehicle: Crew van/);
  assert.ok(!/Private paid invoice|Private operating cost|Private studio instruction|PrivateOwnerName/.test(text));
  await brief.getByRole('button', {name: 'Close dialog', exact: true}).click();
  console.log('PASS manager daily brief stays operational even when the test fixture contains owner-only records');

  await dashboard.getByRole('button', {name: 'Supply requests', exact: true}).click();
  await expect.poll(() => new URL(page.url()).hash).toBe('#inventory');
  await expect(page.getByRole('combobox', {name: 'Inventory tools', exact: true})).toHaveValue('Purchase requests');
  console.log('PASS manager supply request shortcut opens the request view directly');

  await page.goto(`${origin}/#settings`);
  await expect(page.getByRole('heading', {name: 'Your account', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Sign out', exact: true})).toBeVisible();
  await expect(page.getByRole('textbox', {name: 'Company name', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Save company settings', exact: true})).toHaveCount(0);
  await expect(page.getByLabel('Upload company logo', {exact: true})).toHaveCount(0);
  await expect(page.getByText('Studio availability', {exact: true})).toHaveCount(0);
  console.log('PASS manager account has session access without company branding or studio settings');

  for (const path of ['studio', 'portfolio']) {
    await page.goto(`${origin}/#${path}`);
    await expect(page.getByRole('heading', {name: 'This area belongs to the owner', exact: true})).toBeVisible();
    await expect(page.getByRole('region', {name: 'Studio gallery', exact: true})).toHaveCount(0);
    await expect(page.getByText('Private studio instruction', {exact: true})).toHaveCount(0);
  }
  assert.equal(privateMediaRequests.length, 0, 'Forbidden manager routes must not mount private studio images.');
  assert.deepEqual(runtimeErrors, [], 'Role-specific homes and account screens must not produce runtime errors.');
  console.log('PASS manual manager studio and portfolio links never mount private work');
} catch (error) {
  await page.screenshot({path: join(artifacts, 'role-home-failure.png'), fullPage: true}).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await vite.close();
}
