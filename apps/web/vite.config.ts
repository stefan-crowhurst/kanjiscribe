import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __API_PORT__: JSON.stringify(process.env.KANJISCRIBE_API_PORT ?? '3000')
  },
  server: {
    allowedHosts: ['raspberrypi', '.ts.net', 'localhost', '127.0.0.1'],
    host: '0.0.0.0',
    strictPort: true,
    port: Number(process.env.KANJISCRIBE_WEBAPP_PORT ?? '5173')
  }
});
