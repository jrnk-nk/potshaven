// Conversational design workflows with mocked image generation. No paid API calls.
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {existsSync, mkdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = process.env.STUDIO_ARTIFACT_DIR || '/tmp/potshaven-checks';
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
  settings: {companyName: 'PotsHavenGh', logo: '/branding/potshaven-logo.png', tagline: 'Brighten your world', watermark: 'Designed by PotsHavenGh', currency: 'GHS'},
  role: 'owner', demoMode: false, imageGenerationConfigured: true,
  places: [{id: 'place-hotel', name: 'Garden Hotel', client: 'Hotel manager'}, {id: 'place-court', name: 'Palm Court', client: 'Court manager'}],
  inventory: [{id: 'plant-1', name: 'Bird of paradise', category: 'Plants', quantity: 18, minStock: 2, unit: 'pots'}, {id: 'plant-2', name: 'Snake plant', category: 'Plants', quantity: 7, minStock: 1, unit: 'plants'}, {id: 'plant-empty', name: 'Out-of-stock fern', category: 'Plants', quantity: 0, minStock: 1}, {id: 'tool-1', name: 'Pruning shears', category: 'Tools', quantity: 4, minStock: 1}],
});
const generationRequests = [];
let failNextGeneration = false;
let successfulGenerations = 0;

