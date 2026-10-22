import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// npm run dev mounts this UI behind the API in server/dev.js on one port.
// No fixed proxy target: the backend cannot silently move to a different port.
export default defineConfig({
  plugins: [react()],
  server: {host: '0.0.0.0', port: 5173},
});
