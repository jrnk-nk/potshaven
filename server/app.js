import express from 'express';
import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { fetch, EnvHttpProxyAgent } from 'undici';
import { createStore, collections, AppError } from './store.js';
import {decodeDesignReference, referenceUploads, instructionHistory, conversationPrompt} from './design-conversation.js';
import {databaseFailure} from './database-diagnostics.js';
import {installAssistant} from './assistant.js';
import {workspaceForRole, recordForRole, collectionForRole, canReadCollection, authorizeMutation, referencedMedia, assertMediaReferences, preserveOperationalMetadata} from './access.js';
import {assertNoFinancialFields, withoutFinancialFields, preserveFinancialMetadata} from './financial-access.js';
import {installActivity, managerActivity} from './activity.js';
import {applySecurityHeaders} from './security-headers.js';
import {installDataProtection} from './data-protection.js';
import {installProviderReadiness} from './provider-readiness.js';
import {installAssistantHistory} from './assistant-history.js';
import {installAccountSecurity} from './account-security.js';
import {providerFingerprint} from './provider-operations.js';

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || '')), b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
};
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function createApp({
  store, dataDir = join(projectRoot, '.data'), serveClient = true,
  ownerPassword = process.env.APP_OWNER_PASSWORD, managerPassword = process.env.APP_MANAGER_PASSWORD,
  imageKey = process.env.POTSHAVEN_OPENAI_KEY || process.env.OPENAI_API_KEY,
  imageModel = process.env.POTSHAVEN_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst',
  imageQuality = process.env.POTSHAVEN_IMAGE_QUALITY || process.env.OPENAI_IMAGE_QUALITY || (/sunburst|flare/i.test(imageModel) ? 'max' : 'high'),
  imageSize = process.env.POTSHAVEN_IMAGE_SIZE || process.env.OPENAI_IMAGE_SIZE || (/sunburst|flare/i.test(imageModel) ? '2560x1440' : '1536x1024'),
  fetchImage = fetch, fetchAssistant = fetch, assistantModel = process.env.POTSHAVEN_ASSISTANT_MODEL || 'gpt-5.4', sessionSecret = process.env.APP_SESSION_SECRET, mediaStorage,
} = {}) {
  store ||= createStore(join(dataDir, 'potshaven.db'));
  const app = express();
  app.disable('x-powered-by');
  const demoMode = !ownerPassword && !managerPassword;
  const uploadsDir = join(dataDir, 'uploads');
  if (!mediaStorage) {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(dataDir, 'designs'), { recursive: true });
    mkdirSync(uploadsDir, { recursive: true });
  }
  // Keep binary pictures out of the workspace JSON. Legacy inline pictures are
  // materialised for the response without changing their original database rows.
  // Identical uploads reuse the same immutable, authenticated URL.
  async function uploadPicture(value, key) {
    if (typeof value !== 'string' || !value.startsWith('data:image/')) return value;
    const limit = key === 'logo' ? 3000000 : 11000000;
    if (value.length > limit) throw new AppError(key === 'logo' ? 'Logo must be smaller than 2 MB.' : 'Picture must be smaller than 8 MB.', 413);
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) throw new AppError('Upload a PNG, JPG, or WebP picture.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 8 * 1024 * 1024 || bytes.toString('base64') !== match[2]) throw new AppError('The picture could not be read. Upload a PNG, JPG, or WebP file.');
    const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
    const filename = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
    if (mediaStorage) return mediaStorage.put(`uploads/${filename}`, bytes, `image/${match[1]}`);
    const destination = join(uploadsDir, filename);
    if (!existsSync(destination)) {
      const temporary = join(uploadsDir, `.${randomUUID()}.tmp`);
      try { writeFileSync(temporary, bytes, { mode: 0o600 }); renameSync(temporary, destination); }
      finally { rmSync(temporary, { force: true }); }
    }
    return `/media/uploads/${filename}`;
  }
  async function pictures(value, key = '', inPhotos = false) {
    if (typeof value === 'string') return ['image', 'logo'].includes(key) || inPhotos ? uploadPicture(value, key) : value;
    if (Array.isArray(value)) return Promise.all(value.map(item => pictures(item, key, inPhotos || ['photos', 'completionPhotos'].includes(key))));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([name, item]) => [name, await pictures(item, name, inPhotos && ['image', 'url'].includes(name))])));
  }
  const secretPath = join(dataDir, 'session-secret');
  if (!sessionSecret && mediaStorage) throw new Error('APP_SESSION_SECRET is required for hosted authentication.');
  if (!sessionSecret) {
    if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(48).toString('hex'), { mode: 0o600 });
    sessionSecret = readFileSync(secretPath, 'utf8');
  }
  // Bind every session to the current authentication settings. Keeping the
  // random server secret stable must not preserve demo access or old-password
  // sessions after the owner enables or rotates passwords.
  const sessionSigningKey = createHmac('sha256', sessionSecret)
    .update(JSON.stringify({ owner: ownerPassword || null, manager: managerPassword || null }))
    .digest();
  const sign = payload => createHmac('sha256', sessionSigningKey).update(payload).digest('hex');
  function session(req) {
    const cookie = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('potshaven_session='))?.split('=')[1];
    if (cookie) {
      const parts = cookie.split('.');
      const [payload, signature] = parts;
      if (parts.length === 2 && payload && safeEqual(sign(payload), signature)) {
        try {
          const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
          if (['owner', 'manager'].includes(parsed.role) && Number.isSafeInteger(parsed.expires) && parsed.expires > Date.now() && (parsed.generation === undefined || Number.isSafeInteger(parsed.generation) && parsed.generation >= 0)) {
            // The digest supports revoking cookies issued before nonce fields
            // were added. No raw token is written to the database.
            return {role: parsed.role, generation: parsed.generation ?? 0, expiresAt: parsed.expires, key: createHmac('sha256', sessionSigningKey).update(`session-revocation:${cookie}`).digest('hex')};
          }
        } catch { /* malformed session is unauthenticated */ }
      }
    }
    return null;
  }
  app.use((req, res, next) => {
    applySecurityHeaders(req, res);
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    // Cookies are SameSite=Strict. Also reject cross-site writes from browsers.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { return next(new AppError('Invalid request origin.', 403)); }
      const allowedHosts = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
      if (!allowedHosts.includes(origin.host)) return next(new AppError('Cross-site writes are not allowed.', 403));
    }
    next();
  });
  app.use(express.json({ limit: '12mb' }));
  app.use(async (req, res, next) => {
    req.authSession = session(req);
    req.role = demoMode ? 'owner' : null;
    if (req.authSession) {
      try {
        if (typeof store.isSessionRevoked !== 'function' || typeof store.getSessionGeneration !== 'function') throw new Error('Session verification unavailable.');
        const generation = await store.getSessionGeneration(req.authSession.role);
        if (generation === req.authSession.generation && !await store.isSessionRevoked(req.authSession.key)) req.role = req.authSession.role;
      } catch (error) {
        // A revoked session must not become usable during a database outage.
        return res.status(503).json(databaseFailure(error));
      }
    }
    next();
  });
  app.get('/api/health', async (req, res) => {
    try {
      // A cached serverless app can outlive a database connection. Probe a
      // real read on every request; never return company data from this route.
      if (typeof store.health === 'function') await store.health();
      else await store.settings();
      res.json({ ok: true, database: 'connected', demoMode, authenticated: Boolean(req.role), role: req.role, imageGenerationConfigured: req.role !== 'manager' && Boolean(imageKey), assistantConfigured: Boolean(imageKey), ...(req.role !== 'manager' ? {imageModel, imageQuality, imageSize} : {}) });
    } catch (error) {
      res.status(503).json(databaseFailure(error));
    }
  });
  const failedLogins = new Map();
  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const { role } = req.body || {};
      const password = req.body?.password ?? (demoMode ? '' : undefined);
      if (!['owner', 'manager'].includes(role)) throw new AppError('Choose owner or manager.');
      if (typeof password !== 'string' || password.length > 1024) throw new AppError('Enter your password using at most 1,024 characters.');
      // A manager sign-in must not reset failed owner guesses, and mistakes
      // signing in to one role must not lock the other role out.
      const source = createHmac('sha256', sessionSigningKey).update(`login-attempt:${JSON.stringify([req.ip, role])}`).digest('hex');
      const expected = role === 'owner' ? ownerPassword : managerPassword;
      const accepted = demoMode || Boolean(expected && safeEqual(password, expected));
      let allowed;
      if (typeof store.recordLoginAttempt === 'function') allowed = await store.recordLoginAttempt(source, accepted);
      else {
        // Compatibility for injected adapters; the SQLite and hosted stores
        // persist counters so a cold server instance cannot reset the limit.
        const now = Date.now(), record = failedLogins.get(source);
        for (const [key, value] of failedLogins) if (value.until <= now) failedLogins.delete(key);
        const active = record && record.until > now;
        allowed = !(active && record.count >= 10);
        if (allowed && !accepted && !active && failedLogins.size >= 10000) allowed = false;
        if (allowed && accepted) failedLogins.delete(source);
        else if (allowed) failedLogins.set(source, {count: (active ? record.count : 0) + 1, until: active ? record.until : now + 15 * 60 * 1000});
      }
      if (!allowed) throw new AppError('Too many sign-in attempts. Please try again in 15 minutes.', 429);
      if (!accepted) throw new AppError('Incorrect password or role is not configured.', 401);
      const generation = await store.getSessionGeneration(role);
      const payload = Buffer.from(JSON.stringify({ role, generation, expires: Date.now() + 12 * 60 * 60 * 1000, nonce: randomUUID() })).toString('base64url');
      res.cookie('potshaven_session', `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: 'strict', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: 12 * 60 * 60 * 1000 });
      res.json({ role, demoMode });
    } catch (error) { next(error); }
  });
  app.post('/api/auth/logout', async (req, res) => {
    if (req.authSession) {
      try {
        if (typeof store.revokeSession !== 'function') throw new Error('Session verification unavailable.');
        await store.revokeSession(req.authSession.key, req.authSession.expiresAt);
      } catch (error) {
        // Do not confirm or clear the cookie before durable revocation succeeds.
        return res.status(503).json(databaseFailure(error));
      }
    }
    res.clearCookie('potshaven_session'); res.json({ ok: true });
  });
  app.use('/api', (req, res, next) => req.role ? next() : next(new AppError('Please sign in to continue.', 401)));
  installAccountSecurity(app, {store, ownerPassword, managerPassword, sessionSigningKey, demoMode});
  installDataProtection(app, {store, mediaStorage});
  installActivity(app, {store});
  installAssistantHistory(app, {store});
  installProviderReadiness(app, {store, key: imageKey, model: assistantModel, fetchAssistant});
  installAssistant(app, {store, key: imageKey, model: assistantModel, fetchAssistant});
  app.get('/api/state', async (req, res, next) => {
    try { res.json(await pictures({ ...workspaceForRole(await store.state(), req.role), role: req.role, demoMode, imageGenerationConfigured: req.role === 'owner' && Boolean(imageKey), assistantConfigured: Boolean(imageKey), ...(req.role === 'owner' ? {imageModel, imageQuality, imageSize} : {}) })); }
    catch (error) { next(error); }
  });
  async function managerMedia() {return referencedMedia(await pictures(workspaceForRole(await store.state(), 'manager')));}
  async function checkedPayload(req, collection, operation, existing) {
    const payload = authorizeMutation(req.role, collection, operation, req.body, existing);
    if (req.role === 'manager') {
      if (referencedMedia(payload).size) assertMediaReferences(payload, await managerMedia());
      if (collection === 'jobs') {
        if (Array.isArray(payload.crewIds)) for (const id of payload.crewIds) if (!id || !await store.get('workers', id)) throw new AppError('Choose people already approved in the team list.', 409);
        if (payload.vehicleId && !await store.get('vehicles', payload.vehicleId)) throw new AppError('Choose a vehicle already approved in the fleet.', 409);
        if (payload.placeId && !await store.get('places', payload.placeId)) throw new AppError('Choose an existing place.', 409);
      }
      return preserveFinancialMetadata(preserveOperationalMetadata(payload, existing), existing);
    }
    return preserveFinancialMetadata(payload, existing);
  }
  app.patch('/api/places/:id', async (req, res, next) => {
    if (!req.body || !Object.hasOwn(req.body, 'inspection')) return next();
    try {
      if (Object.keys(req.body).length !== 1) throw new AppError('Save the site visit separately from other site changes.');
      const entry = req.body.inspection;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(entry.id)) throw new AppError('A unique site visit reference is required.');
      if (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(Date.parse(entry.date)) || new Date(entry.date).toISOString().slice(0, 10) !== entry.date) throw new AppError('Choose a valid site visit date.');
      if (Array.isArray(entry.photos) && entry.photos.length > 4) throw new AppError('Add up to four photos to a site visit.');
      // New visits use the same operational fields for both roles. Existing
      // private metadata is read inside the transaction loop and never echoed.
      const payload = authorizeMutation('manager', 'places', 'update', {inspections: [entry]});
      if (req.role === 'manager' && referencedMedia(payload).size) assertMediaReferences(payload, await managerMedia());
      const prepared = (await pictures(payload)).inspections[0];
      for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await store.get('places', req.params.id);
        if (!previous) throw new AppError('Site not found.', 404);
        const visits = Array.isArray(previous.inspections) ? previous.inspections : [];
        const duplicate = visits.find(visit => visit?.id === prepared.id);
        if (duplicate) {
          if (!isDeepStrictEqual(duplicate, prepared)) throw new AppError('This visit reference already belongs to a saved visit. Refresh before recording another visit.', 409);
          return res.json(await pictures(recordForRole('places', previous, req.role)));
        }
        const patch = {inspections: [prepared, ...visits]};
        const activity = await managerActivity(store, {role: req.role, collection: 'places', operation: 'update', record: {...previous, ...patch}, previous});
        try {
          const record = await store.update('places', req.params.id, patch, req.role === 'owner' ? 'Owner' : 'Manager', {expected: previous, activity});
          return res.json(await pictures(recordForRole('places', record, req.role)));
        } catch (error) {
          // Retry only a confirmed, uncommitted compare-and-swap conflict.
          // Connection failures may have committed and must never be replayed.
          if (attempt === 2 || error.status !== 409 || error.message !== 'This record changed while you were editing. Refresh and try again.') throw error;
        }
      }
    } catch (error) {next(error);}
  });
  app.patch('/api/settings', async (req, res, next) => {
    try { if (req.role !== 'owner') throw new AppError('Only the owner can update company settings.', 403); assertNoFinancialFields(req.body); res.json(await pictures(withoutFinancialFields(await store.updateSettings(await pictures(req.body))))); } catch (error) { next(error); }
  });
  app.post('/api/inventory/:id/:operation', async (req, res, next) => {
    if (!['use', 'restock'].includes(req.params.operation)) return next();
    try {
      if (req.role !== 'owner' && req.params.operation !== 'use') throw new AppError('Only the owner can receive or adjust stock.', 403);
      assertNoFinancialFields(req.body);
      const { quantity, jobId, note } = req.body;
      if (req.role === 'manager' && (typeof jobId !== 'string' || !jobId.trim())) throw new AppError('Choose the job this stock was used on.');
      const activity = await managerActivity(store, {role: req.role, collection: 'inventory', operation: req.params.operation, record: await store.get('inventory', req.params.id), quantity, jobId});
      const result = await store.stock(req.params.id, quantity, { type: req.params.operation, jobId, note, actor: req.role === 'owner' ? 'Owner' : 'Manager', activity });
      res.json(await pictures({item: recordForRole('inventory', result.item, req.role), movement: recordForRole('stockMovements', result.movement, req.role)}));
    } catch (error) { next(error); }
  });
  async function savedDesignImage(url) {
    if (typeof url === 'string' && url.startsWith('data:image/')) return decodeDesignReference(url);
    const match = typeof url === 'string' && /^\/media\/((?:uploads\/[a-f0-9]{64}|(?:designs\/)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(png|jpg|webp))$/.exec(url);
    if (!match) throw new AppError('This design cannot be used as a reference. Upload its original photo in a new chat.');
    const key = /^(uploads|designs)\//.test(match[1]) ? match[1] : `designs/${match[1]}`;
    const contentType = {png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp'}[match[2]];
    let image;
    if (mediaStorage) {
      if (typeof mediaStorage.get === 'function') image = await mediaStorage.get(key);
      else if (typeof store.getMedia === 'function') image = await store.getMedia(key);
      else throw new AppError('Saved design photos are temporarily unavailable. Try again later.', 503);
    } else {
      try { image = {bytes: readFileSync(join(dataDir, key)), contentType}; }
      catch { throw new AppError('This saved photo could not be opened. Upload the original photo in a new chat.'); }
    }
    if (!image || !Buffer.isBuffer(image.bytes) || !image.bytes.length || image.bytes.length > 8 * 1024 * 1024 || image.contentType !== contentType) {
      throw new AppError('This saved photo could not be opened. Upload the original photo in a new chat.');
    }
    return {...image, extension: match[2]};
  }
  app.get('/api/designs/requests/:requestId', async (req, res, next) => {
    try {
      if (req.role !== 'owner') throw new AppError('The design studio is available to the business owner only.', 403);
      const operation = await store.getProviderOperation('owner', 'studio', req.params.requestId);
      if (!operation) throw new AppError('This request has not been recorded yet. Keep its reference and check again before starting another design.', 404);
      // A design write may have committed even if its response or the final
      // receipt update was interrupted. The immutable allocated ID finds it.
      const design = await store.get('designs', operation.resultId);
      res.set('Cache-Control', 'private, no-store').vary('Cookie').json({
        status: design ? 'completed' : operation.status === 'completed' ? 'uncertain' : operation.status,
        createdAt: operation.createdAt, ...(design ? {design: await pictures(design)} : {}),
      });
    } catch (error) {next(error);}
  });
  app.post('/api/designs/generate', async (req, res, next) => {
    let operation, claimed = false, providerStarted = false, definitelyRejected = false, savedDesign;
    try {
      if (req.role !== 'owner') throw new AppError('The design studio is available to the business owner only.', 403);
      const body = req.body || {};
      const requestId = body.requestId === undefined ? randomUUID() : body.requestId;
      if (typeof requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) throw new AppError('Use a valid design request reference.');
      if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 6000) throw new AppError('Describe your design or edit in 1–6,000 characters.');
      const prompt = body.prompt.trim();
      if (body.measurements !== undefined && (typeof body.measurements !== 'string' || body.measurements.length > 2000)) throw new AppError('Measurements are too long.');
      if (body.placeId !== undefined && (typeof body.placeId !== 'string' || body.placeId.length > 200)) throw new AppError('Choose an existing place.');
      if (body.parentDesignId !== undefined && (typeof body.parentDesignId !== 'string' || !body.parentDesignId.trim() || body.parentDesignId.length > 200)) throw new AppError('Choose a saved design version to edit.');
      const uploads = referenceUploads(body);
      const parent = body.parentDesignId ? await store.get('designs', body.parentDesignId) : null;
      if (body.parentDesignId && !parent) throw new AppError('The design version you want to edit was not found.', 404);
      if (parent?.source === 'Portfolio upload') throw new AppError('Start a new design chat and upload the project photo as a reference.');
      const placeId = body.placeId !== undefined ? body.placeId : parent?.placeId || '';
      if (placeId && !await store.get('places', placeId)) throw new AppError('Choose an existing place.');
      const measurements = body.measurements ?? parent?.measurements ?? '';
      const history = instructionHistory(parent, prompt);
      const fullPrompt = conversationPrompt(history, measurements, Boolean(parent));
      const inherited = parent && (Array.isArray(parent.contextImages) ? parent.contextImages : Array.isArray(parent.referenceImages) ? parent.referenceImages : []);
      const inheritedUrls = [...new Set(inherited || [])].slice(0, Math.max(0, 4 - uploads.length));
      // The selected generated version must be first. The model receives the
      // original brief and earlier edits along with the actual saved image.
      const references = [
        ...(parent ? [await savedDesignImage(parent.image)] : []),
        ...uploads,
        ...await Promise.all(inheritedUrls.map(url => savedDesignImage(url))),
      ];
      if (!imageKey) throw new AppError('Image generation is not connected yet. Add POTSHAVEN_OPENAI_KEY (or OPENAI_API_KEY) to the server environment to enable the design studio.', 503);
      const {requestId: ignoredRequestId, ...fingerprintBody} = body;
      const admission = await store.claimProviderOperation({role: 'owner', kind: 'studio', requestId, fingerprint: providerFingerprint({body: fingerprintBody, imageModel, imageQuality, imageSize})});
      operation = admission.operation; claimed = admission.claimed;
      if (!claimed) {
        const existing = await store.get('designs', operation.resultId);
        if (existing) return res.status(200).json(await pictures(existing));
        throw new AppError(operation.status === 'failed' ? 'This request was not completed. Check its status before preparing a separate request.' : 'This design request is already recorded. Check request status or your gallery; it will not be generated again automatically.', 409);
      }
      const dispatcher = new EnvHttpProxyAgent({headersTimeout: 270000, bodyTimeout: 270000});
      let response;
      try {
        if (references.length) {
          const form = new FormData();
          form.set('model', imageModel); form.set('prompt', fullPrompt); form.set('quality', imageQuality); form.set('size', imageSize); form.set('output_format', 'jpeg'); form.set('output_compression', '95');
          for (const [index, reference] of references.entries()) {
            form.append(references.length === 1 ? 'image' : 'image[]', new Blob([reference.bytes], {type: reference.contentType}), `${index === 0 && parent ? 'selected-design' : 'reference'}-${index + 1}.${reference.extension}`);
          }
          providerStarted = true;
          response = await fetchImage('https://api.openai.com/v1/images/edits', {method: 'POST', headers: {Authorization: `Bearer ${imageKey}`}, body: form, dispatcher, signal: AbortSignal.timeout(240000)});
        } else {
          providerStarted = true;
          response = await fetchImage('https://api.openai.com/v1/images/generations', {method: 'POST', headers: {Authorization: `Bearer ${imageKey}`, 'Content-Type': 'application/json'}, body: JSON.stringify({model: imageModel, prompt: fullPrompt, quality: imageQuality, size: imageSize, n: 1, output_format: 'jpeg', output_compression: 95}), dispatcher, signal: AbortSignal.timeout(240000)});
        }
        if (!response.ok) {
          definitelyRejected = [400, 401, 403, 404, 422, 429].includes(response.status);
          const reason = response.status === 401 ? 'The configured OpenAI key was not accepted.' : response.status === 403 ? 'The configured OpenAI account or network policy does not permit this image request.' : response.status === 429 ? 'OpenAI usage limit reached. Check the account balance and try again later.' : 'OpenAI could not generate this image. Try a different brief or check the configured image model.';
          throw new AppError(reason, 502);
        }
        const result = await response.json();
        const image = result.data?.[0]?.b64_json;
        if (typeof image !== 'string' || !image) throw new AppError('The image service returned no image. Try again later.', 502);
        const bytes = Buffer.from(image, 'base64');
        if (!bytes.length || bytes.length > 8 * 1024 * 1024 || bytes.toString('base64') !== image) throw new AppError('The image service returned an unreadable image. Try again later.', 502);
        const id = operation.resultId;
        const referenceImages = await Promise.all(uploads.map(upload => uploadPicture(upload.value, 'image')));
        const contextImages = [...new Set([...referenceImages, ...await Promise.all(inheritedUrls.map(url => uploadPicture(url, 'image')))])].slice(0, 4);
        let imageUrl;
        if (mediaStorage) imageUrl = await mediaStorage.put(`designs/${id}.jpg`, bytes, 'image/jpeg');
        else { writeFileSync(join(dataDir, 'designs', `${id}.jpg`), bytes); imageUrl = `/media/${id}.jpg`; }
        const design = await store.put('designs', {
          id, title: prompt.slice(0, 80), prompt, measurements, placeId, image: imageUrl,
          conversationId: parent ? parent.conversationId || parent.id : id,
          parentDesignId: parent?.id || '', referenceImages, contextImages,
          instructionHistory: history, source: 'Design studio', published: false,
          createdAt: new Date().toISOString(), model: imageModel, quality: imageQuality, size: imageSize, portfolio: false,
        });
        savedDesign = design;
        try {await store.finishProviderOperation('owner', 'studio', operation.id, {status: 'completed', result: {designId: design.id}});} catch { /* The committed design remains recoverable by its allocated ID. */ }
        res.status(201).json(design);
      } finally { await dispatcher.close(); }
    } catch (error) {
      if (res.headersSent || savedDesign) return;
      if (claimed) {
        try {await store.finishProviderOperation('owner', 'studio', operation.id, {status: !providerStarted || definitelyRejected ? 'failed' : 'uncertain'});} catch { /* An uncertain write is never replayed automatically. */ }
      }
      if (claimed && providerStarted && !definitelyRejected) next(new AppError('The design result could not be confirmed. Check this request or your gallery before starting another generation.', error.name === 'TimeoutError' ? 504 : 503));
      else if (error instanceof AppError) next(error);
      else next(new AppError('The studio request could not be confirmed. Check its status before sending again.', 503));
    }
  });
  const requireMediaAccess = async (req, res, next) => {
    try {
      if (!req.role) throw new AppError('Please sign in to continue.', 401);
      if (req.role === 'manager' && !(await managerMedia()).has(req.workspaceMediaPath)) throw new AppError('This image is available to the business owner only.', 403);
      res.set('Cache-Control', 'private, no-store').vary('Cookie');
      next();
    } catch (error) {next(error);}
  };
  app.use('/media', (req, res, next) => {
    // Keep the original complete path while Express mounts individual media handlers.
    req.workspaceMediaPath = '/media' + req.path; res.set('Cache-Control', 'private, no-store').vary('Cookie'); next();
  });
  if (mediaStorage) app.use('/media', requireMediaAccess, mediaStorage.serve);
  else {
    app.use('/media/uploads', requireMediaAccess, express.static(uploadsDir, {
      dotfiles: 'deny', index: false,
      setHeaders: res => {res.setHeader('Cache-Control', 'private, no-store'); res.vary('Cookie');},
    }));
    app.use('/media', requireMediaAccess, express.static(join(dataDir, 'designs'), { dotfiles: 'deny', index: false, setHeaders: res => {res.setHeader('Cache-Control', 'private, no-store'); res.vary('Cookie');} }));
  }
  app.use('/media', (req, res, next) => next(new AppError('Image not found.', 404)));
  app.use('/api/:collection', (req, res, next) => {
    if (!collections.includes(req.params.collection)) return next(new AppError('Unknown record type.', 404));
    if (req.params.collection === 'stockMovements' && req.method !== 'GET') return next(new AppError('Stock history is managed automatically and cannot be edited.', 403));
    next();
  });
  app.get('/api/:collection', async (req, res, next) => {
    try {
      if (!canReadCollection(req.role, req.params.collection)) throw new AppError('This information is available to the business owner only.', 403);
      res.json(await pictures(collectionForRole(req.params.collection, await store.list(req.params.collection), req.role)));
    } catch (error) { next(error); }
  });
  function authorizePurchase(req, existing) {
    if (req.params.collection === 'purchaseRequests' && req.role !== 'owner') {
      if (existing && existing.status !== 'Pending') throw new AppError('Only the owner can change a reviewed purchase request.', 403);
      if (req.body.status && req.body.status !== 'Pending') throw new AppError('Only the owner can approve or reject purchases.', 403);
    }
  }
  app.post('/api/:collection', async (req, res, next) => {
    try {
      const payload = await checkedPayload(req, req.params.collection, 'create');
      authorizePurchase(req);
      const id = randomUUID();
      const defaults = req.params.collection === 'jobs' ? { status: 'Scheduled', type: 'Maintenance', crewIds: [], tasks: [] } : req.params.collection === 'inventory' ? { quantity: 0, minStock: 0, cost: 0, category: 'Plants', unit: 'plants' } : req.params.collection === 'purchaseRequests' ? { status: 'Pending', requestedBy: req.role } : {};
      const prepared = await pictures({ ...defaults, ...payload, id });
      const activity = await managerActivity(store, {role: req.role, collection: req.params.collection, operation: 'create', record: prepared});
      const record = await store.put(req.params.collection, prepared, {activity});
      res.status(201).json(await pictures(recordForRole(req.params.collection, record, req.role)));
    } catch (error) { next(error); }
  });
  app.patch('/api/:collection/:id', async (req, res, next) => {
    try {
      if (!canReadCollection(req.role, req.params.collection)) throw new AppError('This information is available to the business owner only.', 403);
      const existing = await store.get(req.params.collection, req.params.id);
      if (req.body && Object.hasOwn(req.body, '_expected')) {
        const {_expected: expected, ...changes} = req.body;
        if (!expected || typeof expected !== 'object' || Array.isArray(expected) || expected.id !== req.params.id) throw new AppError('Refresh this record before saving your changes.');
        if (!existing) throw new AppError('Record not found.', 404);
        const visible = await pictures(recordForRole(req.params.collection, existing, req.role));
        if (!isDeepStrictEqual(expected, visible)) throw new AppError('This record changed while you were editing. Refresh and try again.', 409);
        req.body = changes;
      }
      const payload = await checkedPayload(req, req.params.collection, 'update', existing);
      authorizePurchase(req, existing);
      const prepared = await pictures(payload);
      const activity = await managerActivity(store, {role: req.role, collection: req.params.collection, operation: 'update', record: {...existing, ...prepared}, previous: existing});
      const record = await store.update(req.params.collection, req.params.id, prepared, req.role === 'owner' ? 'Owner' : 'Manager', {expected: existing, activity});
      res.json(await pictures(recordForRole(req.params.collection, record, req.role)));
    } catch (error) { next(error); }
  });
  app.delete('/api/:collection/:id', async (req, res, next) => {
    try { const existing = await store.get(req.params.collection, req.params.id); authorizeMutation(req.role, req.params.collection, 'delete', {}, existing); authorizePurchase(req, existing); await store.remove(req.params.collection, req.params.id); res.status(204).end(); } catch (error) { next(error); }
  });
  app.use('/api', (req, res, next) => next(new AppError('API endpoint not found.', 404)));
  const dist = join(projectRoot, 'dist');
  if (serveClient && existsSync(join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (req, res) => res.sendFile(join(dist, 'index.html')));
  }
  app.use((error, req, res, next) => {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    const failure = databaseFailure(error);
    if (!(error instanceof AppError) && failure.diagnostic !== 'UNKNOWN') {
      return res.status(503).json(failure);
    }
    // Driver errors may contain passwords or connection strings, even when
    // their code is unknown. Keep unexpected-failure logs free of raw errors.
    if (status >= 500 && !(error instanceof AppError)) console.error('Unexpected request failure.');
    res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : error.message });
  });
  app.locals.store = store;
  return app;
}
