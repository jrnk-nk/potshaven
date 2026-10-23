// Conversational company management with mocked AI. No paid requests or real company records.
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {existsSync, mkdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = '/tmp/potshaven-checks';
mkdirSync(artifacts, {recursive: true});
const vite = await createServer({configFile: false, root, plugins: [react()], logLevel: 'error', server: {host: '127.0.0.1', port: 0}});
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({executablePath, headless: true, args: ['--no-sandbox']});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
page.setDefaultTimeout(15000);
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(error.message));
const collections = ['places', 'jobs', 'inventory', 'stockMovements', 'workers', 'vehicles', 'contracts', 'payments', 'expenses', 'purchaseRequests', 'equipment', 'issues', 'careGuides', 'designs'];
const state = Object.fromEntries(collections.map(name => [name, []]));
Object.assign(state, {
  settings: {companyName: 'PotsHavenGh', currency: 'GHS'},
  role: 'owner', demoMode: false, assistantConfigured: true, imageGenerationConfigured: true,
  places: [{id: 'hotel', name: 'Palm Court Hotel'}],
  workers: [{id: 'ama', name: 'Ama Mensah', status: 'Active'}],
  vehicles: [{id: 'pickup', name: 'Green pickup', registration: 'GR-100-26'}],
  jobs: [{id: 'hotel-job', title: 'Hotel entrance care', placeId: 'hotel', date: '2026-10-25', time: '08:00', type: 'Maintenance', status: 'Scheduled', crewIds: [], vehicleId: '', tasks: [{title: 'Water plants', done: false}]}],
});
const requests = [], writes = [];
let failure = false;
let briefings = 0;
let holdReply = false;
let releaseReply;
let failRead = false;
let failWrite = false;
let response = {
  reply: 'The hotel visit has no crew or vehicle. Here is a plan for you to review.',
  actions: [
    {id: 'assign', label: 'Assign the hotel visit', collection: 'jobs', operation: 'update', recordId: 'hotel-job', changes: {crewIds: ['ama'], vehicleId: 'pickup'}, warnings: ['Check travel time before confirming the route.']},
    {id: 'new', label: 'Schedule a follow-up visit', collection: 'jobs', operation: 'create', changes: {title: 'Hotel follow-up', placeId: 'hotel', date: '2026-10-30', time: '08:00', type: 'Maintenance', status: 'Scheduled', crewIds: ['ama'], vehicleId: 'pickup', tasks: [{title: 'Check irrigation', done: false}]}},
    {id: 'other-assignment', label: 'Alternative crew assignment', collection: 'jobs', operation: 'update', recordId: 'hotel-job', changes: {crewIds: []}},
  ],
};

