import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWorkforce} from './workforce-validation.js';
import {createStore} from './store.js';
import {assignmentWarnings, engagementState, workerCanBeAssigned} from '../src/workforce.ts';

const day = '2026-10-23';
const worker = {id:'worker-1', name:'Ama', workforceType:'External', engagementType:'Weekly', engagementStart:'2026-10-20', engagementEnd:'2026-10-26', agreedRate:700, rateBasis:'Weekly', available:true};
test('legacy staff and valid daily, weekly and completion agreements remain valid', () => {
  assert.doesNotThrow(() => validateWorkforce('workers', {name:'Existing staff', skills:['Plant care']}));
  assert.doesNotThrow(() => validateWorkforce('workers', worker));
  assert.doesNotThrow(() => validateWorkforce('workers', {...worker,engagementType:'Until job complete',engagementEnd:'',relatedJobId:'job-1',agreementStatus:'Signed'}));
});
test('work agreements reject invalid dates, rates and incomplete contract terms', () => {
  for (const changes of [{engagementStart:'2026-02-30'}, {engagementEnd:'2026-10-19'}, {agreedRate:-1}, {agreedRate:'700'}, {workforceType:'Maybe'}, {engagementType:'Until job complete'}, {engagementType:'Fixed contract',engagementEnd:''}, {available:'yes'}, {skills:'Pruning'}]) {
    assert.throws(() => validateWorkforce('workers', {...worker,...changes}));
  }
});
test('engagement state respects scheduled date and completion, separately from availability', () => {
  assert.equal(engagementState(worker,[],day),'Active');
  assert.equal(engagementState(worker,[],'2026-10-27'),'Ended');
  assert.equal(engagementState(worker,[],'2026-10-19'),'Not started');
  assert.equal(workerCanBeAssigned({...worker,available:false},[],day),false);
  assert.equal(engagementState({...worker,engagementType:'Until job complete',relatedJobId:'j'},[{id:'j',status:'Completed'}],day),'Work complete');
  assert.equal(workerCanBeAssigned({...worker,engagementType:'Until job complete',relatedJobId:'j'},[],day),false);
});
test('assignment warnings identify real same-day reuse without claiming time conflicts', () => {
  const job = {id:'new',title:'New visit',date:day,status:'Scheduled',crewIds:[worker.id],vehicleId:'v'};
  const existing = {id:'old',title:'Earlier route',date:day,status:'Scheduled',crewIds:[worker.id],vehicleId:'v'};
  const warnings = assignmentWarnings(job,[existing],[worker],[{id:'v',name:'Pickup',status:'Servicing'}]);
  assert.equal(warnings.length,3);
  assert.match(warnings.join(' '),/Earlier route/);
  assert.match(warnings.join(' '),/Check travel and timing/);
  assert.match(warnings.join(' '),/servicing/);
  assert.deepEqual(assignmentWarnings({...job,status:'Completed'},[existing],[worker],[]),[]);
});
test('invalid agreement updates leave the saved worker and their assignments intact', t => {
  const store = createStore(':memory:',{seed:false});
  t.after(() => store.close());
  store.put('workers',worker);
  store.put('jobs',{id:'job',title:'Garden care',type:'Maintenance',status:'Scheduled',crewIds:[worker.id],tasks:[]});
  assert.throws(() => store.update('workers',worker.id,{engagementEnd:'2026-10-01'}),/end date/);
  assert.deepEqual(store.get('workers',worker.id),worker);
  assert.deepEqual(store.get('jobs','job').crewIds,[worker.id]);
});
