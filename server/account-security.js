import {createHmac, timingSafeEqual} from 'node:crypto';
import {AppError} from './store.js';

const passwordText = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const samePassword = (left, right) => {
  if (!passwordText(left) || !passwordText(right)) return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Owner controls never expose credentials, session tokens or claimed users. */
export function installAccountSecurity(app, {store, ownerPassword, managerPassword, sessionSigningKey, demoMode}) {
  app.use('/api/security', (req, res, next) => {
    if (req.role !== 'owner') return next(new AppError('Account security is available to the business owner only.', 403));
    res.set('Cache-Control', 'private, no-store').vary('Cookie');
    next();
  });
  app.get('/api/security', (req, res) => {
    res.json({
      checkedAt: new Date().toISOString(), disabled: Boolean(demoMode), sharedAccounts: true,
      passwordsDistinct: !demoMode && passwordText(ownerPassword) && passwordText(managerPassword) && !samePassword(ownerPassword, managerPassword),
      ownerPasswordStrong: !demoMode && passwordText(ownerPassword) && ownerPassword.length >= 12,
      managerPasswordStrong: !demoMode && passwordText(managerPassword) && managerPassword.length >= 12,
    });
  });
  app.post('/api/security/sign-out-all', async (req, res, next) => {
    try {
      if (demoMode) throw new AppError('Device sign-out is unavailable in the demonstration workspace.', 403);
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['role', 'password'].includes(key)) || !['owner', 'manager'].includes(body.role) || !passwordText(body.password)) throw new AppError('Choose an account and enter the owner password.');
      if (typeof store.recordLoginAttempt !== 'function' || typeof store.revokeRoleSessions !== 'function') throw new AppError('Account security is temporarily unavailable. Please try again.', 503);
      const key = createHmac('sha256', sessionSigningKey).update(`account-security-reauth:${JSON.stringify([req.ip, 'owner'])}`).digest('hex');
      const accepted = samePassword(body.password, ownerPassword);
      let allowed;
      try {allowed = await store.recordLoginAttempt(key, accepted);} catch {throw new AppError('The owner password check could not be completed. No device sign-out was requested.', 503);}
      if (!allowed) throw new AppError('Too many owner password attempts. Please try again in 15 minutes.', 429);
      if (!accepted) throw new AppError('The owner password was not accepted. Please try again.', 403);
      try {await store.revokeRoleSessions(body.role);} catch {throw new AppError('Device sign-out could not be confirmed. Check account access before trying again.', 503);}
      const currentSessionRevoked = body.role === req.role;
      if (currentSessionRevoked) res.clearCookie('potshaven_session');
      res.json({ok: true, role: body.role, currentSessionRevoked});
    } catch (error) {next(error);}
  });
}
