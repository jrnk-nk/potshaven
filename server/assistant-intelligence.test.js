import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from './app.js';
import {createStore} from './store.js';
import {companyBriefing, validateProposal} from './assistant.js';
import {workspaceForRole} from './access.js';

const today = '2026-10-25';
const date = '2026-10-28';
const fixture = {
  places: [{id:'hotel', name:'Palm Court'}, {id:'roundabout', name:'Roundabout'}],
  jobs: [
    {id:'hotel-job', title:'Entrance care', placeId:'hotel', date, type:'Maintenance', status:'Scheduled', crewIds:['ama'], vehicleId:'van', tasks:[]},
    {id:'road-job', title:'Road care', placeId:'roundabout', date, type:'Maintenance', status:'Scheduled', crewIds:['ama'], vehicleId:'van', tasks:[]},
    {id:'overdue', title:'Overdue site work', placeId:'hotel', date:'2026-10-22', type:'Maintenance', status:'Scheduled', crewIds:[], tasks:[]},
  ],
  workers:[{id:'ama',name:'Ama',available:true,engagementType:'Weekly',engagementStart:'2026-10-20',engagementEnd:'2026-10-26'}],
  vehicles:[{id:'van',name:'Garden van',status:'Available'}],
  inventory:[{id:'palm',name:'Palm',category:'Plants',quantity:1,minStock:2}],
  issues:[{id:'urgent',title:'Broken irrigation pipe',placeId:'hotel',priority:'Urgent',status:'Open'}, {id:'later',title:'Check lawn',placeId:'roundabout',status:'Open',followUpDate:'2026-11-01'}, {id:'resolved',title:'Resolved pipe',placeId:'hotel',priority:'Urgent',status:'Resolved'}],
  equipment:[{id:'mower',name:'Mower',status:'Good',nextService:'2026-10-24'}, {id:'strimmer',name:'Strimmer',status:'Needs service'}],
  purchaseRequests:[{id:'supplies',title:'Need compost',quantity:4,status:'Pending',requestedBy:'manager',jobId:'hotel-job'}, {id:'private-supply',title:'OWNER_ONLY_SUPPLY',quantity:2,status:'Pending',requestedBy:'owner'}],
};

test('priority briefing covers the coming week, equipment and reviewable supplies without inventing conflicts', () => {
  const briefing = companyBriefing(fixture, today);
  assert.equal(briefing.through, '2026-11-01');
  assert.ok(Number.isFinite(Date.parse(briefing.checkedAt)));
  assert.equal(briefing.counts.urgent, 2);
  assert.ok(briefing.items.find(item=>item.id==='issue-urgent'));
  assert.ok(!briefing.items.some(item=>item.id==='issue-resolved'));
  assert.ok(briefing.items.find(item=>item.id==='issue-later'));
  assert.ok(briefing.items.find(item=>item.id==='equipment-mower'));
  assert.ok(briefing.items.find(item=>item.id==='equipment-strimmer'));
  assert.match(briefing.items.find(item=>item.id==='request-supplies').detail,/Approval does not add stock/);
  const assignment = briefing.items.find(item=>item.id==='assignment-hotel-job');
  assert.match(assignment.detail,/Ama, Garden van/);
  assert.match(assignment.detail,/does not prove a clash/);
  assert.equal(assignment.href,'#sites?site=hotel');
  assert.equal(assignment.jobId,'hotel-job');
  assert.ok(briefing.items.find(item=>item.id==='availability-hotel-job'));
  const ranks = {urgent:0,attention:1,upcoming:2};
  assert.deepEqual(briefing.items.map(item=>ranks[item.severity]),briefing.items.map(item=>ranks[item.severity]).sort());
  const focused = companyBriefing(workspaceForRole(fixture,'manager'),today,{siteId:'hotel',role:'manager'});
  assert.ok(!focused.items.some(item=>item.siteId==='roundabout'));
  assert.ok(focused.items.find(item=>item.id==='assignment-hotel-job'),'Focused site still checks assignments at other sites.');
  assert.ok(!JSON.stringify(focused).includes('OWNER_ONLY_SUPPLY'));
  assert.match(focused.items.find(item=>item.id==='request-supplies').detail,/Waiting for the owner/);
});

