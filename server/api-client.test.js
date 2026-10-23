import test from 'node:test';
import assert from 'node:assert/strict';
import {api, ApiError} from '../src/api.ts';

test('temporary server failures remain retryable when their JSON response is truncated', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({
    status: 503, ok: false, headers: new Headers({'Content-Type': 'application/json'}),
    json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
  }));
  await assert.rejects(api('/state'), error => error instanceof ApiError && error.status === 503 && error.retryable);
});

test('a workspace timeout while receiving JSON is recoverable', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let started;
  const receiving = new Promise(resolve => { started = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url, options) => ({
    status: 200, ok: true, headers: new Headers({'Content-Type': 'application/json'}),
    json: () => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), {once: true});
      started();
    }),
  }));
  const request = api('/state');
  await receiving;
  t.mock.timers.tick(12000);
  await assert.rejects(request, error => error instanceof ApiError && error.code === 'REQUEST_TIMEOUT' && error.retryable);
});

test('a broken response stream is treated as a lost connection', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({
    status: 200, ok: true, headers: new Headers({'Content-Type': 'application/json'}),
    json: async () => { throw new TypeError('Network response stream was interrupted'); },
  }));
  await assert.rejects(api('/state'), error => error instanceof ApiError && error.code === 'NETWORK_ERROR' && error.retryable);
});

test('a successful response containing invalid JSON does not become an empty workspace or retry forever', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({
    status: 200, ok: true, headers: new Headers({'Content-Type': 'application/json'}),
    json: async () => { throw new SyntaxError('Unexpected token in JSON'); },
  }));
  await assert.rejects(api('/state'), error => error instanceof ApiError && error.code === 'INVALID_API_RESPONSE' && !error.retryable);
});
