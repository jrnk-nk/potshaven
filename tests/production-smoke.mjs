// Exercises the actual built UI and authentication without touching company records.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {createApp} from '../server/app.js';
import {createStore} from '../server/store.js';
const dataDir=mkdtempSync(join(tmpdir(),'potshaven-production-'));
const store=createStore(join(dataDir,'check.db'),{seed:false});
const password=randomBytes(32).toString('hex');
const app=createApp({store,dataDir,ownerPassword:password,managerPassword:randomBytes(32).toString('hex'),imageKey:''});
const server=app.listen(0,'127.0.0.1');
try {
 await once(server,'listening');
 const origin=`http://127.0.0.1:${server.address().port}`;
 const document=await fetch(origin+'/');assert.equal(document.status,200);
 const html=await document.text();assert.match(html,/<div id="root">/);
 const script=html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];assert.ok(script,'Run npm run build before the production smoke check.');
 const asset=await fetch(origin+script);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
 assert.equal((await fetch(origin+'/api/state')).status,401);
 const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({role:'owner',password})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 const state=await fetch(origin+'/api/state',{headers:{Cookie:cookie}});const data=await state.json();assert.equal(data.role,'owner');assert.equal(data.jobs.length,0);assert.equal(data.places.length,0);assert.equal(data.imageGenerationConfigured,false);
 assert.equal((await fetch(origin+'/media/missing.png',{headers:{Cookie:cookie}})).status,404);
 console.log('PASS built UI and bundled assets served, private sign-in required, empty company workspace, missing media returns404');
} finally {await new Promise(resolve=>server.close(resolve));store.close();rmSync(dataDir,{recursive:true,force:true});}
