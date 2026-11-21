import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  // Never wipe dist: a running `npm run dev` web server would briefly not find @bht/shared
  // and keep showing "Module not found". One entry file, so old files are always overwritten.
  clean: false,
  sourcemap: true,
  target: 'es2022',
});
