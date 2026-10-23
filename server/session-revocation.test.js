import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import postgres from 'postgres';
import {PGlite} from '@electric-sql/pglite';
import {createStore} from './store.js';
import {createPostgresStore} from './postgres-store.js';
import {createApp} from './app.js';
import {createMediaStorage} from './media-storage.js';

const secret = 'isolated-session-revocation-secret';
const passwords = {owner: 'isolated-session-owner', manager: 'isolated-session-manager'};
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=';
async function fixture(t, backend) {
 const directory = mkdtempSync(join(tmpdir(), 'potshaven-session-revoke-'));
 let database, driver, query;
 const stores = [];
 if (backend === 'postgres') {
  database = new PGlite();
  driver = postgres('postgresql://fixture:fixture@unused.invalid/fixture', {prepare: false});
  query = async (sql, parameters = []) => database.query(sql, parameters.map((value, index) => value !== null && new RegExp(`\\$${index + 1}::jsonb\\b`).test(sql) ? driver.options.serializers[3802](value) : value));
 }
 const reopen = async (overrides = {}) => {
  const store = backend === 'postgres' ? await createPostgresStore('', {query, ...overrides}) : createStore(join(directory, 'workspace.db'), {seed: false});
  stores.push(store);return store;
 };
 const store = await reopen();
 const metadata = async () => backend === 'postgres' ? (await database.query("SELECT key, value FROM potshaven_private.metadata WHERE key LIKE 'session-revoked:%'")).rows : store.db.prepare("SELECT key, value FROM metadata WHERE key LIKE 'session-revoked:%'").all().map(row=>({...row,value:JSON.parse(row.value)}));
 t.after(async () => {for (const item of stores) await item.close();await driver?.end({timeout:0});await database?.close();rmSync(directory,{recursive:true,force:true});});
 return {store, reopen, metadata, directory, query};
}
async function serve(t, store, directory) {
 const app = createApp({store,dataDir:directory,serveClient:false,sessionSecret:secret,ownerPassword:passwords.owner,managerPassword:passwords.manager,imageKey:'',...(store.putMedia?{mediaStorage:createMediaStorage(store)}:{})});
 const server = await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base = `http://127.0.0.1:${server.address().port}`;
 const request = (path, cookie, method='GET', body, headers={}) => fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 const login = async role => {const result=await request('/api/auth/login',null,'POST',{role,password:passwords[role]});assert.equal(result.status,200);return result.headers.get('set-cookie').split(';')[0];};
 return {request,login,base};
}
for (const backend of ['sqlite','postgres']) {
 test(`${backend} session revocations persist, expire, and contain only opaque digests and expiry`,async t=>{
  const {store,reopen,metadata}=await fixture(t,backend);
  const key='a'.repeat(64), other='b'.repeat(64), now=1000;
  assert.equal(await store.isSessionRevoked(key,now),false);
  await store.revokeSession(key,5000,now);
  await store.revokeSession(key,4000,now);
  const next=await reopen();
  assert.equal(await next.isSessionRevoked(key,4999),true);
  assert.equal(await next.isSessionRevoked(key,5000),false);
  assert.deepEqual(await metadata(),[{key:`session-revoked:${key}`,value:{expiresAt:5000}}]);
  await next.revokeSession(other,9000,5000);
  assert.deepEqual(await metadata(),[{key:`session-revoked:${other}`,value:{expiresAt:9000}}]);
  for(const args of [['raw-cookie-value',6000,now],[key,NaN,now],[key,now,now],[key,9000,-1]])await assert.rejects(async()=>store.revokeSession(...args),/Invalid session reference/);
  await assert.rejects(async()=>store.isSessionRevoked('cookie',now),/Invalid session reference/);
 });
 test(`${backend} logout rejects cookie replay across instances without ending other devices or roles`,async t=>{
  const {store,reopen,directory,metadata}=await fixture(t,backend);
  const first=await serve(t,store,directory);
  const owner=await first.login('owner'), otherOwner=await first.login('owner'), manager=await first.login('manager');
  assert.notEqual(owner,otherOwner,'Each sign-in has a random nonce even within the same clock tick.');
  const nonce = cookie => JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[0], 'base64url')).nonce;
  assert.match(nonce(owner), /^[a-f0-9-]{36}$/);assert.notEqual(nonce(owner),nonce(otherOwner));
  const created=await first.request('/api/inventory',owner,'POST',{name:'Private plant',category:'Plants',quantity:4,image:png});
  assert.equal(created.status,201);const item=await created.json();
  const logout=await first.request('/api/auth/logout',owner,'POST');
  assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/);
  const cold=await serve(t,await reopen(),directory);
  for(const path of ['/api/state',item.image,'/api/activity'])assert.equal((await cold.request(path,owner)).status,401,`Revoked cookie cannot access ${path}`);
  assert.equal((await cold.request('/api/state',otherOwner)).status,200);
  assert.equal((await cold.request('/api/state',manager)).status,200);
  assert.equal((await cold.request('/api/activity',manager)).status,403);
  assert.equal((await cold.request(item.image,manager)).status,200,'Approved manager media remains usable.');
  assert.equal((await cold.request('/api/state',owner+'.suffix')).status,401,'Appending cookie segments cannot change its revocation digest.');
  assert.equal((await cold.request('/api/auth/logout',owner,'POST')).status,200,'Sign-out is idempotent.');
  const records=await metadata();assert.equal(records.length,1);assert.match(records[0].key,/^session-revoked:[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(records[0].value),['expiresAt']);
  assert.ok(!JSON.stringify(records).includes(owner));assert.ok(!JSON.stringify(records).includes(passwords.owner));
 });
}
test('revocation read/write failures fail closed without claiming sign-out or exposing provider details',async t=>{
 const {store,directory}=await fixture(t,'sqlite');const app=await serve(t,store,directory);const cookie=await app.login('owner');
 const read=store.isSessionRevoked.bind(store), write=store.revokeSession.bind(store);
 const failure=Object.assign(new Error('private-db-password-and-host'),{code:'CONNECTION_CLOSED'});
 store.isSessionRevoked=async()=>{throw failure;};
 for(const path of ['/api/state','/api/auth/logout']){
  const result=await app.request(path,cookie,path.endsWith('logout')?'POST':'GET');assert.equal(result.status,503);assert.equal(result.headers.get('set-cookie'),null);assert.ok(!(await result.text()).includes('private-db-password'));
 }
 store.isSessionRevoked=read;store.revokeSession=async()=>{throw failure;};
 let result=await app.request('/api/auth/logout',cookie,'POST');assert.equal(result.status,503);assert.equal(result.headers.get('set-cookie'),null);
 assert.equal((await app.request('/api/state',cookie)).status,200,'Failed persistence did not falsely record sign-out.');
 store.revokeSession=write;assert.equal((await app.request('/api/auth/logout',cookie,'POST')).status,200);assert.equal((await app.request('/api/state',cookie)).status,401);
});
test('legacy signed cookies can be revoked and cross-origin logout cannot revoke a live session',async t=>{
 const {store,directory}=await fixture(t,'sqlite');const app=await serve(t,store,directory);
 const signingKey=createHmac('sha256',secret).update(JSON.stringify(passwords)).digest();
 const payload=Buffer.from(JSON.stringify({role:'owner',expires:Date.now()+3600000})).toString('base64url');
 const signature=createHmac('sha256',signingKey).update(payload).digest('hex');const cookie=`potshaven_session=${payload}.${signature}`;
 assert.equal((await app.request('/api/state',cookie)).status,200);
 assert.equal((await app.request('/api/auth/logout',cookie,'POST',undefined,{Origin:'https://unrelated.invalid'})).status,403);
 assert.equal((await app.request('/api/state',cookie)).status,200);
 assert.equal((await app.request('/api/auth/logout',cookie,'POST')).status,200);
 assert.equal((await app.request('/api/state',cookie)).status,401);
 const expiredPayload=Buffer.from(JSON.stringify({role:'owner',expires:Date.now()-1000})).toString('base64url');
 const expiredSignature=createHmac('sha256',signingKey).update(expiredPayload).digest('hex');
 store.isSessionRevoked=()=>{throw new Error('Expired cookies must not require database verification.');};
 assert.equal((await app.request('/api/state',`potshaven_session=${expiredPayload}.${expiredSignature}`)).status,401);
});
test('an interrupted PostgreSQL revocation response never repeats a committed write',async t=>{
 const {reopen,query,store}=await fixture(t,'postgres');let armed=false,writes=0;
 const unstable=await reopen({query:async(sql,parameters)=>{const result=await query(sql,parameters);if(armed&&sql.startsWith('WITH expired AS')){writes++;throw Object.assign(new Error('lost response after commit'),{code:'CONNECTION_CLOSED'});}return result;}});
 armed=true;const key='c'.repeat(64), now=1000;
 await assert.rejects(unstable.revokeSession(key,9000,now),error=>error.code==='CONNECTION_CLOSED');
 assert.equal(writes,1);assert.equal(await store.isSessionRevoked(key,now),true);
});
