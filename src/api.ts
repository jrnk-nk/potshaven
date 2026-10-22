/** A failed request never becomes a successful, empty workspace. */
export class ApiError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  setup: boolean;
  constructor(message: string, {status = 0, code = '', retryable = false, setup = false} = {}) {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.retryable = retryable; this.setup = setup;
  }
}
const setupCodes = new Set(['DATABASE_NOT_CONFIGURED', 'AUTH_NOT_CONFIGURED', 'SESSION_NOT_CONFIGURED', 'CONFIGURATION_REQUIRED']);
export async function api(path: string, options: RequestInit = {}) {
  const read = !options.method || options.method.toUpperCase() === 'GET';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), read ? 12000 : 30000);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, {once:true});
  if(options.signal?.aborted)controller.abort();
  const headers=new Headers(options.headers);
  if(!headers.has('Accept'))headers.set('Accept','application/json');
  if(options.body&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  try {
    const response = await fetch(`/api${path}`, {
      ...options, signal: controller.signal, credentials: 'same-origin',
      headers,
    });
    if (response.status === 204) return null;
    const json = /\bjson\b/i.test(response.headers.get('content-type') || '');
    if (!json) {
      throw new ApiError('The workspace API returned a web page instead of data. Deploy the included backend routes alongside the app.', {status: response.status, code: 'INVALID_API_RESPONSE', retryable:[502,503,504].includes(response.status)});
    }
    let result: any;
    try { result = await response.json(); }
    catch { throw new ApiError('The workspace server returned an unreadable response. Please try again.', {status:response.status, code:'INVALID_API_RESPONSE'}); }
    if (!response.ok) {
      const code = typeof result?.code === 'string' ? result.code : '';
      const setup = setupCodes.has(code);
      const message = typeof result?.error === 'string' ? result.error : typeof result?.message === 'string' ? result.message : 'The server could not complete this request.';
      throw new ApiError(message, {status:response.status, code, setup, retryable:!setup && [408,425,429,500,502,503,504].includes(response.status)});
    }
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const timedOut = controller.signal.aborted;
    throw new ApiError(read
      ? timedOut ? 'The workspace is taking too long to respond. We’ll try to reconnect.' : 'The connection was interrupted. Check your internet connection and try again.'
      : 'The connection was interrupted. Check whether your change was saved before trying again.',
      {code: timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR', retryable: true});
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
  }
}