try {
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900; canvas.height = 600;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e7e5d8'; ctx.fillRect(0, 0, 900, 600);
    ctx.fillStyle = '#d4dbc5'; ctx.fillRect(0, 0, 900, 300);
    ctx.fillStyle = '#f5f2e9'; ctx.fillRect(95, 60, 710, 340);
    ctx.fillStyle = '#40564a'; ctx.fillRect(370, 135, 160, 265);
    ctx.fillStyle = '#c4c4b1'; ctx.beginPath(); ctx.moveTo(370, 400); ctx.lineTo(530, 400); ctx.lineTo(710, 600); ctx.lineTo(190, 600); ctx.fill();
    for (const x of [150, 280, 620, 750]) {
      ctx.fillStyle = '#af7050'; ctx.beginPath(); ctx.moveTo(x - 35, 370); ctx.lineTo(x + 35, 370); ctx.lineTo(x + 24, 440); ctx.lineTo(x - 24, 440); ctx.fill();
      ctx.strokeStyle = '#527653'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x, 380); ctx.lineTo(x, 230); ctx.stroke();
      ctx.fillStyle = '#6f8e57';
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(x + (i % 2 ? -24 : 24), 255 + i * 20, 36, 15, i % 2 ? .65 : -.65, 0, Math.PI * 2); ctx.fill(); }
    }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const photo = {name: 'hotel-entrance.png', mimeType: 'image/png', buffer: Buffer.from(fixture, 'base64')};
  const secondPhoto = {...photo, name: 'hotel-side-view.png'};
  await page.route('**/media/**', route => route.fulfill({status: 200, contentType: 'image/png', body: photo.buffer}));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/state') return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(state)});
    if (path === '/api/designs/generate' && request.method() === 'POST') {
      const body = request.postDataJSON();
      generationRequests.push(body);
      await new Promise(resolve => setTimeout(resolve, 700));
      if (failNextGeneration) {
        failNextGeneration = false;
        return route.fulfill({status: 502, contentType: 'application/json', body: JSON.stringify({error: 'The image service is busy. Please try again.'})});
      }
      const parent = state.designs.find(design => design.id === body.parentDesignId);
      const id = `studio-test-${++successfulGenerations}`;
      const design = {
        id, title: parent?.title || body.prompt.slice(0, 80), prompt: body.prompt,
        image: `/media/designs/${id}.png`, source: 'Design studio', published: false,
        createdAt: new Date(Date.UTC(2026, 9, 23, 10, successfulGenerations)).toISOString(),
        conversationId: parent?.conversationId || id, parentDesignId: parent?.id || '',
        placeId: body.placeId ?? parent?.placeId ?? '',
        referenceImages: (body.referenceImages || []).map((_, index) => `/media/uploads/${id}-${index}.png`),
        instructionHistory: [...(parent?.instructionHistory || []), body.prompt],
      };
      state.designs.push(design);
      return route.fulfill({status: 201, contentType: 'application/json', body: JSON.stringify(design)});
    }
    if (path.startsWith('/api/designs/') && request.method() === 'PATCH') {
      const design = state.designs.find(item => item.id === decodeURIComponent(path.split('/').at(-1)));
      assert.ok(design, 'Only known test designs may be edited.');
      Object.assign(design, request.postDataJSON());
      return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(design)});
    }
    throw new Error(`Unexpected studio API request: ${request.method()} ${path}`);
  });

  await page.goto(`${origin}/#studio`);
  const studio = page.locator('.design-chat');
  const composer = studio.getByRole('textbox', {name: 'Message design studio', exact: true});
  const send = studio.getByRole('button', {name: 'Send message', exact: true});
  const upload = studio.getByLabel('Upload reference photos', {exact: true});
  await expect(composer).toBeVisible();
  await expect(studio.getByRole('heading', {name: 'What shall we create?'})).toBeVisible();
  await expect(studio.getByLabel(/measurements/i)).toHaveCount(0);
  await expect(send).toBeDisabled();
  await page.screenshot({path: join(artifacts, 'studio-chat-empty.png'), fullPage: true});
  console.log('PASS simple chat welcome has no measurements form and requires a message before sending');

  await studio.getByRole('combobox', {name: 'Design place', exact: true}).selectOption('place-hotel');
  await upload.setInputFiles([photo, secondPhoto]);
  await expect(studio.locator('.dc-attachment')).toHaveCount(2);
  const firstPrompt = 'Create a welcoming hotel entrance with tropical plants and warm terracotta pots.';
  await composer.fill(firstPrompt);
  await send.click();
  await expect(send).toBeDisabled();
  await expect(studio.getByText('Creating your design…', {exact: true})).toBeVisible();
  await expect(studio.locator('.dc-turn')).toHaveCount(1);
  await expect(studio.getByAltText('Design version 1', {exact: true})).toBeVisible();
  await expect(studio.locator('.dc-user-message').filter({hasText: firstPrompt})).toBeVisible();
  assert.equal(generationRequests.length, 1);
  assert.equal(generationRequests[0].referenceImages.length, 2);
  assert.ok(generationRequests[0].referenceImages.every(value => /^data:image\/(png|jpeg|webp);base64,/.test(value)));
  assert.equal(generationRequests[0].measurements, undefined);
  assert.equal(generationRequests[0].parentDesignId, undefined);
  assert.equal(generationRequests[0].placeId, 'place-hotel');
  assert.equal(state.designs[0].placeId, 'place-hotel');
  await expect(composer).toHaveValue('');
  await expect(studio.locator('.dc-attachment')).toHaveCount(0);
  console.log('PASS multiple site photos are sent with the message, and a finished design appears in the conversation');

  const openVersionMenu = async index => {
    const menu = studio.locator('.dc-version-menu').nth(index);
    if (!await menu.evaluate(element => element.open)) await menu.locator('summary').click();
    return menu;
  };
  const closeVersionMenu = async index => {
    const menu = studio.locator('.dc-version-menu').nth(index);
    if (await menu.evaluate(element => element.open)) await menu.locator('summary').click();
  };
  const paidRequestsBeforeRefinement = generationRequests.length;
  await studio.getByRole('button', {name: 'Less maintenance', exact: true}).click();
  await expect(composer).toHaveValue(/easier to maintain/);
  await studio.getByRole('button', {name: 'Use our plants', exact: true}).click();
  await expect(composer).toHaveValue(/Bird of paradise: 18 pots/);
  await expect(composer).toHaveValue(/Snake plant: 7 plants/);
  assert.ok(!/Out-of-stock fern|Pruning shears/.test(await composer.inputValue()), 'Stock suggestions must use available plants only.');
  assert.equal(generationRequests.length, paidRequestsBeforeRefinement, 'Refinement ideas must prepare a message without submitting a paid generation.');
  await composer.fill('Please keep the existing entrance clear.');
  await page.reload();
  await expect(composer).toHaveValue('Please keep the existing entrance clear.');
  console.log('PASS quick refinements prepare editable messages using real plant stock, and text drafts survive reload without a generation');

  await studio.getByRole('button', {name: 'Design details', exact: true}).click();
  const details = page.getByRole('dialog', {name: 'Design details', exact: true});
  await details.getByRole('textbox', {name: 'Design name', exact: true}).fill('Palm Court entrance');
  await details.getByRole('combobox', {name: 'Design place', exact: true}).selectOption('place-court');
  await details.getByRole('checkbox', {name: 'Add to favourites', exact: true}).check();
  await details.getByRole('button', {name: 'Save details', exact: true}).click();
  await expect(details).toHaveCount(0);
  assert.equal(state.designs[0].studioTitle, 'Palm Court entrance');
  assert.equal(state.designs[0].placeId, 'place-court');
  assert.equal(state.designs[0].favorite, true);
  await expect(studio.locator('.dc-project-title')).toContainText('Palm Court entrance');
  await expect(studio.locator('.dc-project-title')).toContainText('Palm Court');
  console.log('PASS a design can be renamed, linked to a place, and favourited without changing its saved image');

  await studio.getByRole('button', {name: 'Compare before and after', exact: true}).first().click();
  const preview = page.getByRole('dialog', {name: 'View design version 1', exact: true});
  await expect(preview.getByAltText('Original site photo', {exact: true})).toBeVisible();
  await expect(preview.getByAltText('Enlarged design version 1', {exact: true})).toBeVisible();
  await preview.getByRole('button', {name: 'Original', exact: true}).click();
  await expect(preview.getByAltText('Enlarged design version 1', {exact: true})).toHaveCount(0);
  await preview.getByRole('button', {name: 'Design', exact: true}).click();
  await expect(preview.getByAltText('Original site photo', {exact: true})).toHaveCount(0);
  await expect(preview.getByAltText('Enlarged design version 1', {exact: true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await studio.getByRole('button', {name: 'View design version 1', exact: true}).click();
  await expect(preview).toBeVisible();
  await preview.getByRole('button', {name: 'Close image preview', exact: true}).click();
  console.log('PASS before-and-after comparison and image enlargement open the saved original and correct design');

  await composer.fill('Keep the terracotta pots.');
  await composer.press('Shift+Enter');
  await composer.pressSequentially('Add more flowering plants.');
  assert.equal(generationRequests.length, 1, 'Shift+Enter must not submit the message.');
  await composer.press('Enter');
  await expect(studio.locator('.dc-turn')).toHaveCount(2);
  await expect(studio.getByAltText('Design version 2', {exact: true})).toBeVisible();
  assert.equal(generationRequests[1].parentDesignId, 'studio-test-1');
  assert.equal(generationRequests[1].placeId, 'place-court', 'Edits must retain the conversation’s current linked place.');
  assert.match(generationRequests[1].prompt, /terracotta pots\.\nAdd more flowering/);
  assert.equal(await studio.locator('.dc-design-image').count(), 2);
  console.log('PASS Enter sends a follow-up against the previous design while Shift+Enter adds a line and older versions remain visible');

  await (await openVersionMenu(0)).getByRole('button', {name: 'Edit this version', exact: true}).click();
  await composer.fill('Try white flowers instead.');
  await send.click();
  await expect(studio.locator('.dc-turn')).toHaveCount(3);
  await expect(studio.getByAltText('Design version 3', {exact: true})).toBeVisible();
  assert.equal(generationRequests[2].parentDesignId, 'studio-test-1');
  assert.equal(state.designs[2].conversationId, state.designs[0].conversationId);
  console.log('PASS an earlier design can be edited without replacing later versions');

  failNextGeneration = true;
  const failedPrompt = 'Add soft lighting around the pots.';
  await upload.setInputFiles(photo);
  await expect(studio.locator('.dc-attachment')).toHaveCount(1);
  await composer.fill(failedPrompt);
  await send.click();
  await expect(studio.getByRole('alert')).toContainText('The image service is busy');
  await expect(composer).toHaveValue(failedPrompt);
  await expect(studio.locator('.dc-attachment')).toHaveCount(1);
  await expect(studio.locator('.dc-turn')).toHaveCount(3);
  await page.waitForTimeout(300);
  assert.equal(generationRequests.length, 4, 'An image failure must never trigger an automatic paid retry.');
  await send.click();
  await expect(studio.locator('.dc-turn')).toHaveCount(4);
  await expect(studio.getByAltText('Design version 4', {exact: true})).toBeVisible();
  assert.equal(generationRequests.length, 5);
  assert.equal(generationRequests[4].prompt, failedPrompt);
  assert.equal(generationRequests[4].referenceImages.length, 1);
  console.log('PASS a failed generation preserves the message and attachments and only retries when asked');

  await (await openVersionMenu(3)).getByRole('button', {name: 'Add to portfolio', exact: true}).click();
  await expect(studio.getByRole('button', {name: 'Remove from portfolio', exact: true})).toHaveCount(1);
  assert.equal(state.designs.at(-1).published, true);
  await closeVersionMenu(3);
  const downloaded = page.waitForEvent('download');
  await studio.getByRole('button', {name: 'Download image', exact: true}).last().click();
  assert.match((await downloaded).suggestedFilename(), /\.png$/i);
  console.log('PASS finished designs can be added to the portfolio and downloaded with company branding');

  await (await openVersionMenu(1)).getByRole('button', {name: 'Choose this version', exact: true}).click();
  await expect(studio.locator('.dc-chosen-badge')).toContainText('Version 2 chosen');
  assert.equal(state.designs[0].approvedDesignId, 'studio-test-2');
  await closeVersionMenu(1);
  await page.reload();
  await expect(studio.locator('.dc-turn')).toHaveCount(4);
  await expect(studio.locator('.dc-chosen-badge')).toContainText('Version 2 chosen');
  await expect(studio.locator('.dc-project-title')).toContainText('Palm Court entrance');
  console.log('PASS the chosen version and design details persist across refresh without replacing other versions');
  await expect(studio.getByAltText('Design version 1', {exact: true})).toBeAttached();
  await page.screenshot({path: join(artifacts, 'studio-chat-conversation.png'), fullPage: true});
  await studio.getByRole('button', {name: 'New design', exact: true}).click();
  await expect(studio.getByRole('heading', {name: 'What shall we create?'})).toBeVisible();
  await expect(studio.locator('.dc-turn')).toHaveCount(0);
  assert.equal(state.designs.length, 4, 'New design must keep previous saved versions.');
  await studio.getByRole('button', {name: 'Recent designs', exact: true}).click();
  const library = page.getByRole('dialog', {name: 'Recent designs', exact: true});
  await library.getByRole('searchbox', {name: 'Search designs', exact: true}).fill('unmatched design');
  await expect(library.getByText('No designs found', {exact: true})).toBeVisible();
  await library.getByRole('searchbox', {name: 'Search designs', exact: true}).fill('Palm Court');
  await library.getByRole('button', {name: 'Favourites', exact: true}).click();
  await expect(library.locator('.dl-item')).toHaveCount(1);
  await expect(library.locator('.dl-item')).toContainText('Chosen');
  await library.getByRole('button', {name: /Palm Court entrance/}).click();
  await expect(studio.locator('.dc-turn')).toHaveCount(4);
  console.log('PASS a saved conversation survives reload and can be reopened after starting a new design');

  await page.setViewportSize({width: 390, height: 844});
  const menuButton = page.getByRole('button', {name: 'Open menu', exact: true});
  await menuButton.click();
  const menu = page.getByRole('dialog', {name: 'Workspace menu', exact: true});
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', {name: 'Close workspace menu', exact: true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await menu.evaluate(element => element.contains(document.activeElement)), true, 'Keyboard focus must stay inside the open mobile menu.');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  await composer.fill('Make the entrance feel a little brighter.');
  await send.scrollIntoViewIfNeeded();
  await send.click({trial: true});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The mobile chat must not overflow horizontally.');
  const sendBox = await send.boundingBox();
  assert.ok(sendBox && sendBox.width >= 44 && sendBox.height >= 44, 'The mobile send button must have a 44px touch target.');
  const mobileBox = await composer.boundingBox();
  assert.ok(mobileBox && mobileBox.width > 200 && mobileBox.y >= 0 && mobileBox.y + mobileBox.height <= 844, 'The mobile composer must be visible and usable.');
  await page.screenshot({path: join(artifacts, 'studio-chat-mobile.png'), fullPage: true});
  console.log('PASS mobile chat keeps its composer usable without horizontal scrolling');

  state.imageGenerationConfigured = false;
  await page.reload();
  await expect(studio.getByRole('link', {name: /settings/i})).toBeVisible();
  await composer.fill('Keep this idea for when the studio is connected.');
  await expect(send).toBeDisabled();
  assert.equal(generationRequests.length, 5, 'Disconnected studio must not submit a generation.');
  await page.setViewportSize({width: 360, height: 640});
  await studio.getByRole('button', {name: 'New design', exact: true}).click();
  await expect(studio.getByRole('heading', {name: 'What shall we create?'})).toBeVisible();
  const shortScreen = await studio.evaluate(element => {
    const thread = element.querySelector('.dc-thread');
    const welcome = element.querySelector('.dc-welcome').getBoundingClientRect();
    const composer = element.querySelector('.dc-composer-area').getBoundingClientRect();
    const bounds = thread.getBoundingClientRect();
    return {welcomeTop: welcome.top, welcomeBottom: welcome.bottom, threadTop: bounds.top, threadBottom: bounds.bottom, composerTop: composer.top, overflow: getComputedStyle(thread).overflowY};
  });
  assert.ok(shortScreen.threadBottom <= shortScreen.composerTop + 1, 'The welcome thread and composer must have separate space.');
  assert.ok(shortScreen.welcomeTop >= shortScreen.threadTop - 1, 'The welcome must not grow upward over the studio heading.');
  assert.ok(shortScreen.welcomeBottom <= shortScreen.composerTop + 1 || ['auto', 'scroll', 'hidden', 'clip'].includes(shortScreen.overflow), 'A short-screen welcome must fit or scroll inside its thread, never paint over connection guidance and the composer.');
  await studio.getByRole('button', {name: 'Add photos', exact: true}).click({trial: true});
  await studio.getByRole('link', {name: /settings/i}).click({trial: true});
  await page.screenshot({path: join(artifacts, 'studio-chat-short-disconnected.png'), fullPage: true});
  assert.deepEqual(runtimeErrors, [], 'The studio must not raise browser runtime errors.');
  console.log('PASS disconnected image generation gives a Settings link and cannot silently submit a paid request');
  console.log('PASS a short mobile screen keeps the welcome separate from connection guidance and the composer');
  console.log(`Studio screenshots: ${artifacts}`);
} catch (error) {
  await page.screenshot({path: join(artifacts, 'studio-chat-failure.png'), fullPage: true}).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await vite.close();
}