test('urgent briefing items remain visible when routine items exceed the display limit', () => {
  const briefing = companyBriefing({...fixture,inventory:Array.from({length:40},(_,i)=>({id:`stock-${i}`,name:`Stock ${i}`,quantity:1,minStock:2}))},today);
  assert.equal(briefing.items.length,30);
  assert.ok(briefing.total>30);
  assert.equal(Object.values(briefing.counts).reduce((sum,value)=>sum+value,0),briefing.total);
  assert.ok(briefing.items.some(item=>item.id==='issue-urgent'));
  assert.ok(briefing.items.some(item=>item.id==='overdue-overdue'));
  assert.match(briefing.summary,/first 30 by priority/);
  const invalid = companyBriefing({jobs:[{id:'bad',title:'Undated work',date:'2026-02-31',status:'Scheduled'}],equipment:[{id:'bad',name:'Undated service',nextService:'not-a-date'}]},today);
  assert.deepEqual(invalid.items,[]);
});

async function running(t, records, output = {reply:'Review the saved records.',actions:[]}) {
  const directory = mkdtempSync(join(tmpdir(),'potshaven-intelligence-'));
  const store = createStore(':memory:',{seed:false});
  for(const [collection,items] of Object.entries(records)) for(const item of items) store.put(collection,item);
  const requests=[];
  const app=createApp({store,dataDir:directory,serveClient:false,ownerPassword:'owner-check',managerPassword:'manager-check',imageKey:'test-key',sessionSecret:'intelligence-test-secret',fetchAssistant:async(url,request)=>{
    requests.push(JSON.parse(request.body));
    return {ok:true,json:async()=>({output_text:JSON.stringify(output)})};
  }});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();rmSync(directory,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const cookies={};
  for(const role of ['owner','manager']){
    const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,password:`${role}-check`})});
    assert.equal(response.status,200);cookies[role]=response.headers.get('set-cookie').split(';')[0];
  }
  const post=(role,body)=>fetch(base+'/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookies[role]},body:JSON.stringify({today,message:'What needs attention?',...body})});
  return {post,requests,store,base,cookies};
}
const snapshot = request => JSON.parse(request.input[0].content.split('\n').slice(1).join('\n'));

test('site focus finds work after the first eighty records and includes private-safe visit and equipment summaries',async t=>{
  const records={...fixture,places:[...Array.from({length:90},(_,i)=>({id:`other-site-${i}`,name:`Other site ${i}`})),...fixture.places.map(site=>({...site,inspections:Array.from({length:8},(_,i)=>({id:`visit-${i}`,date:`2026-10-${String(i+1).padStart(2,'0')}`,plantHealth:'Needs care',workNeeded:'Check irrigation',notes:'Recorded visit note',privateTerms:'OWNER_PRIVATE_VISIT',cost:99999,photos:['/media/private-photo.png']}))}))],jobs:[...Array.from({length:90},(_,i)=>({id:`other-job-${i}`,title:`Other job ${i}`,placeId:`other-site-${i}`,date:'2026-01-01',type:'Maintenance',status:'Scheduled',tasks:[],crewIds:[]})),...fixture.jobs],equipment:fixture.equipment.map(item=>({...item,privateTerms:'OWNER_PRIVATE_TOOL',purchasePrice:99999})),purchaseRequests:fixture.purchaseRequests.map(item=>({...item,estimatedCost:99999,privateTerms:'OWNER_PRIVATE_REQUEST'}))};
  const {post,requests,store,base,cookies}=await running(t,records);
  const before=store.state();
  const response=await post('manager',{siteId:'hotel',message:'Plan the next week for this site.'});
  assert.equal(response.status,200);
  const result=await response.json(),seen=snapshot(requests.at(-1));
  assert.deepEqual(seen.places.map(item=>item.id),['hotel']);
  assert.ok(seen.jobs.some(job=>job.id==='hotel-job'));
  assert.ok(seen.jobs.every(job=>job.placeId==='hotel'));
  assert.equal(seen.places[0].visitCount,8);
  assert.equal(seen.places[0].recentVisits.length,5);
  assert.equal(seen.places[0].recentVisits[0].date,'2026-10-08');
  assert.equal(seen.places[0].recentVisits[0].photoCount,1);
  assert.ok(seen.equipment.some(item=>item.id==='mower'));
  assert.ok(seen.purchaseRequests.some(item=>item.id==='supplies'));
  for(const secret of ['OWNER_PRIVATE_','OWNER_ONLY_SUPPLY','99999','private-photo.png'])assert.ok(!JSON.stringify(seen).includes(secret),secret);
  assert.equal(result.contextScope.siteId,'hotel');
  assert.equal(result.contextScope.counts.jobs.total,2);
  assert.match(result.contextScope.message,/Focused on Palm Court/);
  assert.deepEqual(store.state(),before);
  const calls=requests.length;
  for(const siteId of ['missing-site',{},['hotel']])assert.ok([400,404].includes((await post('manager',{siteId})).status));
  assert.equal(requests.length,calls,'Invalid site requests never call the provider.');
  const briefing=await fetch(base+'/api/assistant/briefing?today='+today+'&siteId=hotel',{headers:{Cookie:cookies.manager}});
  assert.equal(briefing.status,200);assert.equal((await briefing.json()).siteId,'hotel');
});

