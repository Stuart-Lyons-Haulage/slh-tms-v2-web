import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/tms-api': {
        target: 'http://127.0.0.1:5099',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tms-api/, ''),
      },
    },
  },
  build: {
    // Azure Maps is intentionally isolated into its own vendor chunk; keep the
    // warning threshold above that known third-party bundle while preserving
    // a meaningful guard for unexpected growth beyond it.
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'msal': ['@azure/msal-browser', '@azure/msal-react'],
          'maps': ['azure-maps-control'],
          'xlsx': ['xlsx'],
        },
      },
    },
  },
});
