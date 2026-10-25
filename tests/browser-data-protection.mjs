// Owner protection status reflects verified API facts; no provider account or paid calls.
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {existsSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vite = await createServer({configFile: false, root, plugins: [react()], logLevel: 'error', server: {host: '127.0.0.1', port: 0}});
await vite.listen();
const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox']});
const page = await browser.newPage({viewport: {width: 390, height: 844}});
page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const collections = ['places','jobs','inventory','stockMovements','workers','vehicles','contracts','payments','expenses','purchaseRequests','equipment','issues','careGuides','designs'];
const state = {...Object.fromEntries(collections.map(name => [name, []])), settings: {companyName: 'PotsHavenGh'}, role: 'owner', demoMode: false, imageGenerationConfigured: false, assistantConfigured: true};
const healthy = {checkedAt: '2026-10-23T17:24:00.000Z', storage: 'postgres', database: 'connected', durableMedia: true, rls: {enabled: true, protectedTables: 4, totalTables: 4, browserAccessBlocked: true}, backups: 'unverified'};
let report = healthy, responseStatus = 200, calls = 0, hold, held;
let providerCalls = 0, providerFails = false;
try {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if(path === '/api/state')return route.fulfill({json: state});
    if(path === '/api/activity')return route.fulfill({json: {items: [], unreadCount: 0}});
    if(path === '/api/readiness/assistant') {
      providerCalls++;
      assert.equal(route.request().method(), 'POST');
      return route.fulfill({status: providerFails ? 502 : 200, json: providerFails ? {error: 'The assistant connection could not be verified.'} : {ok: true, checkedAt: healthy.checkedAt, check: 'assistant-response'}});
    }
    if(path === '/api/data-protection') {
      calls++;
      const snapshot = structuredClone(report);
      if(hold) {held(); await hold;}
      return route.fulfill({status: responseStatus, json: snapshot}).catch(()=>{});
    }
    throw new Error(`Unexpected data-protection request: ${path}`);
  });
  await page.goto(base + '/#settings');
  const card = page.getByRole('region', {name: 'Your saved workspace', exact: true});
  await expect(card).toBeVisible();
  await expect(card).toContainText('Not checked yet.');
  assert.equal(calls, 0);
  await card.getByRole('button', {name: 'Check saved workspace', exact: true}).click();
  await expect(card).toContainText('Connected PostgreSQL database');
  await expect(card).toContainText('Stored in the connected database');
  await expect(card).toContainText('Enabled on all 4 private tables');
  await expect(card).toContainText('Blocked for public app roles');
  await expect(card).toContainText('cannot verify your backup schedule');
  await expect(card).toContainText('Saved assistant conversations');
  assert.equal(await card.getByRole('link', {name: 'Open Supabase'}).getAttribute('href'), 'https://supabase.com/dashboard');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1));
  mkdirSync('/tmp/potshaven-checks', {recursive: true});
  await card.screenshot({path: '/tmp/potshaven-checks/data-protection-mobile.png'});
  console.log('PASS owner verifies durable records/photos and RLS facts without inventing backup guarantees; status fits mobile');

  report = {error: 'Injected outage'}; responseStatus = 503;
  await card.getByRole('button', {name: 'Check again', exact: true}).click();
  await expect(card.getByRole('alert')).toContainText('couldn’t verify');
  await expect(card.getByText('Enabled on all 4 private tables', {exact: true})).toHaveCount(0);
  responseStatus = 200; report = {...healthy, rls: {...healthy.rls, enabled: false, protectedTables: 3, browserAccessBlocked: false}};
  await card.getByRole('button', {name: 'Check saved workspace', exact: true}).click();
  await expect(card.getByText('Needs administrator review', {exact: true})).toHaveCount(2);
  report = {...healthy, storage: 'sqlite', durableMedia: false, rls: null};
  await card.getByRole('button', {name: 'Check again', exact: true}).click();
  await expect(card).toContainText('Local workspace database');
  await expect(card).toContainText('Not applicable to this local workspace');
  await expect(card.getByText('Stored in the connected database', {exact: true})).toHaveCount(0);
  console.log('PASS failed checks clear stale assurances, incomplete RLS is flagged, and local storage is identified honestly');

  const assistantCheck = page.getByRole('region', {name: 'Assistant connection', exact: true});
  await expect(assistantCheck).toContainText('Not checked in this session.');
  assert.equal(providerCalls, 0, 'Opening settings must not cause a paid assistant check.');
  await assistantCheck.getByRole('button', {name: 'Check assistant connection', exact: true}).click();
  await expect(assistantCheck).toContainText('Assistant responded successfully.');
  assert.equal(providerCalls, 1);
  providerFails = true;
  await assistantCheck.getByRole('button', {name: 'Check assistant connection', exact: true}).click();
  await expect(assistantCheck.getByRole('alert')).toContainText('could not be verified');
  await expect(assistantCheck.getByText(/Assistant responded successfully/)).toHaveCount(0);
  console.log('PASS assistant connection check runs only on owner request and a failed recheck clears the earlier success');

  let release;
  hold = new Promise(resolve => {release = resolve;});
  const waiting = new Promise(resolve => {held = resolve;});
  report = healthy;
  await card.getByRole('button', {name: 'Check again', exact: true}).click();
  await waiting;
  state.role = 'manager';
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('heading', {name: 'Your account', exact: true})).toBeVisible();
  release(); hold = undefined;
  await expect(page.getByRole('region', {name: 'Your saved workspace', exact: true})).toHaveCount(0);
  await expect(page.getByRole('region', {name: 'Assistant connection', exact: true})).toHaveCount(0);
  const callsBefore = calls;
  await page.reload();
  await expect(page.getByRole('heading', {name: 'Your account', exact: true})).toBeVisible();
  assert.equal(calls, callsBefore, 'Manager account never asks for owner protection data.');
  assert.deepEqual(errors, []);
  console.log('PASS manager cannot access the owner protection panel and late responses are discarded after an account change');
} finally {await browser.close(); await vite.close();}
