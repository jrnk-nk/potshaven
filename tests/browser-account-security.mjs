// Owner device controls with isolated mocked transport; no real sessions changed.
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
const state = {...Object.fromEntries(collections.map(name => [name, []])), settings: {companyName: 'PotsHavenGh'}, role: 'owner', demoMode: false, imageGenerationConfigured: false, assistantConfigured: false};
let posture = {checkedAt: '2026-10-26T14:00:00.000Z', disabled: false, sharedAccounts: true, passwordsDistinct: false, ownerPasswordStrong: false, managerPasswordStrong: true};
let checkFails = false, checkCalls = 0, revokeFails = false, signedOut = false, holdCheck, checkHeld, holdState, stateHeld;
const revocations = [];
try {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/state') {
      const snapshot = structuredClone(state), anonymous = signedOut;
      if (holdState) {stateHeld(); await holdState;}
      return route.fulfill({status: anonymous ? 401 : 200, json: anonymous ? {error: 'Please sign in to continue.'} : snapshot}).catch(() => {});
    }
    if (path === '/api/activity') return route.fulfill({json: {items: [], unreadCount: 0}});
    if (path === '/api/security') {
      checkCalls++;
      const snapshot = structuredClone(posture);
      if (holdCheck) {checkHeld(); await holdCheck;}
      return route.fulfill({status: checkFails ? 503 : 200, json: checkFails ? {error: 'Check unavailable.'} : snapshot}).catch(() => {});
    }
    if (path === '/api/security/sign-out-all') {
      assert.equal(route.request().method(), 'POST');
      const body = route.request().postDataJSON(); revocations.push(body);
      assert.deepEqual(Object.keys(body).sort(), ['password', 'role']);
      if (body.password !== 'isolated-owner-password') return route.fulfill({status: 403, json: {error: 'The owner password was not accepted. Please try again.'}});
      if (revokeFails) return route.fulfill({status: 503, json: {error: 'Device sign-out could not be confirmed. Check account access before trying again.'}});
      if (body.role === 'owner') signedOut = true;
      return route.fulfill({json: {ok: true, role: body.role, currentSessionRevoked: body.role === 'owner'}});
    }
    throw new Error(`Unexpected account-security request: ${path}`);
  });
  await page.goto(base + '/#settings');
  const card = page.getByRole('region', {name: 'Account protection', exact: true});
  await expect(card).toContainText('Not checked in this session.');
  assert.equal(checkCalls, 0);
  await card.getByRole('button', {name: 'Check account protection', exact: true}).click();
  await expect(card).toContainText('Use different owner and manager passwords');
  await expect(card).toContainText('Use at least 12 characters');
  await expect(card).toContainText('does not identify individual workers or add two-step verification');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  mkdirSync('/tmp/potshaven-checks', {recursive: true});
  await card.screenshot({path: '/tmp/potshaven-checks/account-security-mobile.png'});
  checkFails = true;
  await card.getByRole('button', {name: 'Check account protection', exact: true}).click();
  await expect(card.getByRole('alert')).toContainText('could not be checked');
  await expect(card.getByText('Use different owner and manager passwords', {exact: true})).toHaveCount(0);
  checkFails = false;
  console.log('PASS owner checks account posture explicitly; inaccurate or failed checks never retain success and mobile stays within the viewport');

  await card.getByRole('button', {name: 'Sign out all manager devices', exact: true}).click();
  let dialog = page.getByRole('dialog', {name: 'Sign out all manager devices?', exact: true});
  const confirm = dialog.getByRole('button', {name: 'Confirm device sign-out', exact: true});
  await expect(confirm).toBeDisabled(); assert.equal(revocations.length, 0);
  await dialog.getByLabel('Confirm owner password').fill('wrong-password');
  await confirm.click();
  await expect(dialog.getByRole('alert')).toContainText('owner password was not accepted');
  await expect(dialog.getByLabel('Confirm owner password')).toHaveValue('');
  assert.equal(revocations.length, 1);
  await dialog.getByLabel('Confirm owner password').fill('isolated-owner-password');
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toContainText('All manager devices have been signed out.');
  await expect(page.getByRole('heading', {name: 'Your company, your touch', exact: true})).toBeVisible();
  assert.equal(revocations.length, 2);
  assert.ok(!await page.evaluate(() => JSON.stringify({...localStorage, ...sessionStorage}).includes('isolated-owner-password')));
  console.log('PASS manager device sign-out requires owner password, clears entered credentials and preserves the owner workspace');

  revokeFails = true;
  await card.getByRole('button', {name: 'Sign out all manager devices', exact: true}).click();
  dialog = page.getByRole('dialog', {name: 'Sign out all manager devices?', exact: true});
  await dialog.getByLabel('Confirm owner password').fill('isolated-owner-password');
  await dialog.getByRole('button', {name: 'Confirm device sign-out', exact: true}).click();
  await expect(dialog.getByRole('alert')).toContainText('could not be confirmed');
  await expect(dialog.getByLabel('Confirm owner password')).toHaveValue('');
  await expect(card.getByText('All manager devices have been signed out.', {exact: false})).toHaveCount(0);
  const failures = revocations.length;
  await page.waitForTimeout(150);
  assert.equal(revocations.length, failures, 'An uncertain device sign-out cannot be automatically replayed.');
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).click(); revokeFails = false;
  console.log('PASS unconfirmed sign-out shows a recoverable warning without claiming success or retrying the mutation');

  let releaseState;
  holdState = new Promise(resolve => {releaseState = resolve;});
  const waitingState = new Promise(resolve => {stateHeld = resolve;});
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); await waitingState;
  await card.getByRole('button', {name: 'Sign out all owner devices', exact: true}).click();
  dialog = page.getByRole('dialog', {name: 'Sign out all owner devices?', exact: true});
  await expect(dialog).toContainText('also signs you out of this device');
  await dialog.getByLabel('Confirm owner password').fill('isolated-owner-password');
  await dialog.getByRole('button', {name: 'Confirm device sign-out', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Enter your workspace'})).toBeVisible();
  await expect(card).toHaveCount(0);
  releaseState(); holdState = undefined;
  await page.waitForTimeout(150);
  await expect(page.getByRole('button', {name: 'Enter your workspace'})).toBeVisible();
  console.log('PASS owner device revocation clears private UI immediately and a stale workspace read cannot reopen it');

  signedOut = false; await page.reload();
  await expect(card).toBeVisible();
  let releaseCheck;
  holdCheck = new Promise(resolve => {releaseCheck = resolve;});
  const waitingCheck = new Promise(resolve => {checkHeld = resolve;});
  await card.getByRole('button', {name: 'Check account protection', exact: true}).click(); await waitingCheck;
  state.role = 'manager';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('heading', {name: 'Your account', exact: true})).toBeVisible();
  releaseCheck(); holdCheck = undefined;
  await expect(card).toHaveCount(0);
  const beforeReload = checkCalls;
  await page.reload(); await expect(page.getByRole('heading', {name: 'Your account', exact: true})).toBeVisible();
  assert.equal(checkCalls, beforeReload);
  console.log('PASS manager account cannot open owner security tools and late owner posture responses are discarded');

  state.role = 'owner'; state.demoMode = true; posture = {...posture, disabled: true};
  await page.reload();
  await expect(card.getByRole('button', {name: 'Sign out all manager devices', exact: true})).toBeDisabled();
  await expect(card.getByRole('button', {name: 'Sign out all owner devices', exact: true})).toBeDisabled();
  await card.getByRole('button', {name: 'Check account protection', exact: true}).click();
  await expect(card).toContainText('demonstration workspace does not use private account protection');
  assert.deepEqual(errors, []);
  console.log('PASS demo workspace does not pretend device revocation or private account protection is enabled');
} finally {await browser.close(); await vite.close();}
