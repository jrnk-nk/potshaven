// Conversational company management with mocked AI. No paid requests or real company records.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
let changeAfterRead = false;
const savedChats = new Map();
let failChatSave = false, holdChatRead = false, releaseChatRead;
const memoryWrites = [];
let serverSaves = false, serverHistoryFailure = false;
function commitExchange(id, pair) {
  const key = state.role + ':' + id, previous = savedChats.get(key);
  const chat = {id, role: state.role, title: previous?.title || pair.user.slice(0, 100), updatedAt: new Date().toISOString(), version: pair.expectedVersion + 1, messages: [...(previous?.messages || []), {id: pair.exchangeId + ':user', role: 'user', content: pair.user}, {id: pair.exchangeId + ':assistant', role: 'assistant', content: pair.assistant}]};
  savedChats.set(key, chat); return chat;
}
let response = {
  reply: 'The hotel visit has no crew or vehicle. Here is a plan for you to review.',
  actions: [
    {id: 'assign', label: 'Assign the hotel visit', collection: 'jobs', operation: 'update', recordId: 'hotel-job', changes: {crewIds: ['ama'], vehicleId: 'pickup'}, warnings: ['Check travel time before confirming the route.']},
    {id: 'new', label: 'Schedule a follow-up visit', collection: 'jobs', operation: 'create', changes: {title: 'Hotel follow-up', placeId: 'hotel', date: '2026-10-30', time: '08:00', type: 'Maintenance', status: 'Scheduled', crewIds: ['ama'], vehicleId: 'pickup', tasks: [{title: 'Check irrigation', done: false}]}},
    {id: 'other-assignment', label: 'Alternative crew assignment', collection: 'jobs', operation: 'update', recordId: 'hotel-job', changes: {crewIds: []}},
    {id: 'pay', label: 'Change worker pay', collection: 'workers', operation: 'update', recordId: 'ama', changes: {agreedRate: 900, rateBasis: 'Daily'}},
    {id: 'budget', label: 'Set visit budget', collection: 'jobs', operation: 'update', recordId: 'hotel-job', changes: {budget: 1200}},
    {id: 'nested-cost', label: 'Add costed task', collection: 'jobs', operation: 'update', recordId: 'hotel-job', changes: {tasks: [{title: 'Water plants', done: true, unitCost: 20}]}},
    {id: 'receipt', label: 'Link receipt details', collection: 'issues', operation: 'create', changes: {title: 'Review supply', receiptReference: 'private-reference'}},
  ],
};

