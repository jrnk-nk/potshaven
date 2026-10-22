import test from 'node:test';
import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer, connect, getCACertificates} from 'node:tls';
import {once} from 'node:events';
import {databaseTlsOptions} from './database-tls.js';
import {SUPABASE_DATABASE_CA_CERTIFICATES} from './supabase-ca.js';

const productionFingerprints = [
  '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
  '5F:9B:77:95:1A:7A:A1:30:3F:9B:58:EE:A9:BF:A8:9E:35:8C:FD:C1:5F:97:86:FF:10:D4:93:0A:72:2C:9A:E2',
];

test('both authentic Supabase production roots are retained through the CA rotation', () => {
  const certificates = SUPABASE_DATABASE_CA_CERTIFICATES.map(pem => new X509Certificate(pem));
  assert.deepEqual(certificates.map(cert => cert.fingerprint256).sort(), [...productionFingerprints].sort());
  for (const cert of certificates) {
    assert.equal(cert.ca, true, 'Bundled trust anchors must be CA certificates.');
    assert.equal(cert.issuer, cert.subject);
    assert.equal(cert.verify(cert.publicKey), true, 'Each production root must have a valid self-signature.');
    assert.ok(Date.parse(cert.validFrom) <= Date.now(), 'The root is not yet valid.');
    assert.ok(Date.parse(cert.validTo) > Date.now(), 'The root has expired and needs rotation.');
  }
});

test('Supabase database connections retain system trust and trust both production roots', () => {
  const systemTrust = getCACertificates('default');
  assert.ok(systemTrust.length > 0);
  for (const host of ['aws-0-eu-west-1.pooler.supabase.com', 'aws-1-us-east-1.pooler.supabase.com', 'db.abcdefghijklmnopqrst.supabase.co']) {
    const options = databaseTlsOptions(`postgresql://postgres:password@${host}:6543/postgres?sslmode=require`);
    assert.equal(options.rejectUnauthorized, true);
    assert.ok(Array.isArray(options.ca));
    for (const pem of [...systemTrust, ...SUPABASE_DATABASE_CA_CERTIFICATES]) {
      assert.ok(options.ca.includes(pem), 'System trust and each production root must be preserved.');
    }
  }
});

test('Supabase private roots are not added to unrelated or lookalike database hosts', () => {
  for (const host of [
    'localhost', 'db.example.com', 'pooler.supabase.com',
    'attackerpooler.supabase.com', 'aws-0-eu-west-1.pooler.supabase.com.attacker.test',
    'db.abcdefghijklmnopqrst.supabase.co.attacker.test', 'project.supabase.co',
    'db.project.supabase.com',
  ]) {
    const options = databaseTlsOptions(`postgresql://postgres:password@${host}:5432/postgres?sslmode=disable`);
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.ca, undefined, `${host} must use normal system trust without the Supabase private roots.`);
  }
});

test('real TLS handshakes reject untrusted certificates and incorrect hostnames', {timeout: 15000}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-tls-test-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const keyPath = join(directory, 'key.pem');
  const certPath = join(directory, 'certificate.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath,
    '-out', certPath, '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost',
  ], {stdio: 'ignore'});
  const certificate = readFileSync(certPath, 'utf8');
  const server = createServer({key: readFileSync(keyPath), cert: certificate}, socket => socket.end());
  server.on('tlsClientError', () => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const options = databaseTlsOptions('postgresql://postgres:password@aws-0-eu-west-1.pooler.supabase.com:6543/postgres');
  const handshake = overrides => new Promise((resolve, reject) => {
    const socket = connect({...options, host: '127.0.0.1', port: server.address().port, servername: 'localhost', ...overrides});
    socket.once('error', error => { socket.destroy(); reject(error); });
    socket.once('secureConnect', () => { socket.end(); resolve(); });
  });
  // Control: the fixture is a working, explicitly trusted certificate.
  await handshake({ca: [...options.ca, certificate]});
  await assert.rejects(handshake({}), error => ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(error.code));
  await assert.rejects(handshake({ca: [...options.ca, certificate], servername: 'incorrect.example.test'}), error => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID');
});
