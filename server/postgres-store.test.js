import test, {before, beforeEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createPostgresStore} from './postgres-store.js';
import {nextOccurrence} from './store.js';
import {seedData} from './seed.js';
import {createCloudHandler} from './cloud.js';
import {createServer} from 'node:http';
import {once} from 'node:events';

let database,store;
const query=(text,parameters=[])=>database.query(text,parameters);
before(async()=>{
  database=new PGlite();
  store=await createPostgresStore('',{query});
});
beforeEach(async()=>{
  await database.exec("TRUNCATE potshaven_private.records RESTART IDENTITY; TRUNCATE potshaven_private.media; DELETE FROM potshaven_private.metadata WHERE key <> 'schemaVersion';");
  store=await createPostgresStore('',{query});
});
after(async()=>{await database?.close();});
async function stockFixture(){
  await store.put('inventory',{id:'plant-1',name:'Peace lily',category:'Plants',quantity:8,minStock:2,cost:75,unit:'plants'});
  await store.put('jobs',{id:'job-1',title:'Hotel planting',type:'Project',status:'Scheduled',crewIds:[],tasks:[]});
}

test('PostgreSQL starts with official company settings and no fictional operational records',async()=>{
  const state=await store.state();
  assert.deepEqual(state.settings,seedData().settings);
  for(const collection of ['places','jobs','inventory','workers','payments'])assert.deepEqual(state[collection],[]);
  await store.put('places',{id:'real-place',name:'Our actual client'});
  const restarted=await createPostgresStore('',{query,seed:true});
  assert.equal((await restarted.list('places')).length,1);
  assert.equal((await restarted.list('workers')).length,0);
});

test('PostgreSQL data, sessions and media stay private to the application schema',async()=>{
  await database.exec('CREATE ROLE potshaven_test_anon');
  const schema=(await query("SELECT has_schema_privilege('potshaven_test_anon', 'potshaven_private', 'USAGE') AS allowed")).rows[0];
  assert.equal(schema.allowed,false);
  const tables=(await query("SELECT table_schema,table_name FROM information_schema.tables WHERE table_name IN ('records','metadata','media') ORDER BY table_name")).rows;
  assert.equal(tables.length,3);
  assert.ok(tables.every(table=>table.table_schema==='potshaven_private'));
  const functionPermission=(await query("SELECT has_function_privilege('potshaven_test_anon', 'potshaven_private.stock(text,numeric,text,text,text,text,text,text)', 'EXECUTE') AS allowed")).rows[0];
  assert.equal(functionPermission.allowed,false);
  await database.exec('SET ROLE potshaven_test_anon');
  try{await assert.rejects(query('SELECT * FROM potshaven_private.records'),/permission denied/);}finally{await database.exec('RESET ROLE');}
});

test('PostgreSQL stock usage atomically deducts plants and records exact job cost',async()=>{
  await stockFixture();
  const result=await store.stock('plant-1',3,{jobId:'job-1',note:'Entrance beds',actor:'Manager'});
  assert.equal(result.item.quantity,5);
  assert.equal(result.movement.quantity,3);
  assert.equal(result.movement.totalCost,225);
  assert.equal(result.movement.jobId,'job-1');
  assert.equal(result.movement.actor,'Manager');
  assert.equal((await store.list('stockMovements')).length,1);
});

