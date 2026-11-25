import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // In development the browser talks only to Vite; Vite forwards /api to
    // the Express server. The browser therefore sees ONE origin, exactly like
    // production, so cookies and CSRF behave the same in both.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    // SECURITY: no source maps in the production bundle (they would publish our source code).
    sourcemap: false,
    // Keep JS and CSS as separate files; the strict Content-Security-Policy blocks inline code.
    assetsInlineLimit: 0,
  },
});