test('named records beyond the snapshot limit are prioritised and truncated coverage is explicit',async t=>{
  const records={...fixture,jobs:[...Array.from({length:100},(_,i)=>({id:`ordinary-${i}`,title:`Ordinary job ${i}`,date:'2026-01-01',type:'Maintenance',status:'Scheduled',tasks:[],crewIds:[]})),{id:'orchid',title:'Orchid courtyard restoration',placeId:'hotel',date:'2026-11-02',type:'Maintenance',status:'Scheduled',tasks:[],crewIds:[]}]};
  const {post,requests}=await running(t,records);
  const response=await post('owner',{message:'Review Orchid courtyard restoration.'});
  assert.equal(response.status,200);
  const seen=snapshot(requests.at(-1)),result=await response.json();
  assert.equal(seen.jobs[0].id,'orchid');
  assert.equal(seen.jobs.length,80);
  assert.deepEqual(result.contextScope.counts.jobs,{included:80,total:101});
  assert.equal(result.contextScope.limited,true);
  assert.match(result.contextScope.message,/Some records are outside/);
  assert.ok(JSON.stringify(seen).length<=100000);
});

test('supply proposals require quantities and valid links and never approve, order, spend or edit stock',async t=>{
  for(const role of ['owner','manager']){
    const proposal=validateProposal({collection:'purchaseRequests',operation:'create',changes:{title:'Compost bags',quantity:4,jobId:'hotel-job',placeId:'hotel'}},fixture,today,undefined,role);
    assert.equal(proposal.changes.status,'Pending');
    assert.equal(proposal.changes.requestedBy,role);
    assert.equal(proposal.changes.requestType,'Restock');
    for(const changes of [{title:'Compost'}, {title:'Compost',quantity:0}, {title:'Compost',quantity:'4'}, {title:'Compost',quantity:4,estimatedCost:100}, {title:'Compost',quantity:4,status:'Approved'}, {title:'Compost',quantity:4,requestedBy:'owner'}, {title:'Compost',quantity:4,jobId:'unknown'}, {title:'Compost',quantity:4,jobId:'hotel-job',placeId:'roundabout'}, {title:'Compost',quantity:4,requestType:'Receipt'}])assert.throws(()=>validateProposal({collection:'purchaseRequests',operation:'create',changes},fixture,today,undefined,role));
    assert.throws(()=>validateProposal({collection:'purchaseRequests',operation:'update',recordId:'supplies',changes:{quantity:7}},fixture,today,undefined,role),/new supply requests/);
  }
  const proposed={collection:'purchaseRequests',operation:'create',recordId:null,changesJson:JSON.stringify({title:'Compost bags',quantity:4,jobId:'hotel-job'})};
  const {post,store}=await running(t,fixture,{reply:'Review this supply request before saving.',actions:[proposed]});
  const before=store.state();
  const response=await post('manager',{message:'Prepare a request for four compost bags for Entrance care.'});
  assert.equal(response.status,200);
  assert.equal((await response.json()).actions[0].changes.requestedBy,'manager');
  assert.deepEqual(store.state(),before,'Chat prepares the request; saving still requires a separate authenticated action.');
});
