import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from './store.js';
import {createApp} from './app.js';
import {authorizeMutation, workspaceForRole} from './access.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNI0AAAAASUVORK5CYII=';
async function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'potshaven-access-'));
  const store = createStore(':memory:', {seed:false});
  store.updateSettings({companyName:'PotsHavenGh',ownerName:'PRIVATE_OWNER',logo:png});
  store.put('places', {id:'place',name:'Hotel garden',notes:'Use side gate',privateNotes:'PRIVATE_CLIENT',inspections:[{id:'inspection',date:'2026-10-23',notes:'Water checked',privateCost:9321}]});
  store.put('workers', {id:'worker',name:'Ama',available:true,skills:['Planting'],agreedRate:9876,rateBasis:'Weekly',agreementNotes:'PRIVATE_PAY',engagementType:'Permanent'});
  store.put('vehicles', {id:'van',name:'Crew van',status:'Available',purchaseCost:7461});
  store.put('inventory', {id:'plant',name:'Palm',category:'Plants',quantity:20,minStock:2,cost:543,image:png});
  store.put('jobs', {id:'job',title:'Garden care',type:'Maintenance',status:'Scheduled',date:'2026-10-23',placeId:'place',crewIds:[],tasks:[{text:'Water',done:false,privateCost:876}],budget:3444,ownerNotes:'PRIVATE_JOB'});
  store.put('jobs', {id:'project',title:'Hotel installation',type:'Project',status:'In progress',date:'2026-10-23',deadline:'2026-10-30',crewIds:[],tasks:[],budget:10000});
  store.put('contracts', {id:'contract',title:'PRIVATE_CONTRACT',amount:4000});
  store.put('payments', {id:'payment',description:'PRIVATE_PAYMENT',amount:3400});
  store.put('expenses', {id:'expense',description:'PRIVATE_EXPENSE',amount:1200});
  store.put('purchaseRequests', {id:'manager-request',title:'Extra pots',status:'Pending',requestedBy:'Manager',estimatedCost:150});
  store.put('purchaseRequests', {id:'owner-request',title:'PRIVATE_REQUEST',status:'Pending',requestedBy:'owner',estimatedCost:1500});
  let generations = 0;
  const app = createApp({store,dataDir,serveClient:false,ownerPassword:'owner-secret',managerPassword:'manager-secret',imageKey:'test-image-key',sessionSecret:'access-test-secret',fetchImage:async()=>{generations++;throw new Error('Should not reach a provider.');}});
  const server = await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();rmSync(dataDir,{recursive:true,force:true});});
  async function login(role) {
    const response = await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,password:role+'-secret'})});
    assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  const owner = await login('owner'), manager = await login('manager');
  const request = (path, role='manager', method='GET', body) => fetch(base+path,{method,headers:{Cookie:role==='owner'?owner:manager,...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})});
  return {base,store,request,generations:()=>generations};
}

test('manager state and collection responses exclude finance, studio, pay and private fields; owner retains them', async t=>{
  const {request} = await setup(t);
  const state = await (await request('/api/state')).json();
  assert.equal(state.role,'manager');
  for(const collection of ['designs','contracts','payments','expenses']) assert.deepEqual(state[collection],[]);
  assert.equal(state.imageGenerationConfigured,false);
  assert.equal(state.imageModel,undefined);
  assert.equal(state.settings.ownerName,undefined);
  assert.equal(state.workers[0].agreedRate,undefined);
  assert.equal(state.workers[0].rateBasis,undefined);
  assert.equal(state.inventory[0].cost,undefined);
  assert.equal(state.jobs[0].budget,undefined);
  assert.equal(state.jobs[0].tasks[0].privateCost,undefined);
  assert.equal(state.places[0].inspections[0].privateCost,undefined);
  assert.deepEqual(state.purchaseRequests.map(record=>record.id),['manager-request']);
  assert.ok(!JSON.stringify(state).includes('PRIVATE_'));
  for(const collection of ['designs','contracts','payments','expenses']) assert.equal((await request('/api/'+collection)).status,403);
  const workers = await (await request('/api/workers')).json();
  assert.equal(workers[0].agreedRate,undefined);
  const ownerState = await (await request('/api/state','owner')).json();
  assert.equal(ownerState.workers[0].agreedRate,9876);
  assert.equal(ownerState.inventory[0].cost,543);
  assert.equal(ownerState.jobs[0].budget,3444);
  assert.equal(ownerState.settings.ownerName,'PRIVATE_OWNER');
});

test('manager cannot bypass owner-only changes through CRUD, image generation, or extra nested fields',async t=>{
  const {request,store,generations}=await setup(t);
  const before = store.state();
  const forbidden = [
    ['/api/designs/generate','POST',{prompt:'Create a hotel entrance'}],
    ['/api/designs','POST',{title:'Hidden studio',image:png}],
    ['/api/workers','POST',{name:'Unapproved hire'}],
    ['/api/vehicles','POST',{name:'Unapproved fleet'}],
    ['/api/workers/worker','PATCH',{agreedRate:1}],
    ['/api/vehicles/van','PATCH',{purchaseCost:1}],
    ['/api/inventory/plant','PATCH',{quantity:100}],
    ['/api/inventory/plant/restock','POST',{quantity:2}],
    ['/api/jobs/job','PATCH',{budget:1}],
    ['/api/jobs/project','PATCH',{deadline:'2027-01-01'}],
    ['/api/jobs','POST',{title:'Unapproved project',type:'Project'}],
    ['/api/jobs/job','PATCH',{tasks:[{text:'Water',done:true,privateCost:1}]}],
    ['/api/places/place','PATCH',{inspections:[{id:'inspection',privateCost:1}]}],
    ['/api/jobs/job','DELETE'],
    ['/api/places/place','DELETE'],
    ['/api/settings','PATCH',{companyName:'Changed'}],
    ['/api/purchaseRequests/manager-request','PATCH',{status:'Approved'}],
    ['/api/purchaseRequests/owner-request','PATCH',{notes:'Tampered'}],
    ['/api/expenses','POST',{description:'Bypass',amount:1}],
  ];
  for(const [path,method,body]of forbidden) assert.equal((await request(path,'manager',method,body)).status,403,path);
  assert.equal(generations(),0,'Owner-only guard must run before a paid call.');
  assert.deepEqual(store.state(),before);
  for(const changes of [{notes:{amount:500}}, {tasks:[{text:{amount:1},done:false}]}, {crewIds:[{}]}, {date:'2026-02-30'}]) assert.equal((await request('/api/jobs/job','manager','PATCH',changes)).status,400);
  assert.deepEqual(store.state(),before);
});

