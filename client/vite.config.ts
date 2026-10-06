import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const clientRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const serverPort = Number(process.env.PORT ?? 8787);
// The server listens on 127.0.0.1 by default. xfwd passes the browser's address on, so a
// viewer on another computer (vite --host) is not mistaken for a local one.
const target = `http://127.0.0.1:${serverPort}`;
const proxy = {
  '/api': { target, xfwd: true },
  '/ws': { target: target.replace('http', 'ws'), ws: true, xfwd: true },
};

export default defineConfig({
  root: clientRoot,
  plugins: [react()],
  resolve: {
    alias: { '@shared': join(repoRoot, 'shared') },
  },
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
    proxy,
  },
  preview: {
    proxy,
  },
  build: {
    outDir: join(clientRoot, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
