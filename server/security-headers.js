// These restrictions apply to the HTML shell as well as authenticated routes.
// Keep script/style/connect/image rules unchanged: the app supports inline
// styles, camera previews, and externally hosted images in client reports.
export const securityHeaders = Object.freeze({
  'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'microphone=(), payment=(), usb=()',
});

export const strictTransportSecurity = 'max-age=31536000';

export function applySecurityHeaders(req, res, {production = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)} = {}) {
  for (const [key, value] of Object.entries(securityHeaders)) res.setHeader(key, value);
  res.removeHeader('X-Powered-By');
  // Forwarded protocol is set by the HTTPS hosting proxy. Browsers ignore HSTS
  // on plain HTTP; omitting it locally also avoids changing development hosts.
  if (production && (req.secure || req.headers['x-forwarded-proto'] === 'https')) {
    res.setHeader('Strict-Transport-Security', strictTransportSecurity);
  }
}
