import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:5000',
                changeOrigin: true,
                secure: false,
            },
        },
    },
    build: {
        rollupOptions: {
            input: {
                main: here('index.html'),
                'service-worker': here('src/service-worker.js'),
            },
            output: {
                entryFileNames: (chunk) =>
                    chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js',
            },
        },
    },
});