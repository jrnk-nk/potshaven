import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, readdir, rm, stat, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBackup, databaseEnvironment, decryptBackup, validateOutput} from '../scripts/backup-workspace.mjs';

const passphrase = 'isolated-test-strong-passphrase-only';
const database = 'postgresql://test-user:fake%23password@db.example.test:5432/postgres?sslmode=disable';
async function fixture(t, code) {
  const root = await mkdtemp(join(tmpdir(), 'potshaven-backup-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const repoRoot = join(root, 'repository'), outputDir = join(root, 'private');
  await mkdir(repoRoot); await mkdir(outputDir);
  const executable = join(root, 'fake-pg-dump');
  await writeFile(executable, `#!${process.execPath}\n${code}\n`, {mode: 0o700});
  return {root, repoRoot, outputDir, env: {PATH: process.env.PATH, POTSHAVEN_BACKUP_DATABASE_URL: database, POTSHAVEN_BACKUP_PASSPHRASE: passphrase, POTSHAVEN_PG_DUMP: executable}};
}

test('backup encrypts a complete archive, excludes secrets from arguments, and decrypts after authentication', async t => {
  const payload = Buffer.from('PGDMP\x01private records\0photos\0activity\0assistant history\0settings');
  const context = await fixture(t, `import {writeFileSync} from 'node:fs'; writeFileSync(new URL('./client-observed.json', import.meta.url), JSON.stringify({args: process.argv.slice(2), env: process.env})); process.stdout.write(Buffer.from(${JSON.stringify(payload.toString('base64'))}, 'base64'));`);
  const {root, repoRoot, outputDir, env} = context;
  env.OPENAI_API_KEY = 'must-not-reach-pg-dump'; env.APP_OWNER_PASSWORD = 'also-not-needed';
  const output = join(outputDir, 'company.phbackup');
  await createBackup({output, env, repoRoot});
  const encrypted = await readFile(output);
  assert.equal(encrypted.includes(Buffer.from('private records')), false);
  assert.equal(encrypted.includes(Buffer.from('assistant history')), false);
  const observed = JSON.parse(await readFile(join(root, 'client-observed.json'), 'utf8'));
  assert.deepEqual(observed.args, ['--format=custom', '--schema=potshaven_private', '--no-password', '--lock-wait-timeout=30s']);
  assert.equal(observed.env.PGPASSWORD, 'fake#password');
  assert.equal(observed.env.PGSSLMODE, 'verify-full');
  assert.equal(observed.env.PGOPTIONS, '-c default_transaction_read_only=on');
  for (const secret of ['DATABASE_URL', 'POTSHAVEN_BACKUP_DATABASE_URL', 'POTSHAVEN_BACKUP_PASSPHRASE', 'OPENAI_API_KEY', 'APP_OWNER_PASSWORD']) assert.equal(observed.env[secret], undefined);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  const plain = join(outputDir, 'restored.dump');
  await decryptBackup({input: output, output: plain, env, repoRoot});
  assert.deepEqual(await readFile(plain), payload);
  assert.equal((await stat(plain)).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(outputDir)).sort(), ['company.phbackup', 'restored.dump']);
});

test('wrong passphrases, corrupted tags and truncated backups never publish plaintext or leave temporary files', async t => {
  const {repoRoot, outputDir, env} = await fixture(t, `process.stdout.write('PGDMP-private-company-data');`);
  const original = join(outputDir, 'original.phbackup');
  await createBackup({output: original, env, repoRoot});
  const encrypted = await readFile(original);
  const modified = Buffer.from(encrypted); modified[modified.length - 1] ^= 1;
  const cases = [
    {name: 'wrong', bytes: encrypted, password: 'a-different-password-kept-private'},
    {name: 'changed', bytes: modified, password: passphrase},
    {name: 'truncated', bytes: encrypted.subarray(0, encrypted.length - 10), password: passphrase},
    {name: 'short', bytes: encrypted.subarray(0, 8), password: passphrase},
  ];
  for (const item of cases) {
    const input = join(outputDir, `${item.name}.phbackup`), output = join(outputDir, `${item.name}.dump`);
    await writeFile(input, item.bytes);
    await assert.rejects(decryptBackup({input, output, env: {...env, POTSHAVEN_BACKUP_PASSPHRASE: item.password}, repoRoot}), /authentication failed|incomplete/);
    await assert.rejects(stat(output), {code: 'ENOENT'});
  }
  assert.equal((await readdir(outputDir)).some(name => name.startsWith('.potshaven-backup-') || name.endsWith('.dump')), false);
});

test('output validation rejects repository paths, symlink escapes and overwrite attempts', async t => {
  const {repoRoot, outputDir} = await fixture(t, '');
  await assert.rejects(validateOutput(join(repoRoot, 'private.dump'), repoRoot), /outside the repository/);
  await assert.rejects(validateOutput('relative.dump', repoRoot), /absolute/);
  const shortcut = join(outputDir, 'repository-link');
  await symlink(repoRoot, shortcut, 'dir');
  await assert.rejects(validateOutput(join(shortcut, 'private.dump'), repoRoot), /outside the repository/);
  const existing = join(outputDir, 'existing.dump');
  await writeFile(existing, 'previous backup');
  await assert.rejects(validateOutput(existing, repoRoot), /already exists/);
  assert.equal(await readFile(existing, 'utf8'), 'previous backup');
});

test('failed or malformed pg_dump output is not published and its error text is not disclosed', async t => {
  const {repoRoot, outputDir, env} = await fixture(t, `process.stdout.write('PGDMP-partial'); process.stderr.write('private-password-secret'); process.exitCode = 1;`);
  const target = join(outputDir, 'failed.phbackup');
  await assert.rejects(createBackup({output: target, env, repoRoot}), error => {
    assert.doesNotMatch(error.message, /private-password-secret|fake.password|db.example.test/);
    return /did not complete/.test(error.message);
  });
  assert.deepEqual(await readdir(outputDir), []);
  await writeFile(env.POTSHAVEN_PG_DUMP, `#!${process.execPath}\nprocess.stdout.write('not an archive');`, {mode: 0o700});
  await assert.rejects(createBackup({output: target, env, repoRoot}), /custom-format/);
  assert.deepEqual(await readdir(outputDir), []);
});

test('backup validates private inputs and reports missing PostgreSQL tools safely', async t => {
  const {repoRoot, outputDir, env} = await fixture(t, '');
  const output = join(outputDir, 'company.phbackup');
  await assert.rejects(createBackup({output, repoRoot, env: {...env, POTSHAVEN_BACKUP_PASSPHRASE: ''}}), /passphrase/);
  assert.throws(() => databaseEnvironment({POTSHAVEN_BACKUP_DATABASE_URL: 'https://example.test/password-secret'}), /PostgreSQL/);
  assert.throws(() => databaseEnvironment({POTSHAVEN_BACKUP_DATABASE_URL: 'postgresql://user:pass@aws-0.test.pooler.supabase.com:6543/postgres'}), /Session pooler/);
  await assert.rejects(createBackup({output, repoRoot, env: {...env, POTSHAVEN_PG_DUMP: join(outputDir, 'missing-executable')}}), /pg_dump was not found/);
  assert.deepEqual(await readdir(outputDir), []);
});

test('a file created during backup is never overwritten at publication', async t => {
  const {repoRoot, outputDir, env} = await fixture(t, '');
  const output = join(outputDir, 'race.phbackup');
  await writeFile(env.POTSHAVEN_PG_DUMP, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(output)}, 'keep this existing backup'); process.stdout.write('PGDMP-new-archive');`, {mode: 0o700});
  await assert.rejects(createBackup({output, repoRoot, env}), {code: 'EEXIST'});
  assert.equal(await readFile(output, 'utf8'), 'keep this existing backup');
  assert.deepEqual(await readdir(outputDir), ['race.phbackup']);
});
