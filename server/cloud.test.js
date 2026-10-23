import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createCloudHandler} from './cloud.js';
import {createPostgresStore} from './postgres-store.js';
import {PGlite} from '@electric-sql/pglite';

async function serve(handler) {
 const server=createServer(handler).listen(0,'127.0.0.1');
 await once(server,'listening');
 return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
const env={DATABASE_URL:'postgresql://test:test@localhost/test',APP_OWNER_PASSWORD:'test-owner-password',APP_MANAGER_PASSWORD:'test-manager-password'};

test('Vercel returns actionable JSON setup errors instead of pretending a static page is an API',async()=>{
 for(const [settings,code] of [[{},'DATABASE_NOT_CONFIGURED'],[{DATABASE_URL:'https://project.supabase.co'},'DATABASE_NOT_CONFIGURED'],[{DATABASE_URL:env.DATABASE_URL},'AUTH_NOT_CONFIGURED']]){
  const server=await serve(createCloudHandler({env:settings,connect:()=>{throw Error('must not connect before configuration');}}));
  try{const response=await fetch(server.url+'/api/state');assert.equal(response.status,503);assert.match(response.headers.get('content-type'),/json/);assert.equal((await response.json()).code,code);}finally{await server.close();}
 }
});

test('Vercel retains rewrite paths, uses durable PostgreSQL and authenticates owner/manager without local files',async()=>{
 const pg=new PGlite();
 const store=await createPostgresStore('',{query:async(sql,params=[])=>{const result=await pg.query(sql,params);return result.rows;},close:()=>pg.close()});
 let connections=0;
 const handler=createCloudHandler({env,connect:async()=>{connections++;return store;}});
 const server=await serve(handler);
 const headers={'Content-Type':'application/json',Origin:server.url};
 try{
  let response=await fetch(server.url+'/api/index?__potshaven_path=/api/state');assert.equal(response.status,401);
  response=await fetch(server.url+'/api/index?__potshaven_path=/api/auth/login',{method:'POST',headers,body:JSON.stringify({role:'owner',password:env.APP_OWNER_PASSWORD})});assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie').split(';')[0];headers.Cookie=cookie;
  response=await fetch(server.url+'/api/index?__potshaven_path=/api/state',{headers});let data=await response.json();assert.equal(data.role,'owner');assert.equal(data.places.length,0);assert.equal(data.settings.companyName,'PotsHavenGh');
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=';
  response=await fetch(server.url+'/api/index?__potshaven_path=/api/inventory',{method:'POST',headers,body:JSON.stringify({name:'Supabase plant',quantity:5,category:'Plants',image:png})});assert.equal(response.status,201);const plant=await response.json();assert.match(plant.image,/^\/media\/uploads\//);
  response=await fetch(server.url+'/api/index?__potshaven_path='+plant.image,{headers});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/png/);assert.match(response.headers.get('cache-control'),/private/);assert.ok((await response.arrayBuffer()).byteLength>20);
  response=await fetch(server.url+'/api/index?__potshaven_path='+plant.image);assert.equal(response.status,401);
  // A second function instance shares records, media and session signing secret.
  const other=await serve(createCloudHandler({env,connect:async()=>store}));
  try{response=await fetch(other.url+'/api/state',{headers:{Cookie:cookie}});data=await response.json();assert.equal(data.inventory[0].name,'Supabase plant');assert.equal(data.role,'owner');}finally{await other.close();}
  assert.equal(connections,1);
 }finally{await server.close();await store.close();}
});

test('failed Supabase initialization is safely retryable without leaking a connection string',async()=>{
 let attempts=0;
 const server=await serve(createCloudHandler({env,connect:async()=>{attempts++;throw new Error(env.DATABASE_URL);}}));
 try{
  for(let i=0;i<2;i++){const response=await fetch(server.url+'/api/state');const text=await response.text();assert.equal(response.status,503);assert.equal(JSON.parse(text).code,'DATABASE_UNAVAILABLE');assert.ok(!text.includes(env.DATABASE_URL));}
  assert.equal(attempts,2);
 }finally{await server.close();}
});

test('failed session initialization closes its pool and the next request can recover',async()=>{
 let connections=0,closed=0;
 const failure=Object.assign(new Error('private connection details'),{code:'CONNECTION_CLOSED'});
 const server=await serve(createCloudHandler({env,connect:async()=>{
  connections++;
  if(connections===1)return {getSessionSecret:async()=>{throw failure;},close:async()=>{closed++;throw new Error('private cleanup details');}};
  return {getSessionSecret:async()=> 'stable-test-session-secret',health:async()=>true,putMedia:async()=>{},getMedia:async()=>null,close:async()=>{closed++;}};
 }}));
 try{
  const failed=await fetch(server.url+'/api/health');
  assert.equal(failed.status,503);
  const body=await failed.text();assert.equal(JSON.parse(body).diagnostic,'DATABASE_CONNECTION_LOST');assert.ok(!body.includes('private'));
  assert.equal(closed,1,'failed initialization must release its pool even when cleanup rejects');
  const recovered=await fetch(server.url+'/api/health');assert.equal(recovered.status,200);assert.equal((await recovered.json()).database,'connected');
  const warm=await fetch(server.url+'/api/health');assert.equal(warm.status,200);
  assert.equal(connections,2,'the recovered app must be reused');assert.equal(closed,1,'a healthy pool must remain open');
 }finally{await server.close();}
});

test('database failures explain the corrective action without disclosing provider errors or credentials',async()=>{
 const privateDetail=`provider details: ${env.DATABASE_URL} secret-owner=${env.APP_OWNER_PASSWORD}`;
 const cases=[
  ['28P01',privateDetail,'AUTHENTICATION_FAILED',/password/i],
  ['XX000',`Tenant or user not found; ${privateDetail}`,'POOLER_PROJECT_NOT_FOUND',/pooler|project|username/i],
  ['ENOTFOUND',privateDetail,'DATABASE_HOST_NOT_FOUND',/host|address/i],
  ['CONNECT_TIMEOUT',privateDetail,'DATABASE_CONNECTION_TIMEOUT',/active|network|pooler/i],
  ['53300',privateDetail,'DATABASE_CAPACITY_LIMIT',/limit|capacity/i],
  ['SELF_SIGNED_CERT_IN_CHAIN',privateDetail,'DATABASE_TLS_ERROR',/certificate/i],
  ['42501',privateDetail,'DATABASE_ACCESS_DENIED',/permission|access|user/i],
  ['42601',privateDetail,'DATABASE_INITIALIZATION_FAILED',/initializ|setup/i],
  ['unexpected-secret-code',privateDetail,'UNKNOWN',/database/i],
 ];
 for(const [code,message,diagnostic,action] of cases){
  const error=Object.assign(new Error(message),{code});
  const server=await serve(createCloudHandler({env,connect:async()=>{throw error;}}));
  try{
   const response=await fetch(server.url+'/api/health');
   const text=await response.text();const data=JSON.parse(text);
   assert.equal(response.status,503);assert.equal(data.code,'DATABASE_UNAVAILABLE');
   assert.equal(data.diagnostic,diagnostic);assert.match(data.error,action);
   assert.ok(!text.includes(privateDetail));assert.ok(!text.includes(env.DATABASE_URL));assert.ok(!text.includes(env.APP_OWNER_PASSWORD));
   assert.ok(!text.includes('unexpected-secret-code'));
  }finally{await server.close();}
 }
});

test('database diagnostics recognize wrapped failures and tolerate circular causes',async()=>{
 const wrapped=new Error('private outer error',{cause:Object.assign(new Error('private inner error'),{code:'ETIMEDOUT'})});
 const circular=new Error(env.DATABASE_URL);circular.cause=circular;
 for(const [error,diagnostic] of [[wrapped,'DATABASE_CONNECTION_TIMEOUT'],[circular,'UNKNOWN']]){
  const server=await serve(createCloudHandler({env,connect:async()=>{throw error;}}));
  try{
   const response=await fetch(server.url+'/api/health');const text=await response.text();
   assert.equal(response.status,503);assert.equal(JSON.parse(text).diagnostic,diagnostic);
   assert.ok(!text.includes(env.DATABASE_URL));assert.ok(!text.includes('private'));
  }finally{await server.close();}
 }
});
