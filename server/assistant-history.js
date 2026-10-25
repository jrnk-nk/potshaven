import {AppError, assistantConversationKey, assistantConversationOffset, assistantConversationResult, assistantExchangeInput} from './store.js';

/** Conversation text belongs to the signed-in role, never the public state. */
export function installAssistantHistory(app, {store}) {
  app.use('/api/assistant/conversations', (req, res, next) => {
    try {
      assistantConversationKey(req.role);
      res.set('Cache-Control', 'private, no-store').vary('Cookie');
      next();
    } catch (error) {next(error);}
  });
  app.get('/api/assistant/conversations', async (req, res, next) => {
    try {
      const requested = req.query.offset;
      if (requested !== undefined && (typeof requested !== 'string' || !/^(0|[1-9]\d{0,6})$/.test(requested))) throw new AppError('Choose a valid conversation offset.');
      const offset = assistantConversationOffset(requested === undefined ? 0 : Number(requested));
      res.json(await store.assistantConversations(req.role, {offset}));
    } catch (error) {next(error);}
  });
  app.get('/api/assistant/conversations/:id', async (req, res, next) => {
    try {
      assistantConversationKey(req.role, req.params.id);
      const conversation = await store.assistantConversation(req.role, req.params.id);
      if (!conversation) throw new AppError('Saved conversation not found.', 404);
      res.json(assistantConversationResult(conversation));
    } catch (error) {next(error);}
  });
  app.put('/api/assistant/conversations/:id', async (req, res, next) => {
    try {
      assistantConversationKey(req.role, req.params.id);
      const exchange = assistantExchangeInput(req.body);
      res.json(assistantConversationResult(await store.appendAssistantExchange(req.role, req.params.id, exchange)));
    } catch (error) {next(error);}
  });
}
