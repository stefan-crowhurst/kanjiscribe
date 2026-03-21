import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['raspberrypi', '.ts.net', 'localhost', '127.0.0.1'],
    host: '0.0.0.0',
    strictPort: true,
    port: 5173
  }
});
