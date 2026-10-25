#!/usr/bin/env node
// An operator tool, never imported by the application or served by Vercel.
import {createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {chmod, link, lstat, mkdtemp, open, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {Readable, Transform} from 'node:stream';
import {promisify} from 'node:util';
import {getCACertificates} from 'node:tls';
import {SUPABASE_DATABASE_CA_CERTIFICATES} from '../server/supabase-ca.js';

const scrypt = promisify(scryptCallback);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const magic = Buffer.from('POTSHAVEN-BACKUP\0\x01', 'utf8');
const headerLength = magic.length + 16 + 12;
const tagLength = 16;
const inside = (root, path) => {const part = relative(root, path); return part === '' || !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && part !== '..' && !isAbsolute(part);};

function passphrase(env) {
  const value = env.POTSHAVEN_BACKUP_PASSPHRASE;
  if (typeof value !== 'string' || value.length < 16 || value.length > 1024) throw new Error('Set POTSHAVEN_BACKUP_PASSPHRASE privately to a separate strong passphrase of 16–1,024 characters. Keep it in your password manager.');
  return value;
}

async function keyFor(value, salt) {
  return scrypt(value, salt, 32, {N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024});
}

export async function validateOutput(output, repoRoot = repository) {
  if (typeof output !== 'string' || !isAbsolute(output)) throw new Error('Choose an absolute output path outside the repository. Its parent directory must already exist.');
  const target = resolve(output);
  const [root, parent] = await Promise.all([realpath(repoRoot), realpath(dirname(target))]);
  if (inside(resolve(repoRoot), target) || inside(root, join(parent, basename(target)))) throw new Error('Backups and decrypted files must be stored outside the repository, including through symbolic links.');
  try {await lstat(target); throw new Error('The output already exists. Choose a new filename; existing backups are never overwritten.');}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  return join(parent, basename(target));
}

export function databaseEnvironment(env) {
  let url;
  try {url = new URL(env.POTSHAVEN_BACKUP_DATABASE_URL || env.DATABASE_URL || '');}
  catch {throw new Error('Set POTSHAVEN_BACKUP_DATABASE_URL privately to the PostgreSQL direct or session-pooler connection URL.');}
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password || !url.pathname.slice(1)) throw new Error('A complete PostgreSQL direct or session-pooler connection URL is required.');
  if (url.hostname.endsWith('.pooler.supabase.com') && url.port === '6543') throw new Error('Use the Supabase direct connection or Session pooler for backups, rather than the Transaction pooler on port 6543.');
  let values;
  try {
    values = {PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1))};
  } catch {throw new Error('The PostgreSQL connection URL contains invalid encoding.');}
  if (Object.values(values).some(value => /[\0\r\n]/.test(value))) throw new Error('The PostgreSQL connection URL contains an invalid value.');
  // Do not inherit application secrets, PGOPTIONS, connection services or a
  // weaker sslmode from the caller. Credentials are not command arguments.
  const inherited = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SystemRoot', 'WINDIR', 'TMPDIR'].filter(name => env[name]).map(name => [name, env[name]]));
  return {...inherited, ...values, PGSSLMODE: 'verify-full', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'potshaven-private-backup', PGOPTIONS: '-c default_transaction_read_only=on'};
}

async function staging(output, callback) {
  const directory = await mkdtemp(join(dirname(output), '.potshaven-backup-'));
  await chmod(directory, 0o700);
  try {return await callback(directory);}
  finally {await rm(directory, {recursive: true, force: true});}
}

async function publish(source, output) {
  // A same-filesystem hard link publishes atomically and refuses an existing
  // destination, unlike rename(). The source directory is private (0700).
  await link(source, output);
  return {output, bytes: (await stat(output)).size};
}

function customDumpCheck() {
  let prefix = Buffer.alloc(0), checked = false;
  return new Transform({
    transform(chunk, encoding, callback) {
      if (checked) return callback(null, chunk);
      prefix = Buffer.concat([prefix, chunk]);
      if (prefix.length < 5) return callback();
      if (!prefix.subarray(0, 5).equals(Buffer.from('PGDMP'))) return callback(new Error('The backup client did not return a PostgreSQL custom-format archive.'));
      checked = true; callback(null, prefix); prefix = Buffer.alloc(0);
    },
    flush(callback) {callback(checked ? undefined : new Error('The backup client returned an incomplete archive.'));},
  });
}

