import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure logic only: validation, mapping, banding and diffing. No browser, no network,
    // and — a project rule — never the live web. Everything runs against the committed
    // reports in web/fixtures/, which were produced by crawling the repo's own fixture site.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
