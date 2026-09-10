// Self-contained Vitest config living inside src/ so the project-level
// vite.config.js does not need to change.
//
//   npx vitest run --config src/test/vitest.config.js
//
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: path.resolve(here, '../..'),
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: [path.resolve(here, 'setup.js')],
        include: ['src/**/*.test.{js,jsx}'],
        css: false,
    },
});
