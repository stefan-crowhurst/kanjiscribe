import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { envConfigSchema } from '@kanjiscribe/shared';

// Parse the API port through the shared env schema at config load: a
// malformed KANJISCRIBE_API_PORT aborts the build/dev server with a message
// naming the variable, instead of baking a broken base URL into the bundle.
const { KANJISCRIBE_API_PORT: apiPort } = envConfigSchema.parse({
  KANJISCRIBE_API_PORT: process.env.KANJISCRIBE_API_PORT
});

export default defineConfig({
  plugins: [react()],
  define: {
    __API_PORT__: JSON.stringify(String(apiPort))
  },
  server: {
    allowedHosts: ['raspberrypi', '.ts.net', 'localhost', '127.0.0.1'],
    host: '0.0.0.0',
    strictPort: true,
    port: Number(process.env.KANJISCRIBE_WEBAPP_PORT ?? '5173')
  }
});
