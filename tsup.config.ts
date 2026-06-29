import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server/index.ts'],
  format: ['esm'],
  target: 'es2022',
  platform: 'node',
  outDir: 'dist/server',
  clean: true,
  sourcemap: true,
  bundle: true,
  splitting: false,
  minify: false,
  dts: false,
  external: ['better-sqlite3'],
});
