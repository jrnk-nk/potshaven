// Real manager mutations and owner inbox, plus delayed-response permission races.
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {mkdtempSync, existsSync, rmSync, mkdirSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {createApp} from '../server/app.js';
import {createStore} from '../server/store.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(join(tmpdir(), 'potshaven-inbox-'));
const store = createStore(join(dataDir, 'test.db'), {seed: false});
const date = new Date().toISOString().slice(0, 10);
store.put('places', {id: 'hotel', name: 'Palm Court', address: 'Accra'});
store.put('inventory', {id: 'plant', name: 'Peace lily', quantity: 10, unit: 'plants', category: 'Plants', cost: 91});
store.put('jobs', {id: 'visit', title: 'Entrance care', placeId: 'hotel', date, type: 'Maintenance', status: 'Scheduled', crewIds: [], tasks: [{text: 'Water pots', done: false}], budget: 9876});
const app = createApp({store, dataDir, ownerPassword: 'inbox-owner-test', managerPassword: 'inbox-manager-test', imageKey: ''});
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const apiOrigin = `http://127.0.0.1:${server.address().port}`;
const vite = await createServer({configFile: false, root, plugins: [react()], logLevel: 'error', server: {host: '127.0.0.1', port: 0, proxy: {'/api': {target: apiOrigin, changeOrigin: false, xfwd: true}, '/media': {target: apiOrigin, changeOrigin: false, xfwd: true}}}});
await vite.listen();
const baseURL = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox']});
const ownerContext = await browser.newContext({viewport: {width: 390, height: 844}});
const managerContext = await browser.newContext();
const page = await ownerContext.newPage();
page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const activityURL = '**/api/activity?limit=100';
const feed = async () => (await ownerContext.request.get(`${baseURL}/api/activity`)).json();
async function write(path, method, data) {
 const response = await managerContext.request.fetch(`${baseURL}/api/${path}`, {method, data});
 assert.ok(response.ok(), `${path}: ${response.status()} ${await response.text()}`);
}
async function holdNextRead() {
 let release, captured;
 const received = new Promise(resolve => {captured = resolve;});
 const paused = new Promise(resolve => {release = resolve;});
 let held = false;
 const handler = async route => {
  if(held)return route.continue();
  held = true;
  const response = await route.fetch();
  const json = await response.json();
  captured();
  await paused;
  await route.fulfill({json}).catch(()=>{});
 };
 await page.route(activityURL, handler);
 return {received, release, cleanup:()=>page.unroute(activityURL, handler)};
}
try {
 for (const [context, role] of [[ownerContext, 'owner'], [managerContext, 'manager']]) {
  const response = await context.request.post(`${baseURL}/api/auth/login`, {data: {role, password: `inbox-${role}-test`}});
  assert.equal(response.status(), 200);
 }
 await page.goto(`${baseURL}/#activity`);
 await expect(page.getByRole('heading', {name: 'No manager updates yet', exact: true})).toBeVisible();
 await write('purchaseRequests', 'POST', {title: 'Replacement pots', jobId: 'visit', quantity: 4});
 await write('places/hotel', 'PATCH', {inspections: [{id: 'inspection', date, plantHealth: 'Needs attention', irrigation: 'Working', workNeeded: 'Replace damaged pots', notes: 'Entrance inspected'}]});
 await write('inventory/plant/use', 'POST', {quantity: 2, jobId: 'visit'});
 await write('jobs/visit', 'PATCH', {status: 'Completed'});
 await page.getByRole('button', {name: 'Refresh', exact: true}).click();
 await expect(page.locator('.activity-card')).toHaveCount(4);
 await expect(page.getByRole('button', {name: 'Manager activity, 4 unread updates', exact: true})).toBeVisible();
 await expect(page.locator('.activity-card')).toContainText(['Manager account', 'Manager account', 'Manager account', 'Manager account']);
 await expect(page.locator('.activity-list')).toContainText('Completed a maintenance visit');
 await expect(page.locator('.activity-list')).toContainText('Recorded or updated a site visit');
 await expect(page.locator('.activity-list')).toContainText('Replacement pots');
 await expect(page.locator('.activity-list')).not.toContainText('9876');
 assert.ok((await feed()).items.every(item => item.siteName === 'Palm Court'));
 assert.equal((await managerContext.request.get(`${baseURL}/api/activity`)).status(), 403);
 assert.equal((await managerContext.request.post(`${baseURL}/api/activity/read-all`)).status(), 403);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1));
 mkdirSync('/tmp/potshaven-checks', {recursive: true});
 await page.screenshot({path:'/tmp/potshaven-checks/owner-activity-mobile.png', fullPage:true});
 console.log('PASS manager requests, visits, stock use and completion reach the private owner inbox with site and account context');

 // A slow GET must not overwrite the receipt saved after it began.
 const delayed = await holdNextRead();
 await page.getByRole('button', {name:'Refresh', exact:true}).click();
 await delayed.received;
 await page.getByRole('button', {name:'Mark as read', exact:true}).first().click();
 await expect(page.getByRole('button', {name:'Manager activity, 3 unread updates', exact:true})).toBeVisible();
 delayed.release(); await delayed.cleanup();
 await expect(page.locator('.activity-unread')).toHaveCount(3);
 assert.equal((await feed()).unreadCount, 3);
 await page.reload();
 await expect(page.locator('.activity-unread')).toHaveCount(3);

 const denyReceipt = route=>route.fulfill({status:503, json:{error:'Temporary test outage'}});
 await page.route('**/api/activity/read-all', denyReceipt);
 await page.getByRole('button', {name:'Mark all as read', exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Couldn’t mark the update as read');
 await expect(page.locator('.activity-unread')).toHaveCount(3);
 await page.unroute('**/api/activity/read-all', denyReceipt);
 await page.getByRole('button', {name:'Mark all as read', exact:true}).click();
 await expect(page.locator('.activity-unread')).toHaveCount(0);
 assert.equal((await feed()).unreadCount, 0);
 await page.getByRole('button', {name:'Unread', exact:true}).click();
 await expect(page.getByRole('heading', {name:'No unread updates', exact:true})).toBeVisible();
 await page.getByRole('button', {name:'All updates', exact:true}).click();
 await page.getByRole('button', {name:'Open site', exact:true}).first().click();
 await expect(page.getByRole('heading', {name:'Palm Court', exact:true})).toBeVisible();
 assert.equal(new URL(page.url()).hash, '#sites?site=hotel');
 console.log('PASS read status persists, failed receipts stay unread, slow polls cannot restore old unread counts, and links open the exact site');

 // A delayed owner response cannot populate a newly signed-in manager's screen.
 await page.getByRole('button', {name:'Manager activity, 0 unread updates', exact:true}).click();
 await expect(page.getByRole('heading', {name:'Manager activity', exact:true})).toBeVisible();
 const stale = await holdNextRead();
 await page.getByRole('button', {name:'Refresh', exact:true}).click(); await stale.received;
 await page.getByRole('button', {name:'Open account settings', exact:true}).click();
 await page.getByRole('button', {name:'Sign out', exact:true}).click();
 await expect(page.getByRole('heading', {name:'Welcome back.', exact:true})).toBeVisible();
 await page.getByRole('combobox').selectOption('manager');
 await page.getByLabel('Password', {exact:true}).fill('inbox-manager-test');
 await page.getByRole('button', {name:'Enter your workspace', exact:true}).click();
 await expect(page.locator('.app-shell')).toBeVisible();
 stale.release(); await stale.cleanup();
 await expect(page.getByRole('button', {name:/Manager activity,/})).toHaveCount(0);
 await page.evaluate(()=>{location.hash='activity';});
 await expect(page.getByRole('heading', {name:'This area belongs to the owner', exact:true})).toBeVisible();
 await expect(page.locator('.activity-card')).toHaveCount(0);
 assert.deepEqual(errors, []);
 console.log('PASS sign-out clears the inbox and late owner responses cannot leak activity into a manager session');
} finally {
 await browser.close(); await vite.close(); await new Promise(resolve=>server.close(resolve));
 store.close(); rmSync(dataDir,{recursive:true,force:true});
}
