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
  response=await fetch(server.url+'/api/index?__potshaven_path=/api/inventory',{method:'POST',headers,body:JSON.stringify({name:'Supabase plant',quantity:5,category:'Plants',image:png,cost:20})});assert.equal(response.status,201);const plant=await response.json();assert.match(plant.image,/^\/media\/uploads\//);
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