test('manager saves operational progress and availability without changing private fields',async t=>{
  const {request,store}=await setup(t);
  const progress = await request('/api/jobs/job','manager','PATCH',{crewIds:['worker'],vehicleId:'van',tasks:[{title:'Water',done:true}]});
  assert.equal(progress.status,200);
  const visible = await progress.json();
  assert.equal(visible.budget,undefined);
  assert.equal(visible.tasks[0].privateCost,undefined);
  assert.equal(store.get('jobs','job').budget,3444);
  assert.equal(store.get('jobs','job').tasks[0].privateCost,876);
  assert.equal(store.get('jobs','job').tasks[0].done,true);
  const inspection = await request('/api/places/place','manager','PATCH',{inspections:[{id:'inspection',date:'2026-10-23',notes:'New check'}]});
  assert.equal(inspection.status,200);
  assert.equal(store.get('places','place').inspections[0].privateCost,9321);
  assert.equal((await request('/api/workers/worker','manager','PATCH',{available:false})).status,200);
  assert.equal(store.get('workers','worker').agreedRate,9876);
  assert.equal((await request('/api/vehicles/van','manager','PATCH',{status:'Servicing',notes:'Pressure check needed'})).status,200);
  const requestResponse = await request('/api/purchaseRequests','manager','POST',{title:'Replacement pots',requestType:'Restock',quantity:2,estimatedCost:100,status:'Pending'});
  assert.equal(requestResponse.status,201);
  const created = await requestResponse.json();
  assert.equal(created.requestedBy,'manager');
  assert.equal(created.status,'Pending');
  assert.equal((await request('/api/jobs/job','manager','PATCH',{crewIds:['invented-worker']})).status,409);
  assert.equal((await request('/api/jobs/job','manager','PATCH',{vehicleId:'invented-vehicle'})).status,409);
  assert.equal((await request('/api/jobs/job','manager','PATCH',{placeId:'invented-place'})).status,409);
});

test('stock use is job-linked and redacts cost from both inventory and ledger responses',async t=>{
  const {request,store}=await setup(t);
  assert.equal((await request('/api/inventory/plant/use','manager','POST',{quantity:2})).status,400);
  const response=await request('/api/inventory/plant/use','manager','POST',{quantity:2,jobId:'job'});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.item.quantity,18);
  assert.equal(result.item.cost,undefined);
  assert.equal(result.movement.unitCost,undefined);
  assert.equal(result.movement.totalCost,undefined);
  assert.equal(store.list('stockMovements')[0].totalCost,1086);
  const ledger=await(await request('/api/stockMovements')).json();
  assert.equal(ledger[0].totalCost,undefined);
});

test('media access follows visible operational records and prevents attaching owner-only images to launder access',async t=>{
  const {request,store}=await setup(t);
  const managerState=await(await request('/api/state')).json();
  const plant=managerState.inventory[0].image;
  const operational=await request(plant);
  assert.equal(operational.status,200);
  assert.equal(operational.headers.get('cache-control'),'private, no-store');
  assert.match(operational.headers.get('vary'),/Cookie/i);
  const privateRecord=await request('/api/designs','owner','POST',{title:'PRIVATE_DESIGN',source:'Portfolio upload',image:png});
  assert.equal(privateRecord.status,201);
  const privateImage=(await privateRecord.json()).image;
  // Identical bytes are intentionally shared by content-addressed uploads. Use
  // a distinct encoded PNG byte sequence to test truly owner-private media.
  const otherPng=png.replace('O+jNI0','O+jNI1');
  const distinct=await request('/api/designs','owner','POST',{title:'PRIVATE_DESIGN_2',source:'Portfolio upload',image:otherPng});
  assert.equal(distinct.status,201);
  const image=(await distinct.json()).image;
  assert.notEqual(image,plant);
  assert.equal((await request(image)).status,403);
  assert.equal((await request(image,'owner')).status,200);
  const before=store.get('places','place');
  assert.equal((await request('/api/places/place','manager','PATCH',{image})).status,403);
  assert.equal((await request('/api/places/place','manager','PATCH',{notes:image})).status,403);
  assert.deepEqual(store.get('places','place'),before);
  assert.equal((await request(privateImage)).status,200,'An operational photo with identical bytes remains operational.');
});

test('manager allowlists omit object-shaped private data in malformed legacy scalar fields',()=>{
  const state=workspaceForRole({settings:{companyName:'PotsHaven',ownerName:'Hidden'},jobs:[{id:'job',title:'Visit',notes:{privateCost:100}}]},'manager');
  assert.equal(state.jobs[0].notes,undefined);
  assert.throws(()=>authorizeMutation('manager','jobs','update',{notes:{privateCost:100}},{id:'job',type:'Maintenance'}),/text/);
});
