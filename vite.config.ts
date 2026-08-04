import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Keep the app and the shared Kanban package on the same React dispatcher,
  // including when the package is linked from a sibling checkout locally.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        admin: resolve(rootDir, 'admin.html'),
        public: resolve(rootDir, 'public.html'),
      },
    },
  },
});
