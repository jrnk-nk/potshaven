import {randomUUID} from 'node:crypto';
import {providerFingerprint} from './provider-operations.js';
import {EnvHttpProxyAgent} from 'undici';
import {AppError} from './store.js';

// This explicit owner action checks the provider, not merely key presence.
// It sends no company records and never generates images or changes work.
export function installProviderReadiness(app, {store, key, model, fetchAssistant}) {
  app.post('/api/readiness/assistant', async (req, res, next) => {
    let operation, operationId, providerStarted = false, responseReceived = false;
    try {
      if (req.role !== 'owner') throw new AppError('Only the owner can check the assistant connection.', 403);
      if (!key) throw new AppError('The assistant has not been connected. Ask your administrator to configure access.', 503);
      operationId = randomUUID();
      const admission = await store.claimProviderOperation({role: req.role, kind: 'readiness', requestId: operationId, fingerprint: providerFingerprint({model, check: 'assistant-response'})});
      if (!admission.claimed) throw new AppError('This connection check is already being handled. Please wait before checking again.', 409);
      operation = admission.operation;
      const dispatcher = new EnvHttpProxyAgent({headersTimeout: 30000, bodyTimeout: 30000});
      let result;
      try {
        providerStarted = true;
        const response = await fetchAssistant('https://api.openai.com/v1/responses', {
          method: 'POST', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
          body: JSON.stringify({model, input: 'Connection check only. Reply with the single word Ready.', max_output_tokens: 256, store: false}),
          dispatcher, signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {responseReceived = true; throw new AppError(response.status === 401 || response.status === 403
          ? 'The connected service refused access. Ask your administrator to check the account and key.'
          : response.status === 429 ? 'The service usage limit was reached. Check the connected account before trying again.'
          : 'The assistant could not complete its connection check. Check service availability and the configured model.', 502);}
        result = await response.json(); responseReceived = true;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('The assistant connection could not be verified. Please try again later.', 502);
      } finally {await dispatcher.close();}
      const output = typeof result?.output_text === 'string' ? result.output_text : (Array.isArray(result?.output) ? result.output : []).flatMap(item => Array.isArray(item?.content) ? item.content : []).filter(item => item?.type === 'output_text' && typeof item.text === 'string').map(item => item.text).join('');
      if (result?.status && result.status !== 'completed' || !/^ready[.!]?$/i.test(output.trim())) throw new AppError('The service responded, but the assistant check did not finish correctly. Please try again later.', 502);
      const resultStatus = {ok: true, checkedAt: new Date().toISOString(), check: 'assistant-response'};
      try {await store.finishProviderOperation(req.role, 'readiness', operationId, {status: 'completed', result: resultStatus});} catch { /* The real response was verified; admission remains fail-closed. */ }
      res.set('Cache-Control', 'private, no-store').vary('Cookie').json(resultStatus);
    } catch (error) {
      if (operation) {try {await store.finishProviderOperation(req.role, 'readiness', operationId, {status: !providerStarted || responseReceived ? 'failed' : 'uncertain'});} catch { /* Never retry an uncertain receipt write. */ }}
      next(error);
    }
  });
}
