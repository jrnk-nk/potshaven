import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from './store.js';
import {createApp} from './app.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};

// Hold a manager write after its HTTP authorization check. A separate owner
// request can then change the record before the store commits the manager edit.
async function concurrentWorkspace(t, collection, initial) {
  const dataDir = mkdtempSync(join(tmpdir(), 'potshaven-access-race-'));
  const store = createStore(':memory:', {seed: false});
  store.put(collection, initial);
  const managerChecked = deferred(), resumeManager = deferred();
  const originalUpdate = store.update.bind(store);
  store.update = async (...args) => {
    if (args[3] === 'Manager') {
      managerChecked.resolve();
      await resumeManager.promise;
    }
    return originalUpdate(...args);
  };
  const app = createApp({store, dataDir, serveClient: false, ownerPassword: 'owner-secret', managerPassword: 'manager-secret', sessionSecret: 'access-race-test'});
  const server = await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    resumeManager.resolve();
    await new Promise(resolve => server.close(resolve));
    store.close();
    rmSync(dataDir, {recursive: true, force: true});
  });
  const cookies = {};
  for (const role of ['owner', 'manager']) {
    const response = await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({role, password: role + '-secret'})});
    assert.equal(response.status, 200);
    cookies[role] = response.headers.get('set-cookie').split(';')[0];
  }
  const update = (role, changes) => fetch(`${base}/api/${collection}/${initial.id}`, {method: 'PATCH', headers: {'Content-Type': 'application/json', Cookie: cookies[role]}, body: JSON.stringify(changes)});
  return {store, update, managerChecked: managerChecked.promise, resumeManager: resumeManager.resolve};
}

test('a manager edit authorized before owner approval cannot revise or reopen the reviewed purchase', async t => {
  const workspace = await concurrentWorkspace(t, 'purchaseRequests', {id: 'request', title: 'Approved planters', status: 'Pending', requestedBy: 'manager', estimatedCost: 100});
  const managerResponse = workspace.update('manager', {status: 'Pending', estimatedCost: 900});
  await workspace.managerChecked;
  const ownerResponse = await workspace.update('owner', {status: 'Approved'});
  assert.equal(ownerResponse.status, 200);
  workspace.resumeManager();
  const result = await managerResponse;
  assert.ok([403, 409].includes(result.status), `A reviewed purchase must reject the stale manager write; got ${result.status}.`);
  assert.equal(workspace.store.get('purchaseRequests', 'request').status, 'Approved');
  assert.equal(workspace.store.get('purchaseRequests', 'request').estimatedCost, 100);
});

test('a stale maintenance edit cannot override a deadline after the owner makes the job a project', async t => {
  const workspace = await concurrentWorkspace(t, 'jobs', {id: 'job', title: 'Garden installation', type: 'Maintenance', status: 'Scheduled', date: '2026-10-23', deadline: '2026-10-30', crewIds: [], tasks: []});
  const managerResponse = workspace.update('manager', {deadline: '2027-01-01'});
  await workspace.managerChecked;
  const ownerResponse = await workspace.update('owner', {type: 'Project', deadline: '2026-11-01'});
  assert.equal(ownerResponse.status, 200);
  workspace.resumeManager();
  const result = await managerResponse;
  assert.ok([403, 409].includes(result.status), `A project deadline must reject the stale manager write; got ${result.status}.`);
  assert.equal(workspace.store.get('jobs', 'job').deadline, '2026-11-01');
});

test('a manager progress edit cannot restore outdated private task metadata over a newer owner edit', async t => {
  const workspace = await concurrentWorkspace(t, 'jobs', {id: 'job', title: 'Garden care', type: 'Maintenance', status: 'Scheduled', date: '2026-10-23', crewIds: [], tasks: [{id: 'water', text: 'Water plants', done: false, privateCost: 100}]});
  const managerResponse = workspace.update('manager', {tasks: [{id: 'water', text: 'Water plants', done: true}]});
  await workspace.managerChecked;
  const ownerResponse = await workspace.update('owner', {tasks: [{id: 'water', text: 'Water plants', done: false, privateCost: 200}]});
  assert.equal(ownerResponse.status, 200);
  workspace.resumeManager();
  const result = await managerResponse;
  assert.ok([403, 409].includes(result.status), `Changed private task metadata must reject the stale manager write; got ${result.status}.`);
  assert.equal(workspace.store.get('jobs', 'job').tasks[0].privateCost, 200);
});