try {
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/state') return route.fulfill({json: state});
    if (path === '/api/activity') return route.fulfill({json: {items: [], unreadCount: 0}});
    if (path === '/api/assistant/conversations' && request.method() === 'GET') {
      const items = [...savedChats.values()].filter(chat => chat.role === state.role).map(({id, title, updatedAt, version, messages}) => ({id, title, updatedAt, version, messageCount: messages.length}));
      const offset = Number(new URL(request.url()).searchParams.get('offset') || 0);
      return route.fulfill({json: {items: items.slice(offset, offset + 50), total: items.length, nextOffset: offset + 50 < items.length ? offset + 50 : null}});
    }
    if (path.startsWith('/api/assistant/conversations/')) {
      const id = path.split('/').at(-1), key = state.role + ':' + id;
      const previous = savedChats.get(key);
      if (request.method() === 'GET') {
        const snapshot = structuredClone(previous);
        if (holdChatRead) await new Promise(resolve => {releaseChatRead = resolve;});
        return route.fulfill(snapshot ? {json: snapshot} : {status: 404, json: {error: 'Conversation not found.'}});
      }
      if (request.method() === 'PUT') {
        const pair = request.postDataJSON(); memoryWrites.push(pair);
        if (failChatSave) {failChatSave = false; return route.fulfill({status: 503, json: {error: 'Conversation storage is temporarily unavailable.'}});}
        if (previous?.messages.some(message => message.id === pair.exchangeId + ':user')) return route.fulfill({json: previous});
        if ((previous?.version || 0) !== pair.expectedVersion) return route.fulfill({status: 409, json: {error: 'This conversation changed. Reopen the saved conversation before continuing.'}});
        return route.fulfill({json: commitExchange(id, pair)});
      }
    }
    if (path === '/api/assistant/briefing') {
      briefings++;
      return route.fulfill({json: {summary: 'One visit needs people and transport.', items: [{id: 'hotel-unassigned', title: 'Hotel entrance care needs a crew', detail: 'Assign people before the visit.', page: 'schedule', kind: 'unassigned', severity: 'urgent', href: '#sites?site=hotel'}]}});
    }
    if (path === '/api/assistant' && request.method() === 'POST') {
      requests.push(request.postDataJSON());
      if (holdReply) await new Promise(resolve => {releaseReply = resolve;});
      else await new Promise(resolve => setTimeout(resolve, 120));
      if (failure) {failure = false; return route.fulfill({status: 502, json: {error: 'Your assistant is busy. Please try again.'}});}
      if (serverSaves) {
        const {conversation, message} = request.postDataJSON();
        assert.ok(conversation?.id && conversation.exchangeId && Number.isSafeInteger(conversation.expectedVersion));
        if (serverHistoryFailure) {serverHistoryFailure = false; return route.fulfill({json: {...response, historyError: 'The reply is ready but history could not be saved.'}});}
        return route.fulfill({json: {...response, conversation: commitExchange(conversation.id, {...conversation, user: message, assistant: response.reply})}});
      }
      return route.fulfill({json: response});
    }
    if (path === '/api/purchaseRequests' && request.method() === 'POST') {
      const changes = request.postDataJSON(); writes.push({method: 'POST', collection: 'purchaseRequests', changes});
      const item = {...changes, id: randomUUID(), status: 'Pending', requestedBy: state.role}; state.purchaseRequests.push(item);
      return route.fulfill({status: 201, json: item});
    }
    if (path === '/api/jobs' && request.method() === 'GET') {
      if (failRead) {failRead = false; return route.fulfill({status: 503, json: {error: 'Records are temporarily unavailable.'}});}
      if (changeAfterRead) {
        changeAfterRead = false;
        const snapshot = structuredClone(state.jobs);
        state.jobs[0].notes = 'New instruction from another session';
        return route.fulfill({json: snapshot});
      }
      return route.fulfill({json: state.jobs});
    }
    if (path === '/api/jobs/hotel-job' && request.method() === 'PATCH') {
      const {_expected, ...changes} = request.postDataJSON();
      assert.ok(_expected, 'Assistant updates must carry the record used to prepare the suggestion.');
      writes.push({method: request.method(), changes, expected: _expected});
      if (JSON.stringify(_expected) !== JSON.stringify(state.jobs[0])) return route.fulfill({status: 409, json: {error: 'This record changed. Refresh and try again.'}});
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
  await expect(assistant.getByRole('link', {name: /Hotel entrance care needs a crew/})).toHaveAttribute('href', '#sites?site=hotel');
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
  await expect(assistant.locator('.ca-proposal')).toHaveCount(3);
  await expect(assistant.getByText('Conversation saved', {exact: true})).toBeVisible();
  for (const label of ['Change worker pay', 'Set visit budget', 'Add costed task', 'Link receipt details']) await expect(assistant.getByRole('article', {name: label, exact: true})).toHaveCount(0);
  await expect(assistant.locator('.ca-proposal').getByText(/Agreed pay|Pay basis|Budget|Unit Cost|Receipt Reference/)).toHaveCount(0);
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
  assert.ok(writes.every(write => !/agreedRate|rateBasis|budget|unitCost|receiptReference/.test(JSON.stringify(write.changes))));
  console.log('PASS financial suggestions are suppressed while operational changes save once and stale proposals stay blocked');

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
  const interruptedRequest = structuredClone(requests.at(-1));
  response = {reply: 'The original planning reply is ready for review.', actions: []};
  await send.click();
  await expect(assistant.getByText(response.reply, {exact: true})).toBeVisible();
  assert.deepEqual(requests.at(-1), interruptedRequest, 'An explicit retry keeps its original exchange ID, context and date.');
  assert.equal(writes.length, 3);
  console.log('PASS retrying an interrupted message retains the original request reference for safe server recovery');

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

  state.assistantConfigured = true;
  await page.setViewportSize({width: 1440, height: 1000});
  await page.reload();
  await expect(composer).toBeVisible();
  response = {reply: 'Owner-only salary review details.', actions: []};
  holdReply = true; releaseReply = undefined;
  await composer.fill('Review confidential owner agreements.');
  await send.click();
  await expect.poll(() => typeof releaseReply).toBe('function');
  state.role = 'manager';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(assistant.getByText('Plan visits. Assign your team. Follow up on unfinished work.', {exact: true})).toBeVisible();
  holdReply = false; releaseReply();
  await page.waitForTimeout(200);
  await expect(assistant.getByText('Owner-only salary review details.', {exact: true})).toHaveCount(0);
  await expect(assistant.getByText('Review confidential owner agreements.', {exact: true})).toHaveCount(0);
  await expect(composer).toHaveValue('');
  response = {reply: 'Your operational work is ready to review.', actions: []};
  await composer.fill('What jobs need attention?');
  await send.click();
  await expect(assistant.getByText(response.reply, {exact: true})).toBeVisible();
  assert.deepEqual(requests.at(-1).history, [], 'A manager conversation must not include earlier owner chat.');
  assert.deepEqual(runtimeErrors, []);
  console.log('PASS a role change clears earlier owner chat and discards late owner responses before manager use');

  response = {reply: 'Review the updated care instructions.', actions: [{id: 'race', label: 'Update care instructions', collection: 'jobs', operation: 'update', recordId: 'hotel-job', changes: {notes: 'Replace the earlier care instructions'}}]};
  await composer.fill('Update the care instructions for the hotel visit.');
  await send.click();
  const racedProposal = assistant.getByRole('article', {name: 'Update care instructions', exact: true});
  await expect(racedProposal).toBeVisible();
  const writesBeforeRace = writes.length;
  changeAfterRead = true;
  await racedProposal.getByRole('button', {name: 'Save this change', exact: true}).click();
  await expect(racedProposal.getByRole('alert')).toContainText('This record changed');
  await expect(racedProposal.getByRole('button', {name: 'Review your records', exact: true})).toBeDisabled();
  assert.equal(writes.length, writesBeforeRace + 1);
  assert.notEqual(writes.at(-1).expected.notes, state.jobs[0].notes);
  assert.equal(state.jobs[0].notes, 'New instruction from another session');
  assert.deepEqual(runtimeErrors, []);
  console.log('PASS the server precondition protects an assistant suggestion when another edit lands after its freshness check');

  const managerChat = [...savedChats.values()].find(chat => chat.role === 'manager');
  assert.ok(managerChat);
  await page.reload();
  await expect(composer).toBeVisible();
  await assistant.getByRole('button', {name: 'Saved chats', exact: true}).click();
  const savedDialog = page.getByRole('dialog', {name: 'Saved conversations', exact: true});
  await expect(savedDialog.getByText(managerChat.title, {exact: true})).toBeVisible();
  await expect(savedDialog.getByText('Assign Ama and the pickup to the hotel visit, and prepare a follow-up.', {exact: true})).toHaveCount(0);
  await savedDialog.getByRole('button', {name: new RegExp(managerChat.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}).click();
  await expect(assistant.getByText('Review the updated care instructions.', {exact: true})).toBeVisible();
  await expect(assistant.locator('.ca-proposal')).toHaveCount(0);
  await expect(assistant.getByRole('button', {name: 'Save this change', exact: true})).toHaveCount(0);
  response = {reply: 'The recorded hotel work can be reviewed here.', actions: [], contextScope: {message: 'Focused on Palm Court Hotel. Some older records may be outside this view.'}};
  await assistant.getByRole('combobox', {name: 'Assistant site focus'}).selectOption('hotel');
  await composer.fill('Review this site’s recorded progress.'); await send.click();
  await expect(assistant.getByText(response.reply, {exact: true})).toBeVisible();
  await expect(assistant.getByText('Conversation saved', {exact: true})).toBeVisible();
  assert.equal(requests.at(-1).siteId, 'hotel');
  assert.ok(requests.at(-1).history.some(message => message.content === 'Review the updated care instructions.'));
  await expect(assistant.getByText(response.contextScope.message, {exact: true})).toBeVisible();
  console.log('PASS saved role-specific conversations reopen after reload, carry context, and never replay old proposals');

  failChatSave = true; response = {reply: 'This reply remains visible while its conversation save is checked.', actions: []};
  const aiBeforeFailure = requests.length;
  await composer.fill('Help with tomorrow’s crew.'); await send.click();
  await expect(assistant.getByText(response.reply, {exact: true})).toBeVisible();
  await expect(assistant.locator('.ca-memory-error')).toContainText('Conversation save not confirmed');
  await composer.fill('A new request waits for this conversation to save.');
  await expect(send).toBeDisabled();
  const failedPair = memoryWrites.at(-1);
  await assistant.getByRole('button', {name: 'Save conversation again', exact: true}).click();
  await expect(assistant.getByText('Conversation saved', {exact: true})).toBeVisible();
  assert.equal(requests.length, aiBeforeFailure + 1, 'Retrying history must not make another paid assistant request.');
  assert.deepEqual(memoryWrites.at(-1), failedPair, 'History retry must retain stable exchange identity.');
  await assistant.getByRole('button', {name: 'New chat', exact: true}).click();
  const leaveDialog = page.getByRole('dialog', {name: 'Leave this conversation?', exact: true});
  await expect(leaveDialog).toBeVisible();
  await leaveDialog.getByRole('button', {name: 'Keep this conversation', exact: true}).click();
  await expect(composer).toHaveValue('A new request waits for this conversation to save.');
  await composer.fill('');
  await assistant.getByRole('button', {name: 'New chat', exact: true}).click();
  await expect(assistant.locator('.ca-message')).toHaveCount(0);
  console.log('PASS failed chat saves preserve replies, retry without AI calls, and warn before discarding unsent drafts');

  state.places.push({id: 'other-site', name: 'Another hotel'});
  state.jobs.push({id: 'other-visit', title: 'Another hotel visit', placeId: 'other-site', date: '2026-11-02', time: '10:00', type: 'Maintenance', status: 'Scheduled', crewIds: ['ama'], vehicleId: 'pickup', tasks: []});
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(assistant.getByRole('combobox', {name: 'Assistant site focus'}).locator('option[value="other-site"]')).toHaveCount(1);
  const writesBeforePlan = writes.length, aiBeforePlan = requests.length;
  await assistant.getByRole('button', {name: 'Work plan', exact: true}).click();
  const planDialog = page.getByRole('dialog', {name: 'Your work plan', exact: true});
  await planDialog.getByLabel('Work plan date', {exact: true}).fill('2026-11-02');
  const planPreview = planDialog.getByRole('textbox', {name: 'Work plan preview', exact: true});
  await expect(planPreview).toContainText('Hotel entrance care');
  await expect(planPreview).toContainText('1 job scheduled');
  await expect(planPreview).toContainText('Ama Mensah also has Another hotel visit');
  await expect(planPreview).toContainText('Green pickup is also assigned to Another hotel visit');
  await expect(planPreview).not.toContainText('Site: Another hotel');
  const whatsapp = planDialog.getByRole('link', {name: 'Open WhatsApp', exact: true});
  await expect(whatsapp).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
  await expect(planDialog.getByText('Nothing is sent until you send it in WhatsApp.', {exact: true})).toBeVisible();
  assert.equal(writes.length, writesBeforePlan); assert.equal(requests.length, aiBeforePlan);
  await planDialog.getByRole('button', {name: 'Close dialog', exact: true}).click();
  console.log('PASS a dated site work plan is previewed for manual WhatsApp sharing without writes or paid requests');

  state.role = 'owner'; await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(assistant.getByText('Plan the work. Find what needs care. Keep things moving.', {exact: true})).toBeVisible();
  await assistant.getByRole('button', {name: 'Saved chats', exact: true}).click();
  const ownerChat = [...savedChats.values()].find(chat => chat.role === 'owner');
  holdChatRead = true; releaseChatRead = undefined;
  await savedDialog.getByRole('button', {name: new RegExp(ownerChat.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}).click();
  await expect.poll(() => typeof releaseChatRead).toBe('function');
  state.role = 'manager'; await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(assistant.getByText('Plan visits. Assign your team. Follow up on unfinished work.', {exact: true})).toBeVisible();
  holdChatRead = false; releaseChatRead();
  await expect(savedDialog).toHaveCount(0);
  await expect(assistant.getByText(ownerChat.messages[0].content, {exact: true})).toHaveCount(0);
  assert.deepEqual(runtimeErrors, []);
  console.log('PASS a late saved owner conversation cannot appear after switching to the manager account');

  const beforeFocus = briefings, beforeRefreshAi = requests.length;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => briefings).toBeGreaterThan(beforeFocus);
  const beforeHidden = briefings;
  await page.evaluate(() => {Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'}); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(150);
  assert.equal(briefings, beforeHidden);
  await page.evaluate(() => {Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'}); document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(() => briefings).toBeGreaterThan(beforeHidden);
  assert.equal(requests.length, beforeRefreshAi);
  console.log('PASS attention checks refresh on return to the visible app without automatic paid requests');

  serverSaves = true;
  const beforeServerSave = memoryWrites.length;
  response = {reply: 'A supply request is ready for your review.', actions: [{id: 'supply', label: 'Request twelve nursery pots', collection: 'purchaseRequests', operation: 'create', changes: {title: 'Nursery pots', quantity: 12, requestType: 'Restock', placeId: 'hotel', status: 'Pending', requestedBy: 'manager'}}]};
  await composer.fill('Prepare a request for twelve nursery pots for the hotel.'); await send.click();
  const supplyProposal = assistant.getByRole('article', {name: 'Request twelve nursery pots', exact: true});
  await expect(supplyProposal).toBeVisible();
  await expect(assistant.getByText('Conversation saved', {exact: true})).toBeVisible();
  assert.equal(memoryWrites.length, beforeServerSave, 'A server-confirmed conversation needs no second history write.');
  assert.equal(state.purchaseRequests.length, 0, 'The assistant must not submit a supply request before review.');
  await supplyProposal.getByRole('button', {name: 'Save this change', exact: true}).click();
  await expect(supplyProposal.getByRole('button', {name: 'Saved', exact: true})).toBeDisabled();
  assert.equal(state.purchaseRequests[0].status, 'Pending'); assert.equal(state.purchaseRequests[0].quantity, 12);
  console.log('PASS server-confirmed history avoids a second write and supply requests wait for review and owner approval');

  serverHistoryFailure = true; response = {reply: 'This answer is ready while the server’s history save needs a check.', actions: []};
  await composer.fill('Check the transport needs.'); await send.click();
  await expect(assistant.locator('.ca-memory-error')).toContainText('Conversation save not confirmed');
  assert.equal(memoryWrites.length, beforeServerSave, 'An uncertain server history save must not automatically be retried.');
  const uncertainRequest = requests.at(-1).conversation, aiBeforeHistoryRetry = requests.length;
  await assistant.getByRole('button', {name: 'Save conversation again', exact: true}).click();
  await expect(assistant.getByText('Conversation saved', {exact: true})).toBeVisible();
  assert.equal(memoryWrites.at(-1).exchangeId, uncertainRequest.exchangeId); assert.equal(requests.length, aiBeforeHistoryRetry);
  console.log('PASS an uncertain server history save waits for explicit retry with its original exchange ID');

  for (let index = 0; index < 51; index++) {
    const id = randomUUID(); savedChats.set('manager:' + id, {id, role: 'manager', title: `Earlier conversation ${index + 1}`, updatedAt: new Date().toISOString(), version: 1, messages: [{id: id + ':user', role: 'user', content: 'An older saved message'}, {id: id + ':assistant', role: 'assistant', content: 'An older saved reply'}]});
  }
  await assistant.getByRole('button', {name: 'Saved chats', exact: true}).click();
  await expect(savedDialog.getByRole('button', {name: 'Load more conversations', exact: true})).toBeVisible();
  await expect(savedDialog.getByText('Earlier conversation 51', {exact: true})).toHaveCount(0);
  await savedDialog.getByRole('button', {name: 'Load more conversations', exact: true}).click();
  await expect(savedDialog.getByText('Earlier conversation 51', {exact: true})).toBeVisible();
  await expect(savedDialog.getByRole('button', {name: 'Load more conversations', exact: true})).toHaveCount(0);
  assert.deepEqual(runtimeErrors, []);
  console.log('PASS older saved conversations remain reachable through history pagination');


} finally {
  await browser.close();
  await vite.close();
}
