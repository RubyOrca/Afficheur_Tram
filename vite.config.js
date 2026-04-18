import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    server: {
        proxy: {
            // Proxy Yahoo Finance to bypass CORS (dev only)
            '/yahoo-finance': {
                target: 'https://query1.finance.yahoo.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/yahoo-finance/, ''),
            },
        },
    },
});