try {
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/state') return route.fulfill({json: state});
    if (path === '/api/assistant/briefing') {
      briefings++;
      return route.fulfill({json: {summary: 'One visit needs people and transport.', items: [{id: 'hotel-unassigned', title: 'Hotel entrance care needs a crew', detail: 'Assign people before the visit.', page: 'schedule', kind: 'unassigned'}]}});
    }
    if (path === '/api/assistant' && request.method() === 'POST') {
      requests.push(request.postDataJSON());
      if (holdReply) await new Promise(resolve => {releaseReply = resolve;});
      else await new Promise(resolve => setTimeout(resolve, 120));
      if (failure) {failure = false; return route.fulfill({status: 502, json: {error: 'Your assistant is busy. Please try again.'}});}
      return route.fulfill({json: response});
    }
    if (path === '/api/jobs' && request.method() === 'GET') {
      if (failRead) {failRead = false; return route.fulfill({status: 503, json: {error: 'Records are temporarily unavailable.'}});}
      return route.fulfill({json: state.jobs});
    }
    if (path === '/api/jobs/hotel-job' && request.method() === 'PATCH') {
      const changes = request.postDataJSON();
      writes.push({method: request.method(), changes});
      Object.assign(state.jobs[0], changes);
      return route.fulfill({json: state.jobs[0]});
    }
    if (path === '/api/jobs' && request.method() === 'POST') {
      const changes = request.postDataJSON();
      writes.push({method: request.method(), changes});
      if (failWrite) {failWrite = false; return route.fulfill({status: 500, json: {error: 'The save result could not be confirmed.'}});}
      const job = {...changes, id: `created-${writes.length}`}; state.jobs.push(job);
      return route.fulfill({status: 201, json: job});
    }
    throw new Error(`Unexpected assistant API request: ${request.method()} ${path}`);
  });

  await page.goto(`${origin}/#assistant`);
  const assistant = page.getByRole('region', {name: 'Company assistant', exact: true});
  const composer = assistant.getByRole('textbox', {name: 'Message company assistant', exact: true});
  const send = assistant.getByRole('button', {name: 'Send assistant message', exact: true});
  await expect(composer).toBeVisible();
  await expect(assistant.getByText('Hotel entrance care needs a crew', {exact: true})).toBeVisible();
  await expect(send).toBeDisabled();
  await assistant.getByRole('button', {name: 'What needs attention?', exact: true}).click();
  await expect(composer).toHaveValue('What needs attention?');
  assert.equal(requests.length, 0, 'Suggestion chips must not make paid requests by themselves.');
  console.log('PASS assistant briefing uses saved workspace records and suggestion chips prepare a message');

  await composer.fill('Assign Ama and the pickup to the hotel visit, and prepare a follow-up.');
  await send.click();
  await expect(send).toBeDisabled();
  const assignment = assistant.getByRole('article', {name: 'Assign the hotel visit', exact: true});
  await expect(assignment).toBeVisible();
  await expect(assignment.getByText('Ama Mensah', {exact: true})).toBeVisible();
  await expect(assignment.getByText('Green pickup', {exact: true})).toBeVisible();
  await expect(assignment.getByText('Check travel time before confirming the route.', {exact: true})).toBeVisible();
  assert.equal(writes.length, 0, 'AI replies must not save changes without review.');
  assert.equal(requests.length, 1);
  assert.match(requests[0].today, /^\d{4}-\d{2}-\d{2}$/);
  await page.screenshot({path: join(artifacts, 'company-assistant-desktop.png'), fullPage: true});
  console.log('PASS proposed changes show named people, vehicles, checklist details and warnings before any write');

  await assignment.getByRole('button', {name: 'Save this change', exact: true}).click();
  await expect(assignment.getByRole('button', {name: 'Saved', exact: true})).toBeDisabled();
  assert.deepEqual(state.jobs[0].crewIds, ['ama']);
  assert.equal(state.jobs[0].vehicleId, 'pickup');
  assert.equal(writes.length, 1);
  const alternative = assistant.getByRole('article', {name: 'Alternative crew assignment', exact: true});
  await alternative.getByRole('button', {name: 'Save this change', exact: true}).click();
  await expect(alternative.getByText(/This record changed since the suggestion/)).toBeVisible();
  assert.equal(writes.length, 1, 'A stale suggestion must not overwrite a newer assignment.');
  const followup = assistant.getByRole('article', {name: 'Schedule a follow-up visit', exact: true});
  await followup.getByRole('button', {name: 'Save this change', exact: true}).click();
  await expect(followup.getByRole('button', {name: 'Saved', exact: true})).toBeDisabled();
  assert.equal(writes.length, 2);
  assert.equal(state.jobs.length, 2);
  assert.ok(briefings >= 2, 'Saving company work should update the briefing.');
  console.log('PASS individual changes persist once and stale proposals cannot overwrite newer records');

  response = {reply: 'The follow-up is ready. Ama has one incomplete task on the hotel visit.', actions: []};
  await composer.fill('Who still has unfinished work?');
  await composer.press('Enter');
  await expect(assistant.getByText(response.reply, {exact: true})).toBeVisible();
  assert.equal(requests.at(-1).history.length, 2);
  assert.equal(requests.at(-1).history[0].role, 'user');
  assert.equal(requests.at(-1).history[1].role, 'assistant');
  assert.equal(writes.length, 2);
  console.log('PASS conversational follow-ups include earlier messages and read-only answers make no changes');

  response = {reply: 'Here is the requested assignment.', actions: [{id: 'assign-after-change', label: 'Assign after date change', collection: 'jobs', operation: 'update', recordId: 'hotel-job', changes: {crewIds: ['ama'], vehicleId: 'pickup'}}]};
  holdReply = true;
  await composer.fill('Assign Ama and the pickup to the hotel visit.');
  await send.click();
  await expect.poll(() => typeof releaseReply).toBe('function');
  const previousBriefings = briefings;
  state.jobs[0].date = '2026-11-02';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => briefings).toBeGreaterThan(previousBriefings);
  holdReply = false; releaseReply();
  const changedDuringRequest = assistant.getByRole('article', {name: 'Assign after date change', exact: true});
  await changedDuringRequest.getByRole('button', {name: 'Save this change', exact: true}).click();
  await expect(changedDuringRequest.getByText(/This record changed since the suggestion/)).toBeVisible();
  assert.equal(writes.length, 2);
  assert.equal(state.jobs[0].date, '2026-11-02');
  console.log('PASS edits made in another session while the assistant is thinking cannot be overwritten by a stale proposal');

  response = {reply: 'Here are the requested instructions.', actions: [{id: 'instructions', label: 'Add access instructions', collection: 'jobs', operation: 'update', recordId: 'hotel-job', changes: {notes: 'Ask reception before entering.'}}]};
  await composer.fill('Add a note to ask reception before entering.');
  await send.click();
  const instructions = assistant.getByRole('article', {name: 'Add access instructions', exact: true});
  failRead = true;
  await instructions.getByRole('button', {name: 'Save this change', exact: true}).click();
  await expect(instructions.getByText(/The latest record could not be checked, so nothing was saved/)).toBeVisible();
  assert.equal(writes.length, 2);
  await instructions.getByRole('button', {name: 'Try checking again', exact: true}).click();
  await expect(instructions.getByRole('button', {name: 'Saved', exact: true})).toBeDisabled();
  assert.equal(writes.length, 3);
  console.log('PASS a failed freshness check makes no write and can be explicitly checked again');

  failure = true;
  await composer.fill('Help plan tomorrow');
  await send.click();
  await expect(assistant.locator('.ca-error')).toContainText('Your assistant is busy. Please try again.');
  await expect(composer).toHaveValue('Help plan tomorrow');
  assert.equal(writes.length, 3);
  console.log('PASS a failed assistant request keeps the draft without repeating a request or saving changes');

  await page.setViewportSize({width: 390, height: 844});
  await page.reload();
  await expect(composer).toBeVisible();
  await expect(assistant.getByRole('button', {name: /Needs attention/})).toHaveAttribute('aria-expanded', 'false');
  const layout = await assistant.evaluate(element => {const box = element.getBoundingClientRect(); const composer = element.querySelector('.ca-composer').getBoundingClientRect(); const thread = element.querySelector('.ca-thread').getBoundingClientRect(); const nav = document.querySelector('.mobile-bottom-nav').getBoundingClientRect(); return {width: document.documentElement.scrollWidth, viewport: innerWidth, composerTop: composer.top, composerBottom: composer.bottom, threadBottom: thread.bottom, navTop: nav.top, sectionBottom: box.bottom};});
  assert.ok(layout.width <= layout.viewport, 'Assistant must not cause horizontal overflow on a phone.');
  assert.ok(layout.composerTop >= layout.threadBottom - 1, 'Phone composer must stay below the scrollable conversation.');
  assert.ok(layout.composerBottom <= layout.navTop + 1, 'Phone navigation must not cover the composer.');
  await page.screenshot({path: join(artifacts, 'company-assistant-mobile.png'), fullPage: true});
  await assistant.getByRole('button', {name: /Needs attention/}).click();
  await expect(assistant.getByText('Hotel entrance care needs a crew', {exact: true})).toBeVisible();
  console.log('PASS mobile keeps the chat and composer clear with an expandable attention list');

  await page.setViewportSize({width: 360, height: 640});
  await page.reload();
  await expect(composer).toBeVisible();
  const shortPhone = await assistant.evaluate(element => {const composer = element.querySelector('.ca-composer').getBoundingClientRect(); const thread = element.querySelector('.ca-thread').getBoundingClientRect(); return {composerTop: composer.top, composerBottom: composer.bottom, threadBottom: thread.bottom, navTop: document.querySelector('.mobile-bottom-nav').getBoundingClientRect().top};});
  assert.ok(shortPhone.composerTop >= shortPhone.threadBottom - 1);
  assert.ok(shortPhone.composerBottom <= shortPhone.navTop + 1);
  response = {reply: 'Here is the new visit to review.', actions: [{id: 'uncertain', label: 'Create an extra hotel visit', collection: 'jobs', operation: 'create', changes: {title: 'Extra hotel visit', placeId: 'hotel', date: '2026-11-06', time: '08:00', type: 'Maintenance', status: 'Scheduled', crewIds: [], tasks: []}}]};
  await composer.fill('Prepare an extra hotel visit for November 6.');
  await send.click();
  const uncertain = assistant.getByRole('article', {name: 'Create an extra hotel visit', exact: true});
  failWrite = true;
  await uncertain.getByRole('button', {name: 'Save this change', exact: true}).click();
  await expect(uncertain.getByText(/Check your records before asking for the change again/)).toBeVisible();
  await expect(uncertain.getByRole('button', {name: 'Review your records', exact: true})).toBeDisabled();
  assert.equal(writes.length, 4);
  assert.equal(state.jobs.length, 2);
  console.log('PASS a short phone keeps the composer visible and an unconfirmed save cannot be submitted twice');

  state.assistantConfigured = false;
  await page.reload();
  await expect(assistant.getByText(/Connect your assistant in/)).toBeVisible();
  await composer.fill('Plan my work');
  await expect(send).toBeDisabled();
  await assistant.getByRole('button', {name: /Needs attention/}).click();
  await expect(assistant.getByText('Hotel entrance care needs a crew', {exact: true})).toBeVisible();
  assert.deepEqual(runtimeErrors, []);
  console.log('PASS the attention list remains available without an AI key while paid assistant requests are disabled');
} finally {
  await browser.close();
  await vite.close();
}
