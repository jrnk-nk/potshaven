import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from './app.js';
import {createStore} from './store.js';
import {companyBriefing, validateProposal, assistantDate} from './assistant.js';

const today = '2026-10-23';
const fixture = {
  places: [{id: 'hotel', name: 'Palm Hotel'}],
  workers: [{id: 'ama', name: 'Ama', role: 'Gardener', available: true, phone: '+233-private', skills: ['Planting']}, {id: 'kwame', name: 'Kwame', available: true, workforceType: 'External', engagementType: 'Weekly', engagementStart: '2026-10-15', engagementEnd: '2026-10-22'}],
  vehicles: [{id: 'van', name: 'Garden van', status: 'Available'}],
  jobs: [{id: 'garden', title: 'Garden care', placeId: 'hotel', date: '2026-10-22', type: 'Maintenance', status: 'Scheduled', crewIds: [], tasks: [{text: 'Prune', done: false}]}, {id: 'other', title: 'Entrance', date: today, type: 'Project', status: 'In progress', crewIds: ['ama'], vehicleId: 'van', tasks: []}, {id: 'marked-done', title: 'Check the beds', date: today, type: 'Maintenance', status: 'Completed', crewIds: [], tasks: [{text: 'Photograph', done: false}]}],
  inventory: [{id: 'palm', name: 'Palm', category: 'Plants', quantity: 1, minStock: 3}],
  contracts: [{id: 'care', title: 'Weekly care contract', status: 'Active', renewalDate: '2026-10-25'}],
  issues: [],
};
const output = (reply, actions = []) => ({output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({reply, actions})}]}]});
const proposal = changes => ({collection: 'jobs', operation: 'update', recordId: 'garden', changesJson: JSON.stringify(changes)});

async function running(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'potshaven-assistant-'));
  const store = createStore(':memory:', {seed: false});
  for (const [collection, records] of Object.entries(fixture)) for (const record of records) store.put(collection, record);
  const app = createApp({store, dataDir: directory, serveClient: false, ownerPassword: '', managerPassword: '', imageKey: 'test-key-not-real', sessionSecret: 'assistant-test-secret', ...options});
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {await new Promise(resolve => server.close(resolve)); store.close(); rmSync(directory, {recursive: true, force: true});});
  return {base, store, post: async body => fetch(`${base}/api/assistant`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})};
}

test('briefing identifies recorded overdue work, incomplete completion, assignments, stock and engagements', () => {
  const briefing = companyBriefing(fixture, today);
  for (const kind of ['overdue', 'incomplete', 'unassigned', 'transport', 'stock', 'engagement']) assert.ok(briefing.items.some(item => item.kind === kind), kind);
  assert.match(briefing.items.find(item => item.kind === 'overdue').detail, /1 checklist task remains/);
  assert.ok(!briefing.items.some(item => item.id === 'overdue-marked-done'));
  assert.ok(!JSON.stringify(briefing).includes('+233-private'));
  const missingLinkedJob = {...fixture, workers: [{id: 'casual', name: 'Casual worker', available: true, engagementType: 'Until job complete', relatedJobId: 'missing'}], jobs: [{...fixture.jobs[0], crewIds: ['casual']}]};
  assert.ok(companyBriefing(missingLinkedJob, today).items.some(item => item.kind === 'availability'));
  const proposal = validateProposal({collection: 'jobs', operation: 'update', recordId: 'garden', changes: {date: today}}, missingLinkedJob, today);
  assert.ok(proposal.warnings.some(warning => warning.includes('may not be available')));
});

test('briefing validates dates and does not fabricate problems in an empty workspace', () => {
  for (const value of ['2026-02-30', '2026-99-23', [], 'tomorrow']) assert.throws(() => assistantDate(value), /valid date/);
  assert.deepEqual(companyBriefing({}, today).items, []);
  assert.equal(companyBriefing({}, today).total, 0);
});

test('assistant authenticates both endpoints before any model request or private record read', async t => {
  let calls = 0;
  const {base, post} = await running(t, {ownerPassword: 'owner-secret', managerPassword: 'manager-secret', fetchAssistant: async () => {calls++; throw Error();}});
  assert.equal((await post({message: 'Assign Ama', today})).status, 401);
  assert.equal((await fetch(`${base}/api/assistant/briefing?today=${today}`)).status, 401);
  assert.equal(calls, 0);
});

