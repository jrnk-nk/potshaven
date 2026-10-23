// Real-browser clickjacking check against the production HTML and API server.
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createApp} from '../server/app.js';
import {createStore} from '../server/store.js';

const dataDir = mkdtempSync(join(tmpdir(), 'potshaven-framing-'));
const store = createStore(join(dataDir, 'workspace.db'), {seed: false});
const app = createApp({store, dataDir, ownerPassword: 'isolated-owner', managerPassword: 'isolated-manager', imageKey: ''});
const workspace = app.listen(0, '127.0.0.1');
await once(workspace, 'listening');
const target = `http://127.0.0.1:${workspace.address().port}`;
const hostile = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><body><h1>Untrusted site</h1><iframe title="Embedded workspace" src="${target}/"></iframe></body></html>`);
}).listen(0, '127.0.0.1');
await once(hostile, 'listening');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.goto(target);
  await expect(page.getByRole('heading', {name: 'Welcome back.', exact: true})).toBeVisible();
  const response = await page.request.get(`${target}/api/state`);
  assert.equal(response.status(), 401);
  assert.equal(response.headers()['x-frame-options'], 'DENY');
  const framingBlocked = page.waitForEvent('console', {predicate: message => /frame-ancestors|X-Frame-Options/.test(message.text()), timeout: 10000});
  await page.goto(`http://127.0.0.1:${hostile.address().port}`);
  const diagnostic = await framingBlocked;
  assert.match(diagnostic.text(), /violates|refused|deny/i);
  await expect(page.getByRole('heading', {name: 'Untrusted site'})).toBeVisible();
  await expect(page.frameLocator('iframe').locator('.login-screen')).toHaveCount(0);
  console.log('PASS direct sign-in works while an untrusted site cannot embed the workspace');
} finally {
  await browser.close();
  await new Promise(resolve => hostile.close(resolve));
  await new Promise(resolve => workspace.close(resolve));
  store.close();
  rmSync(dataDir, {recursive: true, force: true});
}