async function* encryptedBytes(file, start, end) {
  for (let position = start; position < end;) {
    const buffer = Buffer.alloc(Math.min(64 * 1024, end - position));
    const {bytesRead} = await file.read(buffer, 0, buffer.length, position);
    if (!bytesRead) throw new Error('The encrypted archive is incomplete.');
    position += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}

export async function createBackup({output, env = process.env, signal, repoRoot = repository}) {
  const password = passphrase(env);
  const childEnv = databaseEnvironment(env);
  const target = await validateOutput(output, repoRoot);
  return staging(target, async directory => {
    const trustPath = join(directory, 'database-roots.pem');
    const trust = env.POTSHAVEN_BACKUP_CA_FILE ? await readFile(env.POTSHAVEN_BACKUP_CA_FILE) : [...getCACertificates('default'), ...SUPABASE_DATABASE_CA_CERTIFICATES].join('\n');
    await writeFile(trustPath, trust, {mode: 0o600, flag: 'wx'});
    childEnv.PGSSLROOTCERT = trustPath;
    const salt = randomBytes(16), nonce = randomBytes(12);
    const header = Buffer.concat([magic, salt, nonce]);
    const key = await keyFor(password, salt);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    key.fill(0); cipher.setAAD(header);
    const temporary = join(directory, 'encrypted.partial');
    await writeFile(temporary, header, {mode: 0o600, flag: 'wx'});
    let child;
    try {
      child = spawn(env.POTSHAVEN_PG_DUMP || 'pg_dump', ['--format=custom', '--schema=potshaven_private', '--no-password', '--lock-wait-timeout=30s'], {env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], signal});
      child.stderr.resume(); // pg_dump errors may contain private host/user data.
      const completion = new Promise((accept, reject) => {
        child.once('error', error => reject(new Error(error.code === 'ENOENT' ? 'pg_dump was not found. Install PostgreSQL client tools matching the database server version, or set POTSHAVEN_PG_DUMP to its executable.' : 'The backup client could not run or was interrupted.')));
        child.once('close', code => code === 0 ? accept() : reject(new Error('pg_dump did not complete. Check the connection, TLS certificate, schema permissions and PostgreSQL client version. No backup was published.')));
      });
      const writing = pipeline(child.stdout, customDumpCheck(), cipher, createWriteStream(temporary, {flags: 'a', mode: 0o600}), {signal});
      try {await Promise.all([completion, writing]);}
      catch (error) {child.kill(); await Promise.allSettled([completion, writing]); throw error;}
      signal?.throwIfAborted();
      const file = await open(temporary, 'a');
      try {await file.write(cipher.getAuthTag()); await file.sync();} finally {await file.close();}
      return await publish(temporary, target);
    } finally {if (child && child.exitCode === null) child.kill();}
  });
}

export async function decryptBackup({input, output, env = process.env, signal, repoRoot = repository}) {
  const password = passphrase(env);
  if (typeof input !== 'string' || !isAbsolute(input)) throw new Error('Choose an absolute path for the encrypted input backup.');
  const target = await validateOutput(output, repoRoot);
  const source = await open(input, 'r');
  try {
    const info = await source.stat();
    if (!info.isFile() || info.size < headerLength + tagLength + 5) throw new Error('This backup file is incomplete or has an unsupported format.');
    const header = Buffer.alloc(headerLength), tag = Buffer.alloc(tagLength);
    await source.read(header, 0, header.length, 0);
    await source.read(tag, 0, tag.length, info.size - tagLength);
    if (!header.subarray(0, magic.length).equals(magic)) throw new Error('This backup file is incomplete or has an unsupported format.');
    const key = await keyFor(password, header.subarray(magic.length, magic.length + 16));
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(magic.length + 16));
    key.fill(0); decipher.setAAD(header); decipher.setAuthTag(tag);
    return await staging(target, async directory => {
      const temporary = join(directory, 'decrypted.partial');
      try {
        await pipeline(Readable.from(encryptedBytes(source, headerLength, info.size - tagLength)), decipher, customDumpCheck(), createWriteStream(temporary, {flags: 'wx', mode: 0o600}), {signal});
      } catch {throw new Error('Backup authentication failed or decryption was interrupted. Check the passphrase and the complete backup file. No decrypted archive was published.');}
      signal?.throwIfAborted();
      const file = await open(temporary, 'r+');
      try {await file.sync();} finally {await file.close();}
      return publish(temporary, target);
    });
  } finally {await source.close();}
}

const usage = `Usage:
  node scripts/backup-workspace.mjs backup --output /private/backups/company.phbackup
  node scripts/backup-workspace.mjs decrypt --input /private/backups/company.phbackup --output /private/restore/company.dump

Set POTSHAVEN_BACKUP_PASSPHRASE privately in the environment (16+ characters).
Backup also needs POTSHAVEN_BACKUP_DATABASE_URL, or DATABASE_URL, and pg_dump.
Outputs must be new absolute paths outside this repository. Decrypt never connects
to a database or restores over company data. See docs/DATA_PROTECTION.md.`;

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (!argv.length || argv.includes('--help')) {process.stdout.write(`${usage}\n`); return;}
  const [command, ...args] = argv;
  if (!['backup', 'decrypt'].includes(command) || args.length % 2 || args.some((value, index) => index % 2 === 0 && !['--output', ...(command === 'decrypt' ? ['--input'] : [])].includes(value))) throw new Error(usage);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index].slice(2);
    if (Object.hasOwn(options, name)) throw new Error(usage);
    options[name] = args[index + 1];
  }
  const controller = new AbortController();
  const interrupted = () => controller.abort();
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  try {
    const result = await (command === 'backup' ? createBackup : decryptBackup)({...options, env, signal: controller.signal});
    process.stdout.write(command === 'backup' ? `Encrypted workspace backup created (${result.bytes} bytes). Store its passphrase separately and test a restore in an isolated database.\n` : 'Archive authenticated and decrypted. This command did not restore a database. Protect and remove the plaintext archive after the isolated restore drill.\n');
  } finally {process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted);}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {process.stderr.write(`${error.message}\n`); process.exitCode = 1;});
}
