import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applySecurityHeaders, securityHeaders, strictTransportSecurity} from './security-headers.js';
import {createApp} from './app.js';
import {createStore} from './store.js';

test('static Vercel documents retain the same browser protections as server responses', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rule = config.headers.find(rule => rule.source === '/(.*)');
  assert.ok(rule, 'The static HTML shell also needs framing and MIME protections.');
  const headers = Object.fromEntries(rule.headers.map(header => [header.key, header.value]));
  for (const [key, value] of Object.entries(securityHeaders)) assert.equal(headers[key], value);
  assert.equal(headers['Strict-Transport-Security'], strictTransportSecurity);
  assert.equal(headers['Content-Security-Policy'].includes('frame-ancestors \'none\''), true);
  assert.equal(headers['Content-Security-Policy'].includes('object-src \'none\''), true);
  assert.equal(/camera=/.test(headers['Permissions-Policy']), false, 'The camera photo flow remains available.');
});

test('security headers reject framing without forcing HTTPS onto local development', async t => {
  const server = createServer((req, res) => {
    res.setHeader('X-Powered-By', 'fixture');
    applySecurityHeaders(req, res, {production: req.url.startsWith('/production')});
    res.end('protected');
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [path, forwarded, expected] of [
    ['/local', '', null],
    ['/local', 'https', null],
    ['/production', '', null],
    ['/production', 'https', strictTransportSecurity],
  ]) {
    const response = await fetch(origin + path, {headers: forwarded ? {'X-Forwarded-Proto': forwarded} : {}});
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'same-origin');
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('strict-transport-security'), expected);
  }
});

test('malformed and oversized JSON retain security and no-store headers before authentication', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-parser-headers-'));
  const store = createStore(join(directory, 'workspace.db'), {seed: false});
  const app = createApp({store, dataDir: directory, serveClient: false, ownerPassword: 'isolated-owner', managerPassword: 'isolated-manager', imageKey: ''});
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
    rmSync(directory, {recursive: true, force: true});
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const before = store.state();
  for (const [body, status] of [
    ['{"role":"owner",', 400],
    [JSON.stringify({padding: 'x'.repeat(12 * 1024 * 1024)}), 413],
  ]) {
    const response = await fetch(origin + '/api/auth/login', {
      method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin}, body,
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-powered-by'), null);
    for (const [name, value] of Object.entries(securityHeaders)) assert.equal(response.headers.get(name), value);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.deepEqual(store.state(), before, 'Rejected request bodies must not change company records.');
});
