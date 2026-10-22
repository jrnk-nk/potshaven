import 'dotenv/config';
import { createApp } from './app.js';
import { createStore } from './store.js';
import { resolve, join } from 'node:path';

const port = Number(process.env.PORT || 3001);
const dataDir = resolve(process.env.DATA_DIR || '.data');
const store = createStore(join(dataDir, 'potshaven.db'), { seed: process.env.DATA_SEED !== 'false' });
const app = createApp({ store, dataDir });
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`PotsHaven API listening on port ${port}. ${!process.env.APP_OWNER_PASSWORD && !process.env.APP_MANAGER_PASSWORD ? 'Demo mode: sample data and owner access enabled.' : 'Password authentication enabled.'}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { app.locals.store.close(); process.exit(0); }));
