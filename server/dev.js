import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { config } from 'dotenv';
import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';
import { createApp } from './app.js';
import { createStore } from './store.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
config({ path: join(projectRoot, '.env'), quiet: true });
const port = Number(process.env.PORT || 5173);
const dataDir = resolve(projectRoot, process.env.DATA_DIR || '.data');
const store = createStore(join(dataDir, 'potshaven.db'), { seed: process.env.DATA_SEED !== 'false' });
// The UI and API share one process and one port, including when PORT is set.
// There is no second server or hard-coded proxy destination to go missing.
const app = createApp({ store, dataDir, serveClient: false });
const server = createHttpServer(app);
const vite = await createServer({
  root: projectRoot,
  configFile: join(projectRoot, 'vite.config.ts'),
  server: { middlewareMode: true, hmr: {server} },
  appType: 'spa',
});
app.use(vite.middlewares);
server.listen(port, '0.0.0.0', () => {
  console.log(`PotsHaven is ready on port ${server.address().port}. The app and API run together.`);
});
server.on('error', async error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the previous PotsHaven process or choose another PORT.` : 'PotsHaven could not start.');
  await vite.close();
  store.close();
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close(async () => { await vite.close(); store.close(); process.exit(0); });
  server.closeIdleConnections();
});
