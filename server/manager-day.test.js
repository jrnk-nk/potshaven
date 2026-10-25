import test from 'node:test';
import assert from 'node:assert/strict';
import {managerDay, dailyWorkBrief, checklistProgress} from '../src/manager-day.ts';

const date = '2026-10-23';
const workspace = {
  settings: {companyName: 'PotsHavenGh'},
  places: [{id: 'hotel', name: 'Palm Court', address: 'Accra'}],
  workers: [{id: 'ama', name: 'Ama', available: true, engagementType: 'Weekly', engagementEnd: '2026-10-25', agreedRate: 700, phone: 'private-number'}],
  vehicles: [{id: 'van', name: 'Crew van', registration: 'GR-123', status: 'Servicing'}],
  jobs: [
    {id: 'today', title: 'Entrance care', type: 'Maintenance', date, time: '08:00', status: 'Scheduled', placeId: 'hotel', crewIds: ['ama'], vehicleId: 'van', tasks: [{text: 'Water pots', done: false}, {text: 'Prune', done: true}, 'Photograph'], notes: 'Bring gloves.'},
    {id: 'late', title: 'Median care', type: 'Maintenance', date: '2026-10-22', status: 'In progress', crewIds: [], tasks: []},
    {id: 'project', title: 'Hotel installation', type: 'Project', date: '2026-10-20', deadline: '2026-10-28', status: 'In progress', crewIds: [], tasks: []},
    {id: 'confirm', title: 'Courtyard follow-up', type: 'Maintenance', date: '2026-10-21', status: 'Completed', crewIds: [], tasks: [{text: 'Final photo', done: false}]},
  ],
  inventory: [{id: 'plant', name: 'Peace lily', quantity: 2, minStock: 4, unit: 'plants'}],
  payments: [{description: 'Private invoice', amount: 9000, dueDate: date, status: 'Overdue'}],
  contracts: [{title: 'Private company contract', amount: 50000, renewalDate: date, status: 'Active'}],
};

test('manager day separates scheduled work, project deadlines, and unchecked completion', () => {
  const day = managerDay(workspace, date);
  assert.equal(day.scheduled.length, 1);
  assert.equal(day.overdue.length, 1);
  assert.equal(day.overdue[0].id, 'late');
  assert.deepEqual(new Set(day.attentionJobs.map(job => job.id)), new Set(['today', 'late', 'confirm']));
  assert.equal(day.completedUnchecked.length, 1);
  assert.deepEqual(checklistProgress(workspace.jobs[0]), {total: 3, done: 1, remaining: 2});
});

test('operations reminders use real assignment, stock, and engagement facts only', () => {
  const day = managerDay(workspace, date);
  assert.equal(day.assignmentChecks.length, 1);
  assert.match(day.assignmentChecks[0].warnings.join(' '), /servicing/);
  assert.equal(day.lowStock.length, 1);
  assert.equal(day.endingAgreements.length, 1);
  assert.ok(day.reminders.some(item => item.id === 'checklists'));
  assert.ok(!JSON.stringify(day.reminders).includes('Private invoice'));
  assert.ok(!JSON.stringify(day.reminders).includes('50000'));
  const empty = managerDay({}, date);
  assert.deepEqual(empty.reminders, []);
});

test('daily work brief preserves confirmation status and omits financial and contact records', () => {
  const before = structuredClone(workspace);
  const text = dailyWorkBrief(workspace, date);
  assert.match(text, /PotsHavenGh · Daily work plan/);
  assert.match(text, /Friday, 23 October 2026/);
  assert.match(text, /People: Ama/);
  assert.match(text, /Vehicle: Crew van · GR-123/);
  assert.match(text, /Pending: Water pots/);
  assert.match(text, /Done: Prune/);
  assert.match(text, /Unconfirmed: Photograph/);
  assert.match(text, /Median care · due 2026-10-22/);
  assert.match(text, /Courtyard follow-up · 1 unchecked/);
  assert.ok(!text.includes('private-number'));
  assert.ok(!text.includes('Private invoice'));
  assert.ok(!text.includes('Private company contract'));
  assert.ok(!text.includes('700'));
  assert.deepEqual(workspace, before);
});

test('a site-focused work plan preserves crew and vehicle warnings from other sites', () => {
  const data = structuredClone(workspace);
  data.jobs.push({...data.jobs[0], id: 'other-site', title: 'Other site visit', placeId: 'roundabout', time: '09:00'});
  const text = dailyWorkBrief(data, date, {siteId: 'hotel'});
  assert.match(text, /1 job scheduled/);
  assert.match(text, /Site focus: Palm Court/);
  assert.match(text, /Entrance care/);
  assert.ok(!text.includes('09:00 · Other site visit'));
  assert.ok(!text.includes('Median care · due'));
  assert.match(text, /Check: Ama.*Other site visit/);
  assert.match(text, /Check: Crew van.*Other site visit/);
});