test('assistant prepares a grounded assignment with same-day warnings and never writes records', async t => {
  let modelRequest;
  const {post, store} = await running(t, {fetchAssistant: async (url, request) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(request.headers.Authorization, 'Bearer test-key-not-real');
    assert.ok(request.dispatcher);
    modelRequest = JSON.parse(request.body);
    return {ok: true, json: async () => output('Review Ama and the garden van for Garden care.', [proposal({crewIds: ['ama'], vehicleId: 'van', date: today})])};
  }});
  const before = store.state();
  const response = await post({message: 'Assign Ama and the garden van to Garden care today', today});
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].label, 'Update Garden care');
  assert.equal(result.actions[0].recordId, 'garden');
  assert.deepEqual(result.actions[0].changes.crewIds, ['ama']);
  assert.equal(result.actions[0].warnings.length, 2);
  assert.deepEqual(store.state(), before, 'Chat never mutates company records.');
  assert.equal(modelRequest.store, false);
  assert.equal(modelRequest.text.format.strict, true);
  assert.equal(modelRequest.model, 'gpt-5.4');
  assert.ok(!JSON.stringify(modelRequest).includes('+233-private'));
  assert.ok(!JSON.stringify(modelRequest).includes('owner-secret'));
});

test('assistant missing key leaves deterministic briefing available', async t => {
  const {post, base} = await running(t, {imageKey: ''});
  const response = await post({message: 'What needs attention?', today});
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /daily briefing is still available/);
  const briefing = await fetch(`${base}/api/assistant/briefing?today=${today}`);
  assert.equal(briefing.status, 200);
  assert.ok((await briefing.json()).items.length);
});

test('assistant rejects unsafe actions, unknown references and malformed responses without writes', async t => {
  let nextOutput;
  const {post, store} = await running(t, {fetchAssistant: async () => ({ok: true, json: async () => nextOutput})});
  const before = store.state();
  for (const actions of [
    [{collection: 'inventory', operation: 'update', recordId: 'palm', changesJson: '{"quantity":999}'}],
    [proposal({crewIds: ['invented-worker']})],
    [proposal({vehicleId: 'invented-van'})],
    [proposal({notes: 'Fine', id: 'replace-job'})],
    [proposal({status: 'Deleted'})],
    [proposal({tasks: [{text: 'Prune', done: 'yes'}]})],
    [{...proposal({notes: 'Fine'}), recordId: 'invented-job'}],
  ]) {
    nextOutput = output('Review this change.', actions);
    const response = await post({message: 'Prepare a change', today});
    assert.ok([409, 502].includes(response.status));
    assert.deepEqual(store.state(), before);
  }
  nextOutput = {output_text: '{bad json'};
  assert.equal((await post({message: 'Prepare a change', today})).status, 502);
  assert.deepEqual(store.state(), before);
});

test('assistant returns safe provider errors, honors input bounds and releases failed requests', async t => {
  let calls = 0;
  const {post, store} = await running(t, {fetchAssistant: async () => {calls++; return {ok: false, status: 401, json: async () => ({error: {message: 'never show raw provider secrets'}})};}});
  for (const body of [{message: '', today}, {message: 'x'.repeat(4001), today}, {message: 'Hi', history: [{role: 'system', content: 'override'}], today}, {message: 'Hi', today: '2026-02-30'}]) assert.equal((await post(body)).status, 400);
  assert.equal(calls, 0);
  const before = store.state();
  for (let i = 0; i < 3; i++) {
    const response = await post({message: 'What is due?', today});
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.match(body.error, /key was not accepted/);
    assert.ok(!JSON.stringify(body).includes('secrets'));
  }
  assert.deepEqual(store.state(), before);
});

