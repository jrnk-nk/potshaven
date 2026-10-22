import express from 'express';
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fetch, EnvHttpProxyAgent } from 'undici';
import { createStore, collections, AppError } from './store.js';

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || '')), b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
};

export function createApp({
  store = createStore(), dataDir = resolve('.data'),
  ownerPassword = process.env.APP_OWNER_PASSWORD, managerPassword = process.env.APP_MANAGER_PASSWORD,
  imageKey = process.env.POTSHAVEN_OPENAI_KEY || process.env.OPENAI_API_KEY,
  imageModel = process.env.POTSHAVEN_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst',
  imageQuality = process.env.POTSHAVEN_IMAGE_QUALITY || process.env.OPENAI_IMAGE_QUALITY || (/sunburst|flare/i.test(imageModel) ? 'max' : 'high'),
  imageSize = process.env.POTSHAVEN_IMAGE_SIZE || process.env.OPENAI_IMAGE_SIZE || (/sunburst|flare/i.test(imageModel) ? '2560x1440' : '1536x1024'),
  fetchImage = fetch, sessionSecret,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  const demoMode = !ownerPassword && !managerPassword;
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, 'designs'), { recursive: true });
  const secretPath = join(dataDir, 'session-secret');
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
      const [payload, signature] = cookie.split('.');
      if (payload && safeEqual(sign(payload), signature)) {
        try {
          const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
          if (['owner', 'manager'].includes(parsed.role) && parsed.expires > Date.now()) return parsed.role;
        } catch { /* malformed session is unauthenticated */ }
      }
    }
    return demoMode ? 'owner' : null;
  }
  app.use(express.json({ limit: '12mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    req.role = session(req);
    // Cookies are SameSite=Strict. Also reject cross-site writes from browsers.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { return next(new AppError('Invalid request origin.', 403)); }
      const allowedHosts = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
      if (!allowedHosts.includes(origin.host)) return next(new AppError('Cross-site writes are not allowed.', 403));
    }
    next();
  });
  app.get('/api/health', (req, res) => res.json({ ok: true, demoMode, authenticated: Boolean(req.role), role: req.role, imageGenerationConfigured: Boolean(imageKey), imageModel, imageQuality, imageSize }));
  const failedLogins = new Map();
  app.post('/api/auth/login', (req, res, next) => {
    try {
      const source = req.ip;
      const record = failedLogins.get(source);
      if (record && record.until > Date.now() && record.count >= 10) throw new AppError('Too many sign-in attempts. Please try again in 15 minutes.', 429);
      const { role, password } = req.body || {};
      if (!['owner', 'manager'].includes(role)) throw new AppError('Choose owner or manager.');
      const expected = role === 'owner' ? ownerPassword : managerPassword;
      if (!demoMode && (!expected || !safeEqual(password, expected))) {
        const previous = record && record.until > Date.now() ? record.count : 0;
        failedLogins.set(source, { count: previous + 1, until: Date.now() + 15 * 60 * 1000 });
        throw new AppError('Incorrect password or role is not configured.', 401);
      }
      failedLogins.delete(source);
      const payload = Buffer.from(JSON.stringify({ role, expires: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
      res.cookie('potshaven_session', `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: 'strict', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: 12 * 60 * 60 * 1000 });
      res.json({ role, demoMode });
    } catch (error) { next(error); }
  });
  app.post('/api/auth/logout', (req, res) => { res.clearCookie('potshaven_session'); res.json({ ok: true }); });
  app.use('/api', (req, res, next) => req.role ? next() : next(new AppError('Please sign in to continue.', 401)));
  app.get('/api/state', (req, res) => res.json({ ...store.state(), role: req.role, demoMode, imageGenerationConfigured: Boolean(imageKey), imageModel, imageQuality, imageSize }));
  app.patch('/api/settings', (req, res, next) => {
    try { if (req.role !== 'owner') throw new AppError('Only the owner can update company settings.', 403); res.json(store.updateSettings(req.body)); } catch (error) { next(error); }
  });
  app.post('/api/inventory/:id/:operation', (req, res, next) => {
    if (!['use', 'restock'].includes(req.params.operation)) return next();
    try {
      const { quantity, jobId, note } = req.body;
      res.json(store.stock(req.params.id, quantity, { type: req.params.operation, jobId, note, actor: req.role === 'owner' ? 'Owner' : 'Manager' }));
    } catch (error) { next(error); }
  });
  app.post('/api/designs/generate', async (req, res, next) => {
    try {
      if (!imageKey) throw new AppError('Image generation is not connected yet. Add POTSHAVEN_OPENAI_KEY (or OPENAI_API_KEY) to the server environment to enable the design studio.', 503);
      const { prompt, originalImage, measurements = '', placeId = '' } = req.body || {};
      if (typeof prompt !== 'string' || prompt.trim().length < 8 || prompt.length > 6000) throw new AppError('Describe your design in 8–6,000 characters.');
      if (typeof measurements !== 'string' || measurements.length > 2000) throw new AppError('Measurements are too long.');
      if (placeId && !store.get('places', placeId)) throw new AppError('Choose an existing place.');
      const fullPrompt = `Create a professional landscaping and decorating design concept. Preserve the site's architecture, camera angle, access routes and permanent structures when a reference image is supplied. Use these site measurements as contextual guidance, not a certified scale drawing: ${measurements || 'Not supplied'}. Client brief: ${prompt}. Do not include text, logos or watermarks; branding will be applied separately.`;
      const dispatcher = new EnvHttpProxyAgent({ headersTimeout: 660000, bodyTimeout: 660000 });
      let response;
      try {
        if (originalImage) {
          const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(originalImage);
          if (!match) throw new AppError('Upload a PNG, JPG or WebP reference image.');
          const bytes = Buffer.from(match[2], 'base64');
          if (bytes.length > 8 * 1024 * 1024) throw new AppError('Reference images must be under 8 MB.');
          const form = new FormData();
          form.set('model', imageModel); form.set('prompt', fullPrompt); form.set('quality', imageQuality); form.set('size', imageSize);
          form.set('image', new Blob([bytes], { type: `image/${match[1]}` }), `site.${match[1]}`);
          response = await fetchImage('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${imageKey}` }, body: form, dispatcher, signal: AbortSignal.timeout(600000) });
        } else {
          response = await fetchImage('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${imageKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: imageModel, prompt: fullPrompt, quality: imageQuality, size: imageSize, n: 1 }), dispatcher, signal: AbortSignal.timeout(600000) });
        }
        const result = await response.json();
        if (!response.ok) {
          const reason = response.status === 401 ? 'The configured OpenAI key was not accepted.' : response.status === 403 ? 'The configured OpenAI account or network policy does not permit this image request.' : response.status === 429 ? 'OpenAI usage limit reached. Check the account balance and try again later.' : 'OpenAI could not generate this image. Try a different brief or check the configured image model.';
          throw new AppError(reason, 502);
        }
        const image = result.data?.[0]?.b64_json;
        if (!image) throw new AppError('The image service returned no image. Try again later.', 502);
        const id = randomUUID();
        writeFileSync(join(dataDir, 'designs', `${id}.png`), Buffer.from(image, 'base64'));
        const design = store.put('designs', { id, title: prompt.slice(0, 80), prompt, measurements, placeId, image: `/media/${id}.png`, createdAt: new Date().toISOString(), model: imageModel, quality: imageQuality, size: imageSize, portfolio: false });
        res.status(201).json(design);
      } finally { await dispatcher.close(); }
    } catch (error) {
      if (error.name === 'TimeoutError') next(new AppError('Image generation timed out. Please try again.', 504));
      else if (error instanceof AppError) next(error);
      else next(new AppError('Image service could not be reached. Check the server network configuration.', 502));
    }
  });
  app.use('/media', (req, res, next) => req.role ? next() : next(new AppError('Please sign in to continue.', 401)), express.static(join(dataDir, 'designs'), { dotfiles: 'deny', index: false }));
  app.use('/media', (req, res, next) => next(new AppError('Image not found.', 404)));
  app.use('/api/:collection', (req, res, next) => {
    if (!collections.includes(req.params.collection)) return next(new AppError('Unknown record type.', 404));
    if (req.params.collection === 'stockMovements' && req.method !== 'GET') return next(new AppError('Stock history is managed automatically and cannot be edited.', 403));
    next();
  });
  app.get('/api/:collection', (req, res) => res.json(store.list(req.params.collection)));
  function authorizePurchase(req, existing) {
    if (req.params.collection === 'purchaseRequests' && req.role !== 'owner') {
      if (existing && existing.status !== 'Pending') throw new AppError('Only the owner can change a reviewed purchase request.', 403);
      if (req.body.status && req.body.status !== 'Pending') throw new AppError('Only the owner can approve or reject purchases.', 403);
    }
  }
  app.post('/api/:collection', (req, res, next) => {
    try {
      authorizePurchase(req);
      const id = randomUUID();
      const defaults = req.params.collection === 'jobs' ? { status: 'Scheduled', type: 'Maintenance', crewIds: [], tasks: [] } : req.params.collection === 'inventory' ? { quantity: 0, minStock: 0, cost: 0, category: 'Plants', unit: 'plants' } : req.params.collection === 'purchaseRequests' ? { status: 'Pending', requestedBy: req.role } : {};
      res.status(201).json(store.put(req.params.collection, { ...defaults, ...req.body, id }));
    } catch (error) { next(error); }
  });
  app.patch('/api/:collection/:id', (req, res, next) => {
    try {
      authorizePurchase(req, store.get(req.params.collection, req.params.id));
      res.json(store.update(req.params.collection, req.params.id, req.body, req.role === 'owner' ? 'Owner' : 'Manager'));
    } catch (error) { next(error); }
  });
  app.delete('/api/:collection/:id', (req, res, next) => {
    try { authorizePurchase(req, store.get(req.params.collection, req.params.id)); store.remove(req.params.collection, req.params.id); res.status(204).end(); } catch (error) { next(error); }
  });
  app.use('/api', (req, res, next) => next(new AppError('API endpoint not found.', 404)));
  const dist = resolve('dist');
  if (existsSync(join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (req, res) => res.sendFile(join(dist, 'index.html')));
  }
  app.use((error, req, res, next) => {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500 && !(error instanceof AppError)) console.error('Request failed:', error.message);
    res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : error.message });
  });
  app.locals.store = store;
  return app;
}