test('PostgreSQL concurrent usage cannot overspend stock or create a partial ledger',async()=>{
  await stockFixture();
  const results=await Promise.allSettled([store.stock('plant-1',6),store.stock('plant-1',6)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const rejected=results.find(result=>result.status==='rejected').reason;
  assert.equal(rejected.status,409);
  assert.match(rejected.message,/Only 2 plants available/);
  assert.equal((await store.get('inventory','plant-1')).quantity,2);
  assert.equal((await store.list('stockMovements')).length,1);
});

test('PostgreSQL ledger insertion failure rolls back an already updated stock balance',async()=>{
  await stockFixture();
  const first=await store.stock('plant-1',1);
  await assert.rejects(query('SELECT potshaven_private.stock($1,$2::numeric,$3,$4,$5,$6,$7,$8)',['plant-1',2,'use','','','Owner',first.movement.id,new Date().toISOString()]),/duplicate key/);
  assert.equal((await store.get('inventory','plant-1')).quantity,7);
  assert.equal((await store.list('stockMovements')).length,1);
});

test('PostgreSQL rejects invalid stock quantities, missing jobs and missing items',async()=>{
  await stockFixture();
  for(const quantity of [0,-1,'2',NaN,Infinity])await assert.rejects(store.stock('plant-1',quantity),/greater than zero/);
  await assert.rejects(store.stock('plant-1',1,{jobId:'absent-job'}),/existing job/);
  await assert.rejects(store.stock('absent-item',1),error=>error.status===404);
  assert.equal((await store.get('inventory','plant-1')).quantity,8);
  assert.equal((await store.list('stockMovements')).length,0);
});

test('PostgreSQL restocks and manual count adjustments preserve immutable history',async()=>{
  await stockFixture();
  assert.equal((await store.stock('plant-1',10,{type:'restock'})).item.quantity,18);
  await store.update('inventory','plant-1',{quantity:15},'Owner');
  const history=await store.list('stockMovements');
  assert.equal(history[1].type,'adjustment');
  assert.equal(history[1].change,-3);
  await assert.rejects(store.update('stockMovements',history[0].id,{quantity:999}),error=>error.status===403);
  await assert.rejects(store.remove('stockMovements',history[0].id),error=>error.status===403);
  await assert.rejects(store.put('stockMovements',{id:'manual'}),error=>error.status===403);
});

test('PostgreSQL completion creates one clean recurring visit across concurrent or repeated calls',async()=>{
  const scheduled=new Date();scheduled.setUTCDate(scheduled.getUTCDate()-3);
  const deadline=new Date(scheduled);deadline.setUTCDate(deadline.getUTCDate()+2);
  await store.put('jobs',{id:'weekly',title:'Weekly care',type:'Maintenance',status:'Scheduled',date:scheduled.toISOString().slice(0,10),deadline:deadline.toISOString().slice(0,10),recurrence:'Weekly',crewIds:['worker-1'],vehicleId:'vehicle-1',placeId:'place-1',tasks:[{text:'Water beds',done:true},'Trim hedges'],photos:['previous-completion-photo']});
  const results=await Promise.all([store.update('jobs','weekly',{status:'Completed'}),store.update('jobs','weekly',{status:'Completed'})]);
  assert.equal(results[0].nextJobId,results[1].nextJobId);
  const child=await store.get('jobs',results[0].nextJobId);
  assert.equal(child.status,'Scheduled');
  assert.equal(child.previousJobId,'weekly');
  assert.deepEqual(child.crewIds,['worker-1']);
  assert.equal(child.vehicleId,'vehicle-1');
  assert.deepEqual(child.tasks,[{text:'Water beds',done:false},{text:'Trim hedges',done:false}]);
  assert.deepEqual(child.photos,[]);
  assert.ok(child.date>new Date().toISOString().slice(0,10));
  assert.equal(new Date(child.deadline)-new Date(child.date),2*86400000);
  await store.update('jobs','weekly',{status:'Scheduled'});
  await store.update('jobs','weekly',{status:'Completed'});
  assert.equal((await store.list('jobs')).length,2);
});

test('PostgreSQL recurrence skips old occurrences and keeps month-end anchors',async()=>{
  for(const [anchor,frequency,today] of [['2026-01-01','Weekly','2026-10-22'],['2026-01-01','Fortnightly','2026-10-22'],['2026-01-31','Monthly','2026-02-20'],['2026-01-31','Monthly','2026-02-28'],['2026-01-31','Quarterly','2026-02-28']]){
    const result=(await query('SELECT potshaven_private.next_occurrence($1,$2,$3) AS value',[anchor,frequency,today])).rows[0].value;
    assert.equal(result,nextOccurrence(anchor,frequency,new Date(today+'T12:00:00Z')));
  }
});

test('PostgreSQL invalid recurrence rolls back completion without creating a child',async()=>{
  await store.put('jobs',{id:'invalid',title:'Invalid date',type:'Maintenance',status:'Scheduled',date:'not-a-date',recurrence:'Weekly',crewIds:[],tasks:[]});
  await assert.rejects(store.update('jobs','invalid',{status:'Completed'}),/valid scheduled date/);
  assert.equal((await store.get('jobs','invalid')).status,'Scheduled');
  assert.equal((await store.list('jobs')).length,1);
});

test('PostgreSQL prevents deleting stock or places while linked records exist',async()=>{
  await stockFixture();
  await store.stock('plant-1',1,{jobId:'job-1'});
  await assert.rejects(store.remove('inventory','plant-1'),error=>error.status===409);
  await assert.rejects(store.remove('jobs','job-1'),error=>error.status===409);
  await store.put('places',{id:'place-1',name:'Linked place'});
  await store.put('payments',{id:'payment-1',description:'Maintenance invoice',placeId:'place-1',amount:500});
  await assert.rejects(store.remove('places','place-1'),error=>error.status===409);
});

test('PostgreSQL settings and a private random session secret survive independent store instances',async()=>{
  await store.updateSettings({companyName:'Our landscaping company',ownerName:'Business owner',currency:'USD',accentColor:'#315c43',logo:'/branding/potshaven-logo.png'});
  const first=await store.getSessionSecret();
  assert.match(first,/^[a-f0-9]{96}$/);
  const restarted=await createPostgresStore('',{query});
  assert.equal(await restarted.getSessionSecret(),first);
  assert.equal((await restarted.settings()).ownerName,'Business owner');
  assert.equal((await restarted.settings()).currency,'USD');
  assert.ok(!Object.hasOwn(await restarted.state(),'session-secret'));
  await assert.rejects(store.updateSettings({accentColor:'invalid'}),/accent colour/);
  await assert.rejects(store.updateSettings({currency:'INVALID'}),/ISO currency/);
});

test('PostgreSQL media is durable, immutable, private and absent from workspace state',async()=>{
  const bytes=Buffer.from('test-image-bytes');
  const path=await store.putMedia('uploads/plant-1.png',bytes,'image/png');
  assert.equal(path,'/media/uploads/plant-1.png');
  await store.putMedia('uploads/plant-1.png',bytes,'image/png');
  const restarted=await createPostgresStore('',{query});
  assert.deepEqual(await restarted.getMedia('uploads/plant-1.png'),{bytes,contentType:'image/png'});
  assert.equal(await restarted.getMedia('absent.png'),null);
  await assert.rejects(store.putMedia('uploads/plant-1.png',Buffer.from('different'),'image/png'),error=>error.status===409);
  await assert.rejects(store.putMedia('../outside.png',bytes,'image/png'),/Invalid media/);
  await assert.rejects(store.putMedia('unsafe.html',bytes,'text/html'),/PNG/);
  assert.ok(!JSON.stringify(await restarted.state()).includes(bytes.toString('base64')));
});

test('PostgreSQL parameterized identifiers cannot alter the schema',async()=>{
  const id="x'); DROP SCHEMA potshaven_private CASCADE; --";
  await store.put('places',{id,name:'An ordinary client name'});
  assert.equal((await store.get('places',id)).name,'An ordinary client name');
  await store.update('places',id,{name:'Updated safely'});
  assert.equal((await store.get('places',id)).name,'Updated safely');
  await store.remove('places',id);
  assert.equal(await store.get('places',id),undefined);
  assert.ok(Array.isArray((await store.state()).inventory));
});


test('PostgreSQL requires a server connection string instead of a temporary-file fallback',async()=>{
  await assert.rejects(createPostgresStore('',{}),error=>error.status===503&&/PostgreSQL database/.test(error.message));
  await assert.rejects(createPostgresStore('https://example.supabase.co',{}),error=>error.status===503&&/Transaction Pooler/.test(error.message));
});

test('PostgreSQL rejects stale manager snapshots before changing approvals, deadlines or private task data',async()=>{
  const cases=[
    ['purchaseRequests',{id:'request',title:'Planters',status:'Pending',requestedBy:'manager',estimatedCost:100},{status:'Approved'},{status:'Pending',estimatedCost:900}],
    ['jobs',{id:'project',title:'Garden installation',type:'Maintenance',status:'Scheduled',deadline:'2026-10-30',crewIds:[],tasks:[]},{type:'Project',deadline:'2026-11-01'},{deadline:'2027-01-01'}],
    ['jobs',{id:'care',title:'Garden care',type:'Maintenance',status:'Scheduled',crewIds:[],tasks:[{id:'water',text:'Water plants',done:false,privateCost:100}]},{tasks:[{id:'water',text:'Water plants',done:false,privateCost:200}]},{tasks:[{id:'water',text:'Water plants',done:true,privateCost:100}]}],
  ];
  for(const [collection,initial,ownerPatch,managerPatch] of cases){
    await store.put(collection,initial);
    const authorizedSnapshot=await store.get(collection,initial.id);
    const changed=await store.update(collection,initial.id,ownerPatch);
    await assert.rejects(store.update(collection,initial.id,managerPatch,'Manager',{expected:authorizedSnapshot}),error=>error.status===409&&/changed while you were editing/.test(error.message));
    assert.deepEqual(await store.get(collection,initial.id),changed);
  }
  const current=await store.get('jobs','care');
  const saved=await store.update('jobs','care',{status:'In progress'},'Manager',{expected:current});
  assert.equal(saved.status,'In progress');
  assert.equal(saved.tasks[0].privateCost,200);
});

test('PostgreSQL upgrades deployed schema version one without losing data, sessions or old function compatibility',async()=>{
  await store.put('places',{id:'existing',name:'Existing customer'});
  const secret=await store.getSessionSecret();
  await database.exec(`
    DROP FUNCTION potshaven_private.update_record(text,text,jsonb,text,text,text,text,jsonb);
    CREATE FUNCTION potshaven_private.update_record(p_collection text,p_id text,p_patch jsonb,p_actor text,p_movement_id text,p_followup_id text,p_now text)
    RETURNS jsonb LANGUAGE SQL SET search_path=pg_catalog,potshaven_private AS 'SELECT data FROM potshaven_private.records WHERE collection=p_collection AND id=p_id';
    UPDATE potshaven_private.metadata SET value='"1"'::jsonb WHERE key='schemaVersion';
  `);
  const upgraded=await createPostgresStore('',{query});
  assert.equal((await upgraded.get('places','existing')).name,'Existing customer');
  assert.equal(await upgraded.getSessionSecret(),secret);
  assert.equal((await query("SELECT value FROM potshaven_private.metadata WHERE key='schemaVersion'")).rows[0].value,'2');
  const signatures=(await query("SELECT to_regprocedure('potshaven_private.update_record(text,text,jsonb,text,text,text,text)') AS old, to_regprocedure('potshaven_private.update_record(text,text,jsonb,text,text,text,text,jsonb)') AS guarded")).rows[0];
  assert.ok(signatures.old);
  assert.ok(signatures.guarded);
  await database.exec('CREATE ROLE potshaven_guard_anon');
  assert.equal((await query("SELECT has_function_privilege('potshaven_guard_anon','potshaven_private.update_record(text,text,jsonb,text,text,text,text,jsonb)','EXECUTE') AS allowed")).rows[0].allowed,false);
  const expected=await upgraded.get('places','existing');
  assert.equal((await upgraded.update('places','existing',{name:'Updated customer'},'Manager',{expected})).name,'Updated customer');
  await createPostgresStore('',{query});
  assert.equal((await upgraded.get('places','existing')).name,'Updated customer');
  await query("UPDATE potshaven_private.metadata SET value='\"3\"'::jsonb WHERE key='schemaVersion'");
  await createPostgresStore('',{query});
  assert.equal((await query("SELECT value FROM potshaven_private.metadata WHERE key='schemaVersion'")).rows[0].value,'3','Older application instances must not downgrade a future migration marker.');
  // Restore the fixture marker so subsequent independent tests use this schema.
  await query("UPDATE potshaven_private.metadata SET value='\"2\"'::jsonb WHERE key='schemaVersion'");
});

test('PostgreSQL sign-in limits are atomic across independent cloud instances and expire after fifteen minutes',async()=>{
  const other=await createPostgresStore('',{query});
  const key='a'.repeat(64), otherRole='b'.repeat(64), now=Date.UTC(2026,9,23);
  const attempts=await Promise.all(Array.from({length:24},(_,index)=>(index%2?store:other).recordLoginAttempt(key,false,now)));
  assert.equal(attempts.filter(Boolean).length,10);
  assert.equal(await other.recordLoginAttempt(key,true,now+1),false,'A correct password cannot bypass an active lockout.');
  assert.equal(await other.recordLoginAttempt(otherRole,true,now+1),true);
  assert.equal(await store.recordLoginAttempt(key,false,now+2),false,'A different role signing in must not clear this counter.');
  const cold=await createPostgresStore('',{query});
  assert.equal(await cold.recordLoginAttempt(key,false,now+3),false,'A cold function must enforce the stored counter.');
  assert.equal(await cold.recordLoginAttempt(key,false,now+15*60*1000),true);
  assert.equal(await cold.recordLoginAttempt(key,true,now+15*60*1000+1),true);
  for(let attempt=0;attempt<10;attempt++)assert.equal(await cold.recordLoginAttempt(key,false,now+15*60*1000+2),true);
  assert.equal(await store.recordLoginAttempt(key,false,now+15*60*1000+3),false);
  assert.ok(!JSON.stringify(await store.state()).includes(key),'Private authentication counters must not enter workspace state.');
});

test('PostgreSQL sign-in counters reject untrusted keys and never replay an ambiguous committed attempt',async()=>{
  for(const key of ['owner:127.0.0.1','session-secret','x'.repeat(64)])await assert.rejects(store.recordLoginAttempt(key,false),error=>error.status===400);
  const key='c'.repeat(64), now=Date.UTC(2026,9,23);
  // Prime cleanup before simulating a lost reply to the atomic counter write.
  await store.recordLoginAttempt('d'.repeat(64),true,now);
  let writes=0;
  const broken=await createPostgresStore('',{query:async(text,parameters)=>{
    const result=await query(text,parameters);
    if(text.includes("RETURNING (value->>'allowed')::boolean")){
      writes++;
      throw Object.assign(new Error('Connection dropped after attempt was committed'),{code:'ECONNRESET'});
    }
    return result;
  }});
  await assert.rejects(broken.recordLoginAttempt(key,false,now),error=>error.code==='ECONNRESET');
  assert.equal(writes,1);
  assert.equal((await query("SELECT value->>'failures' AS failures FROM potshaven_private.metadata WHERE key=$1",['login-attempt:'+key])).rows[0].failures,'1');
});


test('Supabase adapter composes with serverless API, authenticated photos and cold-start sessions',async()=>{
  const env={DATABASE_URL:'postgresql://connection-is-injected.invalid/company',APP_OWNER_PASSWORD:'test-owner-password',APP_MANAGER_PASSWORD:'test-manager-password'};
  const handler=createCloudHandler({env,connect:async()=>store});
  const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  let secondServer;
  try{
    assert.equal((await fetch(base+'/api/state')).status,401);
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'owner',password:env.APP_OWNER_PASSWORD})});
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const headers={'Content-Type':'application/json',Cookie:cookie};
    const picture='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNI0AAAAASUVORK5CYII=';
    const plantResponse=await fetch(base+'/api/inventory',{method:'POST',headers,body:JSON.stringify({name:'Hotel peace lily',quantity:8,cost:75,image:'data:image/png;base64,'+picture})});
    assert.equal(plantResponse.status,201);
    const plant=await plantResponse.json();
    assert.match(plant.image,/^\/media\/uploads\/[a-f0-9]{64}\.png$/);
    assert.equal((await fetch(base+plant.image)).status,401);
    const media=await fetch(base+plant.image,{headers:{Cookie:cookie}});
    assert.equal(media.status,200);
    assert.deepEqual(Buffer.from(await media.arrayBuffer()),Buffer.from(picture,'base64'));
    const jobResponse=await fetch(base+'/api/jobs',{method:'POST',headers,body:JSON.stringify({title:'Hotel planting'})});
    assert.equal(jobResponse.status,201);
    const job=await jobResponse.json();
    const usage=await fetch(`${base}/api/inventory/${plant.id}/use`,{method:'POST',headers,body:JSON.stringify({quantity:3,jobId:job.id})});
    assert.equal(usage.status,200);
    assert.equal((await usage.json()).item.quantity,5);
    const purchaseResponse=await fetch(base+'/api/purchaseRequests',{method:'POST',headers,body:JSON.stringify({title:'Replacement plants',quantity:3,estimatedCost:225})});
    assert.equal(purchaseResponse.status,201);
    const purchase=await purchaseResponse.json();
    const managerLogin=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'manager',password:env.APP_MANAGER_PASSWORD})});
    const managerCookie=managerLogin.headers.get('set-cookie').split(';')[0];
    const approval=await fetch(`${base}/api/purchaseRequests/${purchase.id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Cookie:managerCookie},body:JSON.stringify({status:'Approved'})});
    assert.equal(approval.status,403);
    secondServer=createServer(createCloudHandler({env,connect:async()=>createPostgresStore('',{query})}));
    secondServer.listen(0,'127.0.0.1');await once(secondServer,'listening');
    const restored=await fetch(`http://127.0.0.1:${secondServer.address().port}/api/state`,{headers:{Cookie:cookie}});
    assert.equal(restored.status,200);
    const state=await restored.json();
    assert.equal(state.role,'owner');
    assert.equal(state.inventory[0].quantity,5);
    assert.equal(state.stockMovements[0].totalCost,225);
    assert.ok(!JSON.stringify(state).includes(picture));
  }finally{
    await new Promise(resolve=>server.close(resolve));
    if(secondServer)await new Promise(resolve=>secondServer.close(resolve));
  }
});