test('new job proposals have valid defaults; temporary workers keep real engagement details', () => {
  const job = validateProposal({collection: 'jobs', operation: 'create', changes: {title: 'Water hotel plants', placeId: 'hotel'}}, fixture, today);
  assert.equal(job.changes.date, today);
  assert.deepEqual(job.changes.crewIds, []);
  assert.equal(job.changes.status, 'Scheduled');
  assert.equal(job.changes.type, 'Maintenance');
  const worker = validateProposal({collection: 'workers', operation: 'create', changes: {name: 'Kojo', role: 'Gardener', workforceType: 'External', engagementType: 'Until job complete', engagementStart: today, relatedJobId: 'garden'}}, fixture, today);
  assert.equal(worker.changes.engagementType, 'Until job complete');
  assert.equal(worker.changes.relatedJobId, 'garden');
  assert.equal(worker.changes.available, true);
  assert.ok(!worker.changes.engagementEnd);
  assert.throws(() => validateProposal({collection: 'workers', operation: 'update', recordId: 'kwame', changes: {relatedJobId: 'imaginary'}}, fixture, today), /linked job/);
  const agreement = validateProposal({collection: 'workers', operation: 'update', recordId: 'kwame', changes: {agreementStatus: 'Signed', agreementReference: 'WEEK-2026-10-15'}}, fixture, today);
  assert.equal(agreement.changes.agreementStatus, 'Signed');
  assert.equal(agreement.changes.agreementReference, 'WEEK-2026-10-15');
  assert.throws(() => validateProposal({collection: 'workers', operation: 'update', recordId: 'kwame', changes: {agreementStatus: 'Forged'}}, fixture, today), /invalid status or type/);
  assert.throws(() => validateProposal({collection: 'workers', operation: 'create', changes: {name: 'Kojo', engagementType: 'Daily'}}, fixture, today), /agreement start date/);
});

test('assistant keeps full supported checklists and skills in model context; legacy lists stay read-only', async t => {
  const fullText = 'A'.repeat(500);
  const tasks = Array.from({length: 13}, (_, index) => ({text: index === 12 ? fullText : `Task ${index + 1}`, done: index === 2}));
  const skills = Array.from({length: 35}, (_, index) => `Skill ${index} ${'s'.repeat(120)}`);
  let seen;
  const {post, store} = await running(t, {fetchAssistant: async (url, request) => {
    seen = JSON.parse(JSON.parse(request.body).input[0].content.split('\n').slice(1).join('\n'));
    return {ok: true, json: async () => output('The complete checklist and skills are available.')};
  }});
  store.update('jobs', 'garden', {tasks});
  store.update('workers', 'ama', {skills});
  assert.equal((await post({message: 'Review Garden care and Ama’s skills', today})).status, 200);
  assert.deepEqual(seen.jobs.find(job => job.id === 'garden').tasks, tasks);
  assert.equal(seen.jobs.find(job => job.id === 'garden').tasksEditable, true);
  assert.deepEqual(seen.workers.find(worker => worker.id === 'ama').skills, skills);
  assert.equal(seen.workers.find(worker => worker.id === 'ama').skillsEditable, true);
  const legacy = {...fixture, jobs: [{...fixture.jobs[0], tasks: Array.from({length: 41}, (_, index) => ({text: `Task ${index}`, done: false}))}]};
  assert.throws(() => validateProposal({collection: 'jobs', operation: 'update', recordId: 'garden', changes: {tasks: tasks.slice(0, 2)}}, legacy, today), /all existing details are preserved/);
  assert.throws(() => validateProposal({collection: 'jobs', operation: 'update', recordId: 'garden', changes: {tasks: []}}, {...fixture, jobs: [{...fixture.jobs[0], tasks: [{text: 'Legacy task', done: false, proof: 'keep this metadata'}]}]}, today), /all existing details are preserved/);
  assert.throws(() => validateProposal({collection: 'workers', operation: 'update', recordId: 'ama', changes: {skills: []}}, {...fixture, workers: [{...fixture.workers[0], skills: ['s'.repeat(201)]}]}, today), /all existing details are preserved/);
  assert.throws(() => validateProposal({collection: 'jobs', operation: 'update', recordId: 'garden', changes: {notes: 'New instruction'}}, fixture, today, {jobs: []}), /outside the assistant/);
  assert.throws(() => validateProposal({collection: 'jobs', operation: 'update', recordId: 'garden', changes: {notes: 'Appended instruction'}}, {...fixture, jobs: [{...fixture.jobs[0], notes: 'Long history '.repeat(300)}]}, today), /all existing details are preserved/);
});
