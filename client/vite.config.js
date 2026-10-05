import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl =
    env.VITE_API_BASE_URL ||
    env.VITE_API_URL ||
    env.API_URL ||
    process.env.VITE_API_BASE_URL ||
    process.env.VITE_API_URL ||
    process.env.API_URL ||
    (mode === 'production' ? 'https://mkm-n1ao.onrender.com' : '');
  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiUrl),
      'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': apiUrl || 'http://127.0.0.1:4000',
        '/uploads': apiUrl || 'http://127.0.0.1:4000',
      },
    },
  };
});
